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

/**
 * Every line the workflow actually runs: the bodies of its `run:` blocks, with
 * comment lines and all the surrounding YAML left out.
 *
 * Worth the twenty lines because the alternative keeps failing the same way. An
 * assertion over the whole file matches the prose in it — a `--provenance` that
 * only ever appeared in a comment passed review, and both of the assertions
 * written for this rule first matched an input description and a comment
 * quoting the bug it forbids.
 */
/** The workflow with its comment lines removed, for claims about YAML keys. */
const configLines = (workflow: string): string[] =>
  workflow.split("\n").filter((line) => !/^\s*#/.test(line));

function shellLines(workflow: string): string[] {
  const lines = workflow.split("\n");
  const out: string[] = [];
  let blockIndent: number | null = null;
  for (const line of lines) {
    const indent = line.search(/\S/);
    if (blockIndent !== null && line.trim() !== "" && indent <= blockIndent) blockIndent = null;
    if (blockIndent !== null) {
      if (line.trim() !== "" && !/^\s*#/.test(line)) out.push(line);
      continue;
    }
    const block = /^(\s*)run: \|/.exec(line);
    if (block) {
      blockIndent = block[1]?.length ?? 0;
      continue;
    }
    const inline = /^\s*run: (?!\|)(.+)$/.exec(line);
    if (inline?.[1] !== undefined) out.push(inline[1]);
  }
  return out;
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

  it("carries no npm token, because npm mints one per run", async () => {
    const workflow = await publishing();
    // Trusted publishing: the OIDC identity below is the whole credential. A
    // token left in place is not a harmless fallback — pnpm falls back to it
    // without saying so, and a trusted publisher that has stopped working then
    // looks exactly like one that works.
    const config = configLines(workflow);
    expect(config.filter((line) => /NODE_AUTH_TOKEN|NPM_TOKEN/.test(line))).toEqual([]);
    // And no .npmrc naming one. An empty `_authToken` is worse than no file:
    // it sends an empty credential and is refused before the exchange.
    expect(config.filter((line) => /registry-url:/.test(line))).toEqual([]);
    expect(workflow).toContain("id-token: write");
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
    // No --provenance anywhere in a command: npm attaches provenance itself
    // for an OIDC publish, and passing the flag is how you discover whether
    // pnpm agrees. `publishConfig.provenance` above is the standing claim.
    expect(shellLines(workflow).filter((line) => line.includes("--provenance"))).toEqual([]);
    // Both ends: a reusable workflow's token is capped by the CALLING job, so
    // dropping this from changesets.yml costs the credential itself now, not
    // just provenance.
    expect(workflow).toContain("id-token: write");
    expect(release).toContain("id-token: write");
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
    // On its own line specifically. The same command inside an `echo` cannot
    // fail: under `bash -e` a substitution in an argument does not set the
    // status, so the step goes green on a dead token.
    // pnpm reports a failed token exchange as a *warning* and carries on, so
    // the rehearsal has to read the output rather than trust the exit code —
    // otherwise a trusted publisher that has stopped working passes it, which
    // is the same trap `--dry-run` set by authenticating nothing at all.
    const commands = shellLines(workflow).map((line) => line.trim());
    expect(commands).toContain("set -o pipefail");
    expect(commands.some((line) => /grep -q 'Skipped OIDC'/.test(line))).toBe(true);
    expect(workflow).toMatch(/vp pm publish [^\n]*--dry-run/);
  });

  it("refuses to publish without a version, rather than inventing one", async () => {
    // A dispatch that is told to publish and given no version reaches the same
    // script. `npm view "@deevy/cli@"` resolves to latest rather than failing,
    // so without this it either exits green having done nothing or publishes
    // whatever apps/cli/package.json carries, off a branch, untagged.
    expect(await publishing()).toMatch(/if \[ -z "\$VERSION" \]; then/);
  });

  /**
   * Found by the first rehearsal, which is the entire argument for having one:
   * pnpm hands `whoami` to npm, and npm at the repository root exits
   * EBADDEVENGINES before it opens a socket, because the root manifest pins
   * devEngines.packageManager to pnpm. It reads as an auth failure and is not.
   */
  it("runs its commands where they can run, which is not the repository root", async () => {
    // `.slice(1)` drops everything before the first step — the triggers and
    // their descriptions, which talk about npm without running it.
    const steps = (await publishing()).split(/\n {6}- name: /).slice(1);
    const commanding = steps.filter((step) =>
      step
        .split("\n")
        .filter((line) => !/^\s*#/.test(line))
        .some((line) => /(?:^|[\s(])(?:npm|vp pm) \w/.test(line)),
    );
    expect(commanding.length).toBeGreaterThanOrEqual(2);
    for (const step of commanding) expect(step).toContain("working-directory: apps/cli");
  });

  /**
   * The repository's rule, and the reason the first rehearsal broke: npm
   * refuses to run anywhere the manifest pins devEngines.packageManager to
   * pnpm, which the root one does. This file held the only bare npm commands
   * in the repository, two of them older than the rehearsal.
   */
  it("uses pnpm, which is what everything else here uses", async () => {
    const running = shellLines(await publishing()).filter((line) =>
      /(?:^|[\s(])npm [a-z]/.test(line),
    );
    expect(running).toEqual([]);
  });

  it("can be rehearsed at all, which is the only way this job ever runs early", async () => {
    const workflow = await publishing();
    expect(workflow).toContain("workflow_dispatch:");
    // Anchored to each entry. Unanchored, this began at the `workflow_call`
    // input and ran on to whichever `default:` came first, so swapping the two
    // still matched — and that swap is both the loaded gun below and a release
    // that rehearses instead of publishing while reporting success.
    expect(workflow).toMatch(/workflow_dispatch:[\s\S]*?dry-run:[\s\S]*?default: true/);
    expect(workflow).toMatch(/workflow_call:[\s\S]*?dry-run:[\s\S]*?default: false/);
  });
});
