import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";

const root = new URL("../../../", import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, root), "utf8");

/**
 * The instructions of the stage that is actually published: everything after
 * the last `FROM`, less the comments — which say words like CMD-SHELL in the
 * course of explaining why they are not used, and would answer for them.
 */
async function runtimeStage(): Promise<string> {
  const dockerfile = await read("apps/server/Dockerfile");
  const last = dockerfile.lastIndexOf("\nFROM ");
  expect(last).toBeGreaterThan(-1);
  return dockerfile
    .slice(last + 1)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

/**
 * What the published image is, asserted over the Dockerfile rather than over a
 * built image, so it costs no daemon and rides into `vp run -r test`.
 *
 * The smoke (apps/server/scripts/smoke-image.ts) asks a running container the
 * same questions and is the one that would catch a base image changing under
 * us; this one catches the change nobody meant to make, on the pull request
 * that makes it. Both exist because the failures differ: a wrong CMD here is a
 * container that will not start at all, and neither review nor a type-checker
 * has any opinion about it.
 */
describe("the deevy image", () => {
  it("is built on the pinned distroless Node", async () => {
    // Pinned by digest as well as by tag: the tag moves whenever the base is
    // rebuilt, and a release that cannot say which bytes it shipped is not one.
    expect(await runtimeStage()).toMatch(
      /^FROM gcr\.io\/distroless\/nodejs24-debian13:nonroot@sha256:[0-9a-f]{64} AS runtime$/m,
    );
  });

  it("says which user it runs as rather than inheriting one", async () => {
    // The `:nonroot` tag already sets 65532, but a retag can drop it silently
    // and nothing here would notice. Saying it makes the fact greppable too.
    expect(await runtimeStage()).toMatch(/^USER 65532:65532$/m);
  });

  it("names the script and not the interpreter, because the entrypoint is node", async () => {
    // The distroless entrypoint IS /nodejs/bin/node, so `CMD ["node", …]` runs
    // `node node dist/index.mjs` and the container dies looking for /app/node.
    const cmd = /^CMD (\[.*\])$/m.exec(await runtimeStage());
    expect(cmd).not.toBeNull();
    const argv = JSON.parse(cmd![1]) as string[];
    expect(argv).toEqual(["dist/index.mjs"]);
  });

  it("carries its own healthcheck, with a node the PATH cannot find", async () => {
    const stage = await runtimeStage();
    // Docker runs an exec-form HEALTHCHECK directly, not through the
    // entrypoint, and /nodejs/bin is not on PATH in this base — so a
    // healthcheck saying `node` never runs, and a CMD-SHELL one has no shell.
    expect(stage).toMatch(/^HEALTHCHECK /m);
    expect(stage).toContain('CMD ["/nodejs/bin/node"');
    expect(stage).not.toContain("CMD-SHELL");
  });

  it("brings a /data the runtime user owns, because VOLUME alone would not", async () => {
    // Docker creates a missing mount point as root, and the process is 65532:
    // it could then neither create the database nor, more quietly, the -wal
    // beside it (packages/adapters/src/node/db.ts).
    expect(await runtimeStage()).toMatch(/^COPY --from=\S+ --chown=65532:65532 \S+ \/data$/m);
  });

  it("hands everything it copies to that user", async () => {
    for (const line of (await runtimeStage()).split("\n")) {
      if (line.startsWith("COPY ")) expect(line).toContain("--chown=65532:65532");
    }
  });

  it("is the only place the healthcheck is defined", async () => {
    // A healthcheck in compose overrides the image's, and the one that used to
    // be there called `node` by name — so it would report unhealthy forever and
    // hold back the agent service, which waits on service_healthy.
    const compose = await read("docker-compose.yml");
    const deevy = compose.slice(compose.indexOf("\n  deevy:"), compose.indexOf("\n  agent:"));
    expect(deevy).not.toContain("healthcheck:");
  });
});

/**
 * The half of the change an operator feels. An image that runs as 65532 needs
 * files owned by 65532, and every existing instance has a volume full of files
 * written as root — so the upgrade note is not documentation of the change, it
 * is part of it.
 */
describe("what the docs tell an operator about it", () => {
  it("no longer calls the runtime image node:24-slim", async () => {
    expect(await read("docs/OPERATIONS.md")).not.toContain("`node:24-slim`");
  });

  it("gives an existing volume to the new user before the new image wants it", async () => {
    expect(await read("docs/OPERATIONS.md")).toContain("chown -R 65532:65532 /data");
  });

  it("gives a restored database to it too", async () => {
    // The backup sidecar writes as root, so a restored file lands owned by 0:0
    // and deevy cannot open it — the failure arrives at the worst moment there is.
    const doc = await read("docs/OPERATIONS.md");
    const restore = doc.slice(doc.indexOf("## Backup and restore"));
    expect(restore).toContain("chown 65532:65532");
  });
});

/**
 * CI is where the two above are actually run, so the wiring is asserted here:
 * the smoke is invoked by path there and by script name by a developer, and
 * that is exactly the pair that drifts.
 */
describe("what CI does with the image", () => {
  it("runs the smoke by the path it lives at", async () => {
    expect(await read(".github/workflows/ci.yml")).toContain(
      "node apps/server/scripts/smoke-image.ts",
    );
  });

  it("scans it for known vulnerabilities", async () => {
    expect(await read(".github/workflows/ci.yml")).toContain("aquasecurity/trivy-action");
  });
});
