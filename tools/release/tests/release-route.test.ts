import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string): Promise<string> => readFile(path.join(root, file), "utf8");

/**
 * Both publishing workflows can be entered by hand to repair a release that
 * half-happened, and both are entered that way at the worst possible moment:
 * the tag and the GitHub Release already exist, so what they build is what that
 * version is, forever.
 *
 * v0.8.0 is why this is asserted. Its images failed, which skipped npm, and the
 * repair ran days of commits later — safe only because the difference was
 * measured first and turned out to be documentation. Left unpinned, the next
 * one publishes main under an older version's number and nothing says so.
 */
describe("a release built by hand", () => {
  for (const workflow of [".github/workflows/release.yml", ".github/workflows/npm.yml"]) {
    it(`builds the tag it was given, in ${path.basename(workflow)}`, async () => {
      const text = await read(workflow);
      // The version in, the tag out. Both files spell it the same way because
      // it is the same claim.
      expect(text).toContain(
        "ref: ${{ inputs.version != '' && format('v{0}', inputs.version) || github.ref }}",
      );
    });

    it(`checks out nothing unpinned, in ${path.basename(workflow)}`, async () => {
      // A bare `- uses: actions/checkout@v7` with no `with:` under it takes the
      // caller's ref, which on a dispatch is a branch. That is the bug, and it
      // reads as an ordinary line rather than as a mistake.
      const text = await read(workflow);
      const bare = text.split("\n").filter((line, index, lines) => {
        if (!/^\s*- uses: actions\/checkout@/.test(line)) return false;
        const next = lines[index + 1] ?? "";
        return !/^\s*with:\s*$/.test(next);
      });
      expect(bare).toEqual([]);
    });
  }
});
