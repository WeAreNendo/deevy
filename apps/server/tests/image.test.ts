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

  it("starts as root, saying so rather than inheriting a user", async () => {
    // The `:nonroot` base sets 65532, and the image replaces it on purpose: the
    // entrypoint needs root to give /data away, then drops it (ADR-0033).
    expect(await runtimeStage()).toMatch(/^USER 0:0$/m);
  });

  it("runs everything through the entrypoint that gives up root", async () => {
    // So `docker run … dist/import.mjs` drops as the server does. The
    // interpreter is named in full, because /nodejs/bin is not on PATH.
    const entrypoint = /^ENTRYPOINT (\[.*\])$/m.exec(await runtimeStage());
    expect(entrypoint).not.toBeNull();
    expect(JSON.parse(entrypoint![1]) as string[]).toEqual([
      "/nodejs/bin/node",
      "/app/dist/entrypoint.mjs",
    ]);
  });

  it("names the script and not the interpreter, because the entrypoint runs it", async () => {
    // The entrypoint imports the script it is handed once it is no longer
    // root, so `CMD ["node", …]` would have it look for /app/node.
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
    // Docker creates a missing mount point as root. The entrypoint would give
    // it away, but a fresh named volume copies this and so needs nothing given,
    // and `--user 65532:65532` keeps working on one.
    expect(await runtimeStage()).toMatch(/^COPY --from=\S+ --chown=65532:65532 \S+ \/data$/m);
  });

  it("leaves the code to root, so the process cannot change what root runs next", async () => {
    // The entrypoint runs as root at every start: whoever could rewrite
    // /app/dist could rewrite it.
    const copies = (await runtimeStage()).split("\n").filter((line) => line.startsWith("COPY "));
    expect(copies.filter((line) => !line.endsWith(" /data"))).toHaveLength(2);
    for (const line of copies) {
      if (!line.endsWith(" /data")) expect(line).not.toContain("--chown");
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
 * The half of the change an operator feels. The image used to need /data given
 * to 65532 by hand — a host directory, a volume an earlier release wrote, a
 * restore — and now gives it to itself, so the docs stop asking for it and say
 * how to keep it from ever starting as root instead (ADR-0033).
 */
describe("what the docs tell an operator about it", () => {
  it("no longer calls the runtime image node:24-slim", async () => {
    expect(await read("docs/OPERATIONS.md")).not.toContain("`node:24-slim`");
  });

  it("gives nobody a chown to run for the image to start, restore included", async () => {
    // In a command, that is: the pages still say what one started with
    // `--user` needs, in prose, because that is the one case it still holds.
    for (const page of [
      "docs/OPERATIONS.md",
      "apps/docs/content/self-hosting/docker.md",
      "apps/docs/content/self-hosting/backup-and-restore.md",
    ]) {
      const commands = (await read(page)).match(/```[\s\S]*?```/g) ?? [];
      expect(commands.length, page).toBeGreaterThan(0);
      for (const command of commands) expect(command, page).not.toContain("chown");
    }
  });

  it("says how to run it without ever being root", async () => {
    expect(await read("docs/OPERATIONS.md")).toContain("--user 65532:65532");
    expect(await read("apps/docs/content/self-hosting/docker.md")).toContain("--user 65532:65532");
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
