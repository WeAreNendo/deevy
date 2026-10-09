/**
 * A hosted Workspace taken to a Worker of its own (docs/OPERATIONS.md, "Taking
 * a hosted Workspace home"): its dump, converted by `import.mjs --for-d1`,
 * applied to an empty local D1 through the committed apps/web/wrangler.jsonc,
 * and then asked what the operator asks wrangler next — whether any migration
 * is left to apply, and whether the Workspace is there.
 *
 * Twice: a dump at this release's schema, after which wrangler has nothing to
 * apply, and one a migration behind, after which wrangler applies exactly that
 * one. A script rather than a test for the reason
 * packages/db/scripts/check-d1-apply.ts is one: it drives the wrangler CLI
 * against miniflare. `--local` needs no account. It runs from source, since
 * Node strips the types of the workspace packages it imports.
 *
 *   vp run server#check:d1-import
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { migrations as everyMigration } from "@deevy/db/durable-migrations";
import { d1FileName, dumpForD1, migrationNames } from "../src/import-dump.ts";
import { hostedURL, hostedWorkspace, workspaceAt } from "../tests/hosted-workspace.ts";

const run = promisify(execFile);
const wrangler = new URL("../node_modules/.bin/wrangler", import.meta.url).pathname;
const config = new URL("../../web/wrangler.jsonc", import.meta.url).pathname;
const migrationsFolder = new URL("../../../packages/db/drizzle", import.meta.url).pathname;
const database = "deevy";
const known = migrationNames(migrationsFolder);

// The hosted Workspace's Humans sign in through the stub, which replaces fetch.
await import("../../web/scripts/stub-oauth.js");

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok  ${name}`);
  else failures.push(detail ? `${name}: ${detail}` : name);
}

async function wrangle(persistTo: string, args: string[]): Promise<string> {
  const { stdout } = await run(
    wrangler,
    [...args, "--local", "--config", config, "--persist-to", persistTo],
    {
      // wrangler asks about telemetry, and before applying, on a fresh machine.
      env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return stdout;
}

async function query(persistTo: string, sql: string): Promise<Record<string, unknown>> {
  const stdout = await wrangle(persistTo, ["d1", "execute", database, "--json", "--command", sql]);
  const [result] = JSON.parse(stdout.slice(stdout.indexOf("["))) as Array<{
    results: Array<Record<string, unknown>>;
  }>;
  return result?.results[0] ?? {};
}

/** A fresh local D1 with `sql` applied as an operator applies it: one file, `d1 execute --file`. */
async function applied(sql: string): Promise<string> {
  const persistTo = await mkdtemp(join(tmpdir(), "deevy-d1-import-"));
  const file = join(persistTo, "workspace.d1.sql");
  await writeFile(file, sql);
  await wrangle(persistTo, ["d1", "execute", database, "--file", file]);
  return persistTo;
}

const homes: string[] = [];
try {
  console.log("a dump at this release's schema");
  const hosted = await hostedWorkspace();
  const { sql } = await dumpForD1({
    dump: hosted.dump(),
    migrationsFolder,
    baseURL: "https://deevy.example.org",
  });
  hosted.storage.close();
  const home = await applied(sql);
  homes.push(home);

  const listed = await wrangle(home, ["d1", "migrations", "list", database]);
  check("wrangler has no migration left to apply", /No migrations to apply/i.test(listed), listed);
  const found = await query(
    home,
    `SELECT (SELECT name FROM workspace) AS workspace,
            (SELECT count(*) FROM member) AS members,
            (SELECT seq FROM sqlite_sequence WHERE name = 'event') AS seq,
            (SELECT count(*) FROM d1_migrations) AS journaled,
            (SELECT count(*) FROM sqlite_master WHERE name = '__drizzle_migrations') AS drizzle,
            (SELECT count(*) FROM oauth_resource WHERE identifier LIKE '${hostedURL}/%') AS stale`,
  );
  check("the Workspace is there", found.workspace === "Acme", JSON.stringify(found));
  check("so are its Members, Agent included", found.members === 3, JSON.stringify(found));
  check(
    "the Event counter is where the hosted one stood",
    found.seq === hosted.eventSeq,
    `${String(found.seq)} against ${String(hosted.eventSeq)}`,
  );
  check(
    "wrangler's journal holds every migration, and drizzle's is not there",
    found.journaled === known.length && found.drizzle === 0,
    JSON.stringify(found),
  );
  check("nothing names the hosted address", found.stale === 0, JSON.stringify(found));

  console.log("a dump one migration behind");
  const older = Object.fromEntries(Object.entries(everyMigration).slice(0, -1));
  const behind = await applied(
    (await dumpForD1({ dump: workspaceAt(older), migrationsFolder })).sql,
  );
  homes.push(behind);
  const latest = d1FileName(known.at(-1)!, known);
  const pending = await wrangle(behind, ["d1", "migrations", "list", database]);
  check(
    "wrangler lists the one migration the dump did not have",
    pending.includes(latest) && !pending.includes(d1FileName(known.at(-2)!, known)),
    pending,
  );
  await wrangle(behind, ["d1", "migrations", "apply", database]);
  const after = await wrangle(behind, ["d1", "migrations", "list", database]);
  check("and has nothing left once it applied it", /No migrations to apply/i.test(after), after);
  const kept = await query(behind, "SELECT name FROM workspace");
  check("the Workspace is still there", kept.name === "Acme", JSON.stringify(kept));
} finally {
  for (const home of homes) await rm(home, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(
    `\n${String(failures.length)} failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`,
  );
  process.exit(1);
}
console.log(`\nD1 import ok through ${config}`);
