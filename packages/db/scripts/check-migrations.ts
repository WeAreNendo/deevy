// Two guards over generated SQL. drizzle-kit 1.0.0-rc.4 emits `id text PRIMARY
// KEY` without NOT NULL (#6165), which lets SQLite store NULL ids, so the
// generated SQL is patched by hand and this keeps CI honest about it. And the
// Durable Object projection in packages/db/src/durable-migrations.ts is a
// committed build artifact of the same source, so a stale one fails here like a
// stale openapi.json (ADR-0008).
// A third keeps every release able to run on the next one's schema: a
// migration only adds, unless it says it is the later release that removes
// (ADR-0031, expand-only.ts).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkExpandOnly } from "./expand-only.ts";
import {
  drizzleDir as defaultDrizzleDir,
  durableMigrationsFile as defaultDurableMigrationsFile,
  projectDurableMigrations,
  renderDurableMigrations,
} from "./emit-durable-migrations.ts";

export interface MigrationPaths {
  drizzleDir: string;
  durableMigrationsFile: string;
}

/** Every complaint about the migrations and their projections, empty when they are sound. */
export async function checkMigrations({
  drizzleDir,
  durableMigrationsFile,
}: MigrationPaths): Promise<string[]> {
  // A migration that takes something away is rewritten rather than projected,
  // so it is said first and alone: drizzle's table rebuild also trips the
  // projection's PRAGMA refusal, which throws, and would otherwise be all that
  // anybody heard about it.
  const removals = await checkExpandOnly(drizzleDir);
  if (removals.length > 0) return [...(await textPrimaryKeysAreNotNull(drizzleDir)), ...removals];
  return [
    ...(await textPrimaryKeysAreNotNull(drizzleDir)),
    ...(await durableProjectionIsCurrent(drizzleDir, durableMigrationsFile)),
  ];
}

async function textPrimaryKeysAreNotNull(drizzleDir: string): Promise<string[]> {
  const problems: string[] = [];
  for (const entry of await readdir(drizzleDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(drizzleDir, entry.name, "migration.sql");
    const sql = await readFile(file, "utf8").catch(() => null);
    if (sql === null) continue;
    for (const [index, line] of sql.split("\n").entries()) {
      if (/\btext\b.*\bPRIMARY KEY\b/i.test(line) && !/\bNOT NULL\b/i.test(line)) {
        problems.push(
          `drizzle/${entry.name}/migration.sql:${index + 1}: text PRIMARY KEY without ` +
            `NOT NULL; patch it by hand:\n  ${line.trim()}`,
        );
      }
    }
  }
  return problems;
}

/**
 * The module is compared as text, not as the record it exports, because the
 * text is what is committed: a hand edit that leaves the record the same is
 * still a file nobody generated.
 */
async function durableProjectionIsCurrent(
  drizzleDir: string,
  durableMigrationsFile: string,
): Promise<string[]> {
  const expected = renderDurableMigrations(await projectDurableMigrations(drizzleDir));
  const committed = await readFile(durableMigrationsFile, "utf8").catch(() => null);
  if (committed === null) {
    return ["packages/db/src/durable-migrations.ts is missing; run `vp run db#generate:durable`"];
  }
  if (committed !== expected) {
    return ["packages/db/src/durable-migrations.ts is stale; run `vp run db#generate:durable`"];
  }
  return [];
}

if (import.meta.main) {
  // The paths are arguments so that a test can drive this script — the one CI
  // runs, exit code and all — rather than only the function inside it.
  const [drizzleDir = defaultDrizzleDir, durableMigrationsFile = defaultDurableMigrationsFile] =
    process.argv.slice(2);
  const problems = await checkMigrations({ drizzleDir, durableMigrationsFile });
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("migrations ok");
}
