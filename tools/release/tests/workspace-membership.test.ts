import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string): Promise<string> => readFile(path.join(root, file), "utf8");

/** Every workspace member, found the way pnpm finds them rather than listed. */
async function members(): Promise<{ name: string; dir: string; version: string }[]> {
  const globs = ["apps", "packages", "tools"];
  const found: { name: string; dir: string; version: string }[] = [];
  for (const parent of globs) {
    for (const entry of await readdir(path.join(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${parent}/${entry.name}`;
      let raw: string;
      try {
        raw = await read(`${dir}/package.json`);
      } catch {
        continue;
      }
      const { name, version } = JSON.parse(raw) as { name: string; version: string };
      found.push({ name, dir, version });
    }
  }
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

/** The quoted strings of a named array literal in a TypeScript source file. */
const arrayLiteral = (source: string, name: string): string[] => {
  const body = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(source)?.[1] ?? "";
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
};

/**
 * One deevy version, and the list of what carries it is written out by hand in
 * three places: the changesets fixed group, the changelog fold, and the fold's
 * own fixture. A fourth hand-written list decides what CI runs.
 *
 * `packages/editor` was in none of them. Its tests had never run in CI, and it
 * sat at 0.6.0 while everything around it shipped 0.8.0 — for four releases,
 * without anything failing, because every one of those lists is the kind that
 * is only wrong by omission.
 *
 * So the lists are checked against the workspace rather than against each
 * other. A new package is added to all four or this fails, which is the only
 * mechanism that would have caught the last one.
 */
describe("every package in the workspace", () => {
  it("is in the fixed group, so it carries deevy's version", async () => {
    const { fixed } = JSON.parse(await read(".changeset/config.json")) as { fixed: string[][] };
    const group = fixed[0] ?? [];
    const missing = (await members()).filter((m) => !group.includes(m.name)).map((m) => m.name);
    expect(missing).toEqual([]);
  });

  it("actually carries it, rather than only being promised it", async () => {
    const all = await members();
    const versions = [...new Set(all.map((m) => m.version))];
    // One number across the group is the claim ADR-0017 makes; a package added
    // to the group late keeps its old number until the next release, and this
    // is where that shows up rather than in a changelog nobody diffs.
    expect({ versions, all: all.map((m) => `${m.name}@${m.version}`) }).toEqual({
      versions: [all[0]?.version],
      all: all.map((m) => `${m.name}@${m.version}`),
    });
  });

  it("is folded into the changelog, in the script and in its fixture", async () => {
    const [script, fixture] = await Promise.all([
      read("tools/release/scripts/fold-changelog.ts"),
      read("tools/release/tests/fold-changelog.test.ts"),
    ]);
    const dirs = (await members()).map((m) => m.dir);
    for (const [name, list] of [
      ["the fold script", arrayLiteral(script, "packageDirs")],
      ["its fixture", arrayLiteral(fixture, "packages")],
    ] as const) {
      expect({ name, missing: dirs.filter((dir) => !list.includes(dir)) }).toEqual({
        name,
        missing: [],
      });
    }
  });

  it("has its tests run by a CI shard", async () => {
    const ci = await read(".github/workflows/ci.yml");
    const sharded = new Set([...ci.matchAll(/-F ([a-z-]+)/g)].map((match) => match[1]));
    // The filter is the package name without the scope.
    const missing = (await members())
      .map((m) => m.name.replace(/^@deevy\//, ""))
      .filter((short) => !sharded.has(short));
    expect(missing).toEqual([]);
  });
});
