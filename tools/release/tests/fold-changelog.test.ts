import { describe, expect, it } from "vite-plus/test";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../../..");

/**
 * The fixtures below are verbatim `changeset version` output, not invented: the
 * dependency bullet has two shapes and only one of them says "Updated
 * dependencies", which a hand-written fixture would have missed.
 */
const packages = [
  "packages/core",
  "packages/db",
  "packages/adapters",
  "packages/editor",
  "apps/web",
  "apps/server",
  "apps/agent",
  "apps/cli",
  "tools/release",
];

async function fold(
  changelogs: Record<string, string>,
  options: { version?: string; existing?: string } = {},
) {
  const version = options.version ?? "0.5.0";
  const dir = await mkdtemp(path.join(tmpdir(), "deevy-fold-"));
  try {
    await mkdir(path.join(dir, "tools/release/scripts"), { recursive: true });
    await cp(
      path.join(root, "tools/release/scripts/fold-changelog.ts"),
      path.join(dir, "tools/release/scripts/fold-changelog.ts"),
    );
    for (const pkg of packages) {
      await mkdir(path.join(dir, pkg), { recursive: true });
      const name = `@deevy/${path.basename(pkg)}`;
      await writeFile(
        path.join(dir, pkg, "package.json"),
        JSON.stringify({ name, version }, null, 2),
      );
      const changelog = changelogs[pkg];
      if (changelog !== undefined) await writeFile(path.join(dir, pkg, "CHANGELOG.md"), changelog);
    }
    await writeFile(
      path.join(dir, "package.json"),
      `${JSON.stringify({ name: "deevy", version: "0.4.0" }, null, 2)}\n`,
    );
    await writeFile(
      path.join(dir, "CHANGELOG.md"),
      options.existing ?? "# Changelog\n\nA preamble.\n\n## 0.4.0\n\nOlder.\n",
    );

    await run("node", [path.join(dir, "tools/release/scripts/fold-changelog.ts")], { cwd: dir });
    return {
      changelog: await readFile(path.join(dir, "CHANGELOG.md"), "utf8"),
      rootManifest: JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as {
        version: string;
      },
      leftovers: packages.filter((pkg) => existsSync(path.join(dir, pkg, "CHANGELOG.md"))).sort(),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const withChanges = {
  "packages/core": `# @deevy/core

## 0.5.0

### Minor Changes

- Issues can be filtered by the Gate they are waiting on.

### Patch Changes

- @deevy/db@0.5.0
`,
  "apps/web": `# @deevy/web

## 0.5.0

### Minor Changes

- Issues can be filtered by the Gate they are waiting on.

### Patch Changes

- Updated dependencies
  - @deevy/core@0.5.0
  - @deevy/adapters@0.5.0
`,
  "apps/server": `# @deevy/server

## 0.5.0

### Patch Changes

- @deevy/adapters@0.5.1
  - @deevy/core@0.5.1
`,
  "apps/agent": `# @deevy/agent

## 0.5.0

### Patch Changes

- The runtime stops polling after a fifth consecutive authentication failure.
`,
  "packages/db": "# @deevy/db\n\n## 0.5.0\n\nNo changes in this release.\n",
};

describe("folding the per-package changelogs", { timeout: 30_000 }, () => {
  it("writes one entry for the version they share", async () => {
    const { changelog } = await fold(withChanges);
    expect(changelog.match(/^## 0\.5\.0$/gm)).toHaveLength(1);
  });

  it("names every area a change touched, once", async () => {
    const { changelog } = await fold(withChanges);
    // The same changeset named core and web, so it is one entry across two areas
    // rather than the same sentence printed twice.
    expect(changelog).toContain(
      "- **core, web** — Issues can be filtered by the Gate they are waiting on.",
    );
    expect(changelog.match(/Issues can be filtered/g)).toHaveLength(1);
  });

  it("keeps the bump levels apart and in order", async () => {
    const { changelog } = await fold(withChanges);
    expect(changelog.indexOf("### Minor Changes")).toBeLessThan(
      changelog.indexOf("### Patch Changes"),
    );
    expect(changelog).toContain("- **agent** — The runtime stops polling");
  });

  it("drops dependency bullets in all three shapes changesets writes them", async () => {
    const { changelog } = await fold(withChanges);
    expect(changelog).not.toContain("Updated dependencies");
    expect(changelog).not.toContain("@deevy/db@0.5.0");
    expect(changelog).not.toContain("@deevy/adapters@0.5.0");
    // The third shape: a dependency bullet that itself heads an indented list,
    // with no "Updated dependencies" line above it. Matching the whole bullet
    // rather than its first line lets this one through, and it reached the root
    // changelog of a real release before this test existed.
    expect(changelog).not.toContain("@deevy/core@0.5.1");
  });

  it("says so rather than writing an empty entry", async () => {
    const { changelog } = await fold({ "packages/db": withChanges["packages/db"] });
    expect(changelog).toContain("## 0.5.0\n\nNo user-visible changes.");
  });

  it("keeps the preamble and the older entries below the new one", async () => {
    const { changelog } = await fold(withChanges);
    expect(changelog.startsWith("# Changelog\n\nA preamble.")).toBe(true);
    expect(changelog.indexOf("## 0.5.0")).toBeLessThan(changelog.indexOf("## 0.4.0"));
    expect(changelog).toContain("Older.");
  });

  it("drops the release candidates a final version supersedes", async () => {
    // Leaving pre-release mode re-lists every change in the final section, so
    // the rc entries above it are the same notes a second time.
    const { changelog } = await fold(withChanges, {
      version: "0.5.0",
      existing:
        "# Changelog\n\n## 0.5.0-rc.1\n\nSecond candidate.\n\n## 0.5.0-rc.0\n\nFirst candidate.\n\n## 0.4.1\n\nOlder.\n",
    });
    expect(changelog).not.toContain("0.5.0-rc.");
    expect(changelog).not.toContain("Second candidate.");
    expect(changelog).toContain("## 0.5.0");
    expect(changelog).toContain("## 0.4.1");
    expect(changelog).toContain("Older.");
  });

  it("keeps the candidate before it when the release is itself a candidate", async () => {
    const { changelog } = await fold(withChanges, {
      version: "0.5.0-rc.1",
      existing: "# Changelog\n\n## 0.5.0-rc.0\n\nFirst candidate.\n\n## 0.4.1\n\nOlder.\n",
    });
    expect(changelog).toContain("## 0.5.0-rc.1");
    expect(changelog).toContain("## 0.5.0-rc.0");
    expect(changelog).toContain("First candidate.");
  });

  it("syncs the root, which changesets never sees", async () => {
    const { rootManifest } = await fold(withChanges);
    expect(rootManifest.version).toBe("0.5.0");
  });

  it("leaves the per-package files where changesets/action can read them back", async () => {
    // Deleting them fails the release: the action reads each package's changelog
    // after the version command to compose the Version PR's body, and the first
    // run of this ended in an ENOENT for exactly that. They stay out of the
    // commit by being gitignored, not by being removed.
    const { leftovers } = await fold(withChanges);
    expect(leftovers).toEqual(Object.keys(withChanges).sort());
  });

  it("folds only the newest section of a file that kept its history", async () => {
    // A fresh CI checkout never has one, but a local run accumulates: the file
    // that was left behind above is appended to by the next `changeset version`.
    const { changelog } = await fold({
      "packages/core": `# @deevy/core

## 0.5.0

### Minor Changes

- Issues can be filtered by the Gate they are waiting on.

## 0.4.1

### Patch Changes

- Something released a long time ago.
`,
    });
    expect(changelog).toContain("Issues can be filtered by the Gate they are waiting on.");
    expect(changelog).not.toContain("Something released a long time ago.");
  });

  it("refuses a group whose versions drifted apart", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "deevy-fold-"));
    try {
      await mkdir(path.join(dir, "tools/release/scripts"), { recursive: true });
      await cp(
        path.join(root, "tools/release/scripts/fold-changelog.ts"),
        path.join(dir, "tools/release/scripts/fold-changelog.ts"),
      );
      for (const [index, pkg] of packages.entries()) {
        await mkdir(path.join(dir, pkg), { recursive: true });
        await writeFile(
          path.join(dir, pkg, "package.json"),
          JSON.stringify({
            name: `@deevy/${path.basename(pkg)}`,
            version: index === 3 ? "0.6.0" : "0.5.0",
          }),
        );
      }
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "deevy", version: "0.4.0" }),
      );
      await writeFile(path.join(dir, "CHANGELOG.md"), "# Changelog\n");
      await expect(
        run("node", [path.join(dir, "tools/release/scripts/fold-changelog.ts")], { cwd: dir }),
      ).rejects.toThrow(/should have moved them together/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the release notes for a version", () => {
  it("are that version's section, without its heading", async () => {
    const { stdout } = await run(
      "node",
      [path.join(root, "tools/release/scripts/release-notes.ts"), "0.4.0"],
      { cwd: root },
    );
    // 0.4.0 is the "Before" entry the changelog ships with, which is the only
    // section that exists until the first release is cut.
    expect(stdout).not.toContain("## ");
    expect(stdout).toContain("Nothing here is backfilled.");
  });

  it("refuse to invent a section that is not there", async () => {
    await expect(
      run("node", [path.join(root, "tools/release/scripts/release-notes.ts"), "9.9.9"], {
        cwd: root,
      }),
    ).rejects.toThrow(/no section for 9\.9\.9/);
  });
});
