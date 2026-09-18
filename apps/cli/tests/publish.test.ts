import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";

const root = new URL("../../../", import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, root), "utf8");

interface Manifest {
  name: string;
  version: string;
  private?: boolean;
  bin?: Record<string, string>;
  files?: string[];
  publishConfig?: { access?: string; provenance?: boolean };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const manifest = async (): Promise<Manifest> =>
  JSON.parse(await read("apps/cli/package.json")) as Manifest;

/**
 * deevy publishes one package, and this is the shape that lets it.
 *
 * Asserted rather than trusted because the failure is a bad release rather than
 * a bad build: a `workspace:*` in `dependencies` installs for nobody, a missing
 * `files` ships the whole directory, and `private` back to true simply stops
 * publishing with no error anywhere.
 */
describe("what npm would get", () => {
  it("is publishable at all, which every other package in the workspace is not", async () => {
    const { private: isPrivate, publishConfig } = await manifest();
    expect(isPrivate).toBeUndefined();
    // Scoped, so without this npm defaults to a paid private publish.
    expect(publishConfig?.access).toBe("public");
    // Provenance is what makes "this came from deevy" checkable rather than a
    // claim in a README.
    expect(publishConfig?.provenance).toBe(true);
  });

  it("installs nothing, because the bundle already has it", async () => {
    const { dependencies = {} } = await manifest();
    // `vp pack` inlines every dependency (vite.config.ts), so a dependency here
    // would be a second copy — and `@deevy/core` is `workspace:*`, which
    // resolves for nobody outside this repository.
    expect(dependencies).toEqual({});
  });

  it("ships the bundle, the readme and the licence, and nothing else", async () => {
    const { files, bin } = await manifest();
    // The licence is named rather than left to the packer. pnpm hoists the
    // workspace one and npm cannot reach outside the package directory, so a
    // package declaring AGPL-3.0-only shipped it only by which tool packed it.
    expect(files).toEqual(["dist", "README.md", "LICENSE"]);
    // The name somebody types, pointed at the file with the shebang in it.
    expect(bin).toEqual({ deevy: "./dist/main.mjs" });
  });

  it("starts with a shebang, or the bin is not runnable", async () => {
    // The source, because `vp pack` carries the shebang through from the entry
    // and `dist/` is not rebuilt by the test job — asserting the built file
    // here failed on a stale artifact rather than on anything true. What the
    // published bin actually starts with is checked where a build has just
    // happened: the publish job packs and the release would not ship otherwise.
    const entry = await read("apps/cli/src/main.ts");
    expect(entry.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("is the only thing in the workspace that can be published", async () => {
    // "Nothing else can be published by accident" is the claim; this is it.
    const directories = [
      "packages/core",
      "packages/db",
      "packages/adapters",
      "packages/editor",
      "apps/web",
      "apps/server",
      "apps/agent",
      "tools/release",
    ];
    const publishable: string[] = [];
    for (const directory of directories) {
      const other = JSON.parse(await read(`${directory}/package.json`)) as Manifest;
      if (other.private !== true) publishable.push(directory);
    }
    expect(publishable).toEqual([]);
  });

  it("moves with deevy, because it is deevy", async () => {
    const [cli, server] = await Promise.all([
      manifest(),
      read("apps/server/package.json").then((raw) => JSON.parse(raw) as Manifest),
    ]);
    // One number for the instance, the image and this (ADR-0017). The `fixed`
    // group in .changeset/config.json is what keeps them together; this is the
    // same claim where somebody would notice it.
    expect(cli.version).toBe(server.version);
  });
});

/**
 * These read the workflows, which is spelling rather than behaviour. They are
 * here for the three things a review found wrong that all looked fine: the
 * command was one the runner does not have, the credential was never sent, and
 * it went out ahead of CI. Each assertion is the shape of one of those failures
 * rather than a copy of the line that fixed it.
 *
 * What made them worth keeping is that the job itself could not be run: a
 * release runs it once, at the end, on the commit where a mistake costs a
 * version number. It can be rehearsed now — `gh workflow run npm.yml` — and
 * these still guard the parts a rehearsal cannot reach.
 */
describe("the release", () => {
  const publishing = (): Promise<string> => read(".github/workflows/npm.yml");
  const releasing = (): Promise<string> => read(".github/workflows/changesets.yml");

  it("publishes with a package manager the runner actually has", async () => {
    const workflow = await publishing();
    // A GitHub runner ships npm and yarn. vp keeps its own pnpm where nothing
    // on PATH can see it, so a bare `pnpm` is a job that cannot start.
    expect(workflow).toMatch(/vp pm publish/);
    expect(workflow).not.toMatch(/^\s+pnpm publish/m);
  });

  it("sends a credential, rather than only holding one", async () => {
    const workflow = await publishing();
    // NODE_AUTH_TOKEN is inert on its own: it is a convention that works only
    // because something writes an .npmrc naming it. setup-vp's registry-url is
    // what does that here, and without it the publish fails having sent
    // nothing at all.
    expect(workflow).toContain("registry-url: https://registry.npmjs.org");
    expect(workflow).toContain("NODE_AUTH_TOKEN");
  });

  it("goes out behind CI, because a version cannot be taken back", async () => {
    // The images re-run the whole of CI before they are pushed; running beside
    // them rather than after would publish without it.
    expect(await releasing()).toContain("needs: [version, publish]");
  });

  it("publishes what was tagged, with provenance, and only once", async () => {
    const [workflow, release] = await Promise.all([publishing(), releasing()]);
    // The version travels from the guard that decided there was one, and the
    // tag is what gets checked out — not whatever main has moved on to.
    expect(release).toContain("version: ${{ needs.version.outputs.version }}");
    expect(workflow).toContain("format('v{0}', inputs.version)");
    expect(workflow).toContain("--provenance");
    expect(workflow).toContain("id-token: write");
    // A re-run of a finished release must complete rather than fail.
    expect(workflow).toContain("is already on npm");
  });

  /**
   * A rehearsal is only worth having if it cannot publish and if it checks the
   * one thing a dry run does not. Both are one `if:` away from being untrue.
   */
  it("rehearses without publishing, and checks the credential separately", async () => {
    const workflow = await publishing();
    // The upload is gated on not rehearsing.
    expect(workflow).toMatch(/if: \$\{\{ !inputs\.dry-run \}\}\n\s+working-directory: apps\/cli/);
    // `publish --dry-run` uploads nothing and so authenticates nothing: it
    // passes with a made-up token. Something else has to make a real request,
    // or the rehearsal proves the credential works when it does not.
    expect(workflow).toContain("npm whoami");
    expect(workflow).toMatch(/vp pm publish [^\n]*--dry-run/);
  });

  it("can be rehearsed at all, which is the only way this job ever runs early", async () => {
    const workflow = await publishing();
    expect(workflow).toContain("workflow_dispatch:");
    // Defaulting the other way makes the dispatch entry a loaded gun.
    expect(workflow).toMatch(/dry-run:[\s\S]*?default: true/);
  });
});
