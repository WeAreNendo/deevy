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
    expect(isPrivate).toBe(false);
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

  it("ships the bundle and the readme, and nothing else", async () => {
    const { files, bin } = await manifest();
    expect(files).toEqual(["dist", "README.md"]);
    // The name somebody types, pointed at the file with the shebang in it.
    expect(bin).toEqual({ deevy: "./dist/main.mjs" });
  });

  it("starts with a shebang, or the bin is not runnable", async () => {
    // `vp pack` keeps it because the entry has it; a bin without one is a file
    // the shell hands to itself.
    const entry = await read("apps/cli/src/main.ts");
    expect(entry.startsWith("#!/usr/bin/env node\n")).toBe(true);
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

describe("the release", () => {
  it("publishes it from the tag, with provenance", async () => {
    const workflow = await read(".github/workflows/changesets.yml");
    expect(workflow).toContain("pnpm publish --access public --no-git-checks");
    // From the tag rather than from main, so what is published is what was
    // released.
    expect(workflow).toContain("ref: v${{ needs.version.outputs.version }}");
    expect(workflow).toContain("id-token: write");
  });

  it("does not fail a release that was already published", async () => {
    // A re-run must be able to finish; npm's own answer is the only way to ask.
    expect(await read(".github/workflows/changesets.yml")).toContain("is already on npm");
  });
});
