/**
 * Folds the per-package changelogs `changeset version` just wrote into the one
 * root CHANGELOG.md, and syncs the root package.json to the version they share.
 *
 * deevy ships two Docker images from one version tag, so a changelog per package
 * describes an artefact nobody downloads (docs/plans/commits-and-changelogs.md).
 * Changesets has no option to stop writing them, so they are gitignored and
 * folded here.
 *
 * They are deliberately left on disk. `changesets/action` reads them back after
 * the version command to compose the Version PR's body, so deleting them fails
 * the release with an ENOENT — which is exactly how the first run of this ended.
 * Being gitignored is what keeps them out of the commit, and only the newest
 * `## x.y.z` section is ever read, so a file that accumulates history locally
 * folds the same as a fresh one in CI.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "../../..");

/** The packages in the fixed group, in the order their areas should read. */
const packageDirs = [
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

/** `@deevy/agent` is the area `agent`; the scope carries no meaning here. */
const areaOf = (name: string) => name.replace(/^@deevy\//, "");

type Bullet = { areas: string[]; text: string };

/**
 * Splits a section body into top-level bullets, keeping each bullet's indented
 * continuation lines with it — `Updated dependencies` is a two-line bullet and
 * would otherwise be half-dropped.
 */
function bulletsOf(body: string): string[] {
  const bullets: string[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("- ")) bullets.push(line);
    else if (bullets.length > 0 && line.trim() !== "") bullets[bullets.length - 1] += `\n${line}`;
  }
  return bullets;
}

/** The `### Minor Changes` blocks of a package changelog's newest `## x.y.z` section. */
function sectionsOf(changelog: string): Map<string, string[]> {
  const afterVersion = changelog.split(/^## .*$/m)[1] ?? "";
  const out = new Map<string, string[]>();
  const parts = afterVersion.split(/^### (.*)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i]!.trim();
    const bullets = bulletsOf(parts[i + 1] ?? "")
      // Generated for every package in a fixed group, and meaningless when the
      // group is one product with one version. Three shapes, all three seen in
      // real output: `- Updated dependencies` heading an indented list, a bare
      // `- @deevy/db@0.5.0`, and a `- @deevy/adapters@0.4.1` that itself heads an
      // indented list. Only the bullet's FIRST line decides — matching against
      // the whole bullet lets the third shape through, because the continuation
      // lines mean it no longer ends where the pattern expects.
      .filter((bullet) => {
        const first = bullet.split("\n", 1)[0]!;
        return !first.startsWith("- Updated dependencies") && !/^- \S+@\d+\.\d+\.\d+$/.test(first);
      });
    if (bullets.length > 0) out.set(heading, [...(out.get(heading) ?? []), ...bullets]);
  }
  return out;
}

const order = ["Major Changes", "Minor Changes", "Patch Changes"];

async function main() {
  const collected = new Map<string, Bullet[]>();
  const found: string[] = [];
  let version: string | undefined;

  for (const dir of packageDirs) {
    const manifest = JSON.parse(await readFile(path.join(root, dir, "package.json"), "utf8")) as {
      name: string;
      version: string;
    };
    version ??= manifest.version;
    if (manifest.version !== version) {
      throw new Error(
        `${dir} is at ${manifest.version} but ${packageDirs[0]} is at ${version}. ` +
          `The fixed group in .changeset/config.json should have moved them together.`,
      );
    }

    const changelogPath = path.join(root, dir, "CHANGELOG.md");
    if (!existsSync(changelogPath)) continue;
    found.push(changelogPath);

    for (const [heading, bullets] of sectionsOf(await readFile(changelogPath, "utf8"))) {
      const into = collected.get(heading) ?? [];
      for (const text of bullets) {
        // One changeset naming several packages writes the same bullet into each
        // of their changelogs; it is one entry that happens to touch several areas.
        const seen = into.find((bullet) => bullet.text === text);
        if (seen) seen.areas.push(areaOf(manifest.name));
        else into.push({ areas: [areaOf(manifest.name)], text });
      }
      collected.set(heading, into);
    }
  }

  if (version === undefined) throw new Error("No packages found to read a version from.");

  const body = order
    .filter((heading) => collected.has(heading))
    .map((heading) => {
      const bullets = collected
        .get(heading)!
        .map(({ areas, text }) => text.replace(/^- /, `- **${areas.join(", ")}** — `));
      return `### ${heading}\n\n${bullets.join("\n")}\n`;
    })
    .join("\n");

  const entry = `## ${version}\n\n${body === "" ? "No user-visible changes.\n" : body}`;
  const changelogPath = path.join(root, "CHANGELOG.md");
  const existing = await readFile(changelogPath, "utf8");
  const [header, ...sections] = existing.split(/(?=^## )/m);

  // Leaving pre-release mode re-lists every change in the final version's
  // section, so the `0.5.0-rc.*` entries above it are the same notes twice.
  // They go, and only when the release being written is the final one — an rc
  // never removes the rc before it.
  const superseded = version.includes("-")
    ? () => false
    : (s: string) => s.startsWith(`## ${version}-`);
  const rest = sections.filter((section) => !superseded(section));
  await writeFile(
    changelogPath,
    `${header!.trimEnd()}\n\n${entry}\n${rest.join("")}`.trimEnd() + "\n",
  );

  // The root is not a workspace member, so changesets never sees it; it is what
  // the release workflow reads the tag out of.
  const rootManifestPath = path.join(root, "package.json");
  const rootManifest = await readFile(rootManifestPath, "utf8");
  await writeFile(
    rootManifestPath,
    rootManifest.replace(/"version": "[^"]*"/, `"version": "${version}"`),
  );

  process.stdout.write(`Folded ${found.length} changelog(s) into CHANGELOG.md at ${version}.\n`);
}

await main();
