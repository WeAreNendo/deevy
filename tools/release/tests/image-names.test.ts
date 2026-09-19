import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string): Promise<string> => readFile(path.join(root, file), "utf8");

/** Lines that are not YAML or markdown comments, so prose about a bug is not the bug. */
const uncommented = (text: string): string[] =>
  text.split("\n").filter((line) => !/^\s*(?:#|<!--)/.test(line));

/**
 * Shell and Actions expansions taken out, because the capitals in
 * `${GITHUB_REPOSITORY,,}` are a variable's name and not part of any image
 * name — that expansion is the fix. Whether an expression builds the name is a
 * separate claim, asserted separately below against the unstripped text.
 */
const literal = (line: string): string =>
  line
    .replace(/\$\{\{[^}]*\}\}/g, "expr")
    .replace(/\$\{[^}]*\}/g, "expr")
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, "expr");

/**
 * A container registry rejects a mixed-case repository name outright, and
 * `github.repository` carries the owner exactly as GitHub spells it — which is
 * not ours to choose. deevy moved to an organisation whose login has capitals
 * in it, and every image name in the tree moved with it by find-and-replace.
 *
 * What that cost: the first release attempted under the new name tagged v0.8.0,
 * wrote the GitHub Release, and then failed every image build on
 * `invalid reference format`, taking the npm publish with it. The same replace
 * had put the same name in front of users, where `docker pull` refuses it too.
 *
 * CHANGELOG.md is deliberately not checked. It is generated from changesets and
 * never edited by hand, and its published entries are a record of what was said
 * at the time rather than instructions to follow now.
 */
describe("the image name", () => {
  const sources = [
    ".github/workflows/release.yml",
    "docker-compose.yml",
    "docs/OPERATIONS.md",
    "docs/m3-acceptance.md",
  ];

  it("is lowercase everywhere somebody could copy it", async () => {
    for (const file of sources) {
      const offending = uncommented(await read(file))
        .map(literal)
        .filter((line) =>
          /ghcr\.io\/[^\s"']*[A-Z]|repository:[a-z]*[A-Z][^\s"']*\/|\/v2\/[^\s"']*[A-Z]/.test(line),
        );
      expect({ file, offending }).toEqual({ file, offending: [] });
    }
  });

  it("is lowercased by the workflow rather than taken as GitHub spells it", async () => {
    const workflow = await read(".github/workflows/release.yml");
    // `${VAR,,}` in bash, because Actions expressions have no lowercase
    // function — so the name cannot be built inline in a `with:` field.
    expect(workflow).toContain('echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"');
    expect(uncommented(workflow).join("\n")).not.toContain("ghcr.io/${{ github.repository");
  });
});
