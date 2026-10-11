/**
 * `vp run hosted#check:hosted`: the archive `vp run hosted#package` wrote is a
 * Worker wrangler will deploy, as shipped. It is taken apart with the
 * system's `tar` — anybody's tool, not the writer that made it — every file
 * is checked against the manifest and the archive against its `.sha256`, and
 * `wrangler deploy --dry-run` runs on its own `wrangler.json`, blanks and all,
 * in the extracted directory with nothing of this repository's beside it.
 * wrangler takes a blank for the string it is; filling them is the deployer's,
 * and this checks only that doing so leaves nothing blank.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { sha256, token, type Manifest, type WranglerConfig } from "./artifact.ts";
import { app, run, version as packageVersion, wrangler } from "./local.ts";

const version = await packageVersion();
const name = `deevy-hosted-${version}.tar.gz`;
const archive = join(app, "dist", name);
const problems: string[] = [];

const [digest] = (await readFile(`${archive}.sha256`, "utf8")).split(/\s+/);
if (digest !== sha256(await readFile(archive))) problems.push(`${name}.sha256 does not match it`);

const into = await mkdtemp(join(tmpdir(), "deevy-hosted-package-"));
try {
  execFileSync("tar", ["-xzf", archive, "-C", into]);
  const described = JSON.parse(await readFile(join(into, "manifest.json"), "utf8")) as Manifest;
  if (described.format !== 1) problems.push(`the manifest is format ${String(described.format)}`);
  if (described.version !== version) {
    problems.push(`the manifest says ${described.version}, the package ${version}`);
  }

  const found = (await readdir(into, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(into, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .filter((path) => path !== "manifest.json")
    .sort();
  const listed = Object.keys(described.files).sort();
  if (JSON.stringify(found) !== JSON.stringify(listed)) {
    problems.push(
      `the archive holds ${found.join(", ")} but the manifest lists ${listed.join(", ")}`,
    );
  }
  for (const path of listed) {
    if (sha256(await readFile(join(into, path))) !== described.files[path]) {
      problems.push(`${path} is not the file the manifest hashed`);
    }
  }

  // Every blank is one the manifest declares, and nothing else is blank.
  const shipped = await readFile(join(into, "wrangler.json"), "utf8");
  const blanks = new Set([...shipped.matchAll(/<<([A-Z_]+)>>/g)].map((match) => match[1]));
  const declared = new Set(described.placeholders.map((placeholder) => placeholder.name));
  for (const blank of blanks) {
    if (!declared.has(blank ?? "")) problems.push(`wrangler.json has an undeclared blank ${blank}`);
  }
  const config = JSON.parse(shipped) as WranglerConfig;
  for (const placeholder of described.placeholders) {
    for (const pointer of placeholder.at) {
      const value = pointer
        .split("/")
        .slice(1)
        .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
        .reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], config);
      if (typeof value !== "string" || !value.includes(token(placeholder.name))) {
        problems.push(`${placeholder.name} is not at ${pointer} in wrangler.json`);
      }
    }
  }
  for (const secret of described.secrets) {
    if (shipped.includes(`"${secret.name}"`)) {
      problems.push(`wrangler.json names the secret ${secret.name}`);
    }
  }

  const standIns: Record<string, string> = {
    HOST: "app.example.com",
    DIRECTORY_KV_ID: "0123456789abcdef0123456789abcdef",
    CONSOLE_SERVICE: "deevy-console",
  };
  let rendered = shipped;
  for (const placeholder of described.placeholders) {
    rendered = rendered.replaceAll(token(placeholder.name), standIns[placeholder.name] ?? "");
  }
  const filled = JSON.parse(rendered) as WranglerConfig;
  if (rendered.includes("<<") || filled.vars?.DEEVY_HOSTED_ORIGIN !== "https://app.example.com") {
    problems.push("filling the blanks in wrangler.json does not leave a deployable origin");
  }

  if (problems.length === 0) {
    await run(
      wrangler,
      ["deploy", "--dry-run", "--config", "wrangler.json", "--outdir", join(into, ".dry-run")],
      into,
    );
  }
} finally {
  await rm(into, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(
    `\n${name} is not what a release may ship:\n${problems.map((p) => `  ${p}`).join("\n")}`,
  );
  process.exit(1);
}
console.log(`\n${name} deploys as shipped`);
