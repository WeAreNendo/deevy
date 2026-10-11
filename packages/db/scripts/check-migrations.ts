// Two guards over generated SQL. drizzle-kit 1.0.0-rc.4 emits `id text PRIMARY
// KEY` without NOT NULL (#6165), which lets SQLite store NULL ids, so the
// generated SQL is patched by hand and this keeps CI honest about it. And the
// D1 projection in packages/db/migrations is a committed build artifact of the
// same source, so a stale one fails here like a stale openapi.json (ADR-0008).
// A third keeps every release able to run on the next one's schema: a
// migration only adds, unless it says it is the later release that removes
// (ADR-0031, expand-only.ts).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkExpandOnly } from "./expand-only.ts";
import {
  drizzleDir as defaultDrizzleDir,
  migrationsDir as defaultMigrationsDir,
  projectMigrations,
} from "./emit-d1-migrations.ts";

export interface MigrationDirs {
  drizzleDir: string;
  migrationsDir: string;
}

/** Every complaint about the two migration folders, empty when they are sound. */
export async function checkMigrations({
  drizzleDir,
  migrationsDir,
}: MigrationDirs): Promise<string[]> {
  // A migration that takes something away is rewritten rather than projected,
  // so it is said first and alone: drizzle's table rebuild also trips the D1
  // projection's PRAGMA refusal, which throws, and would otherwise be all that
  // anybody heard about it.
  const removals = await checkExpandOnly(drizzleDir);
  if (removals.length > 0) return [...(await textPrimaryKeysAreNotNull(drizzleDir)), ...removals];
  return [
    ...(await textPrimaryKeysAreNotNull(drizzleDir)),
    ...(await projectionIsCurrent(drizzleDir, migrationsDir)),
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

async function projectionIsCurrent(drizzleDir: string, migrationsDir: string): Promise<string[]> {
  const projected = await projectMigrations(drizzleDir);
  const problems: string[] = [];
  for (const { name, sql } of projected) {
    const committed = await readFile(join(migrationsDir, name), "utf8").catch(() => null);
    if (committed === null) {
      problems.push(`packages/db/migrations/${name} is missing; run \`vp run db#generate:d1\``);
    } else if (committed !== sql) {
      problems.push(`packages/db/migrations/${name} is stale; run \`vp run db#generate:d1\``);
    }
  }
  const expected = new Set(projected.map(({ name }) => name));
  const present = await readdir(migrationsDir).catch(() => [] as string[]);
  for (const name of present.filter((file) => file.endsWith(".sql")).sort()) {
    if (!expected.has(name)) {
      problems.push(
        `packages/db/migrations/${name} has no drizzle folder; run \`vp run db#generate:d1\``,
      );
    }
  }
  return problems;
}

if (import.meta.main) {
  // The two folders are arguments so that a test can drive this script — the
  // one CI runs, exit code and all — rather than only the function inside it.
  const [drizzleDir = defaultDrizzleDir, migrationsDir = defaultMigrationsDir] =
    process.argv.slice(2);
  const problems = await checkMigrations({ drizzleDir, migrationsDir });
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("migrations ok");
}
