/**
 * `vp run hosted#package`: the hosted Worker as a release carries it
 * (docs/plans/hosted.md slice 13), from what `vp run web#build:workers` and
 * `vp run hosted#build:hosted` left behind.
 *
 *   dist/deevy-hosted-<version>.tar.gz
 *     worker.js, worker.js.map   the bundle, which wrangler will not bundle again
 *     client/…                   the SPA every Workspace serves
 *     wrangler.json              wrangler.jsonc for that bundle, the deployer's blanks marked
 *     manifest.json              what is inside, and what the deployer adds
 *   dist/deevy-hosted-<version>.tar.gz.sha256
 *
 * The archive is written here, with Node's zlib and a ustar writer of its own
 * (scripts/artifact.ts), rather than by the system's `tar`: GNU and BSD tar
 * disagree about the flags that make an archive reproducible, and macOS's
 * adds metadata of its own. The same commit gives the same tar — the same
 * files in the same order, owned by nobody and dated by the commit — so a
 * rebuild can be held against a release file by file through the manifest's
 * hashes. The gzip around it is only as stable as the zlib that wrote it.
 */
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { manifest, sha256, tar, template } from "./artifact.ts";
import { app, version as packageVersion } from "./local.ts";

const encoder = new TextEncoder();

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: app, encoding: "utf8" }).trim();
}

const version = await packageVersion();
const commit = git("rev-parse", "HEAD");
// Every file is dated with the commit, as SOURCE_DATE_EPOCH would date it.
const mtime = Number(git("log", "-1", "--format=%ct", "HEAD"));

const built = join(app, "dist/hosted");
const worker = await readFile(join(built, "worker.js"));
const workerText = new TextDecoder().decode(worker);
if (workerText.includes("__DEEVY_VERSION__") || !workerText.includes(JSON.stringify(version))) {
  throw new Error(
    `dist/hosted/worker.js does not say it is ${version}: build it again with \`vp run hosted#build:hosted\``,
  );
}

const client = join(app, "../web/dist/client");
const spa = await filesUnder(client).catch((): string[] => []);
if (!spa.includes("index.html")) {
  throw new Error("No SPA at apps/web/dist/client: build it with `vp run web#build:workers`");
}

const config = template(await readFile(join(app, "wrangler.jsonc"), "utf8"));
const files: Array<{ path: string; bytes: Uint8Array }> = [
  { path: "worker.js", bytes: worker },
  { path: "worker.js.map", bytes: await readFile(join(built, "worker.js.map")) },
  { path: "wrangler.json", bytes: encoder.encode(`${JSON.stringify(config, null, 2)}\n`) },
  ...(await Promise.all(
    spa.map(async (path) => ({
      path: `client/${path.split("\\").join("/")}`,
      bytes: await readFile(join(client, path)),
    })),
  )),
];
const described = manifest({ version, commit, config, files });
files.push({
  path: "manifest.json",
  bytes: encoder.encode(`${JSON.stringify(described, null, 2)}\n`),
});

const name = `deevy-hosted-${version}.tar.gz`;
const archive = gzipSync(tar(files, mtime), { level: 9 });
// The header's operating system byte says Unix wherever this ran, rather than
// 19 on macOS; no checksum covers it (RFC 1952).
archive[9] = 3;
const digest = sha256(archive);
await writeFile(join(app, "dist", name), archive);
// The shape `sha256sum -c` reads.
await writeFile(join(app, "dist", `${name}.sha256`), `${digest}  ${name}\n`);

console.log(
  `dist/${name}: ${String(files.length)} files, ${(archive.length / 1024 / 1024).toFixed(1)} MiB, sha256 ${digest}`,
);
