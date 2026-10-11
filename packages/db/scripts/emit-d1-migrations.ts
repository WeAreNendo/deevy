/**
 * Projects drizzle-kit's migrations into the form `wrangler d1 migrations
 * apply` reads (ADR-0008). drizzle-kit is still the only generator; this is a
 * second, committed rendering of its output, diffed in CI like openapi.json.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ProjectedMigration {
  /** The file name wrangler applies, numbered in journal order. */
  name: string;
  sql: string;
}

export const drizzleDir = new URL("../drizzle/", import.meta.url).pathname;
export const migrationsDir = new URL("../migrations/", import.meta.url).pathname;

/**
 * The projection of every migration in `drizzleDir`, in journal order. What
 * this returns is exactly what `packages/db/migrations` must hold, which is
 * what makes a stale projection something CI can see.
 */
export async function projectMigrations(drizzleDir: string): Promise<ProjectedMigration[]> {
  const folders = (await readdir(drizzleDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    folders.map(async (folder, index) => {
      const source = `drizzle/${folder}/migration.sql`;
      const statements = statementsIn(
        await readFile(join(drizzleDir, folder, "migration.sql"), "utf8"),
      );
      for (const statement of statements) refuseWhatD1WillNotHonour(source, statement);
      return {
        name: `${String(index + 1).padStart(4, "0")}_${folder}.sql`,
        sql: render(source, statements),
      };
    }),
  );
}

interface Statement {
  sql: string;
  /** Where the statement starts in the drizzle file, so a refusal can point at it. */
  line: number;
}

/**
 * drizzle marks its own statement boundaries with a comment wrangler does not
 * read, so the projection has to turn them into plain statement separation.
 */
function statementsIn(sql: string): Statement[] {
  const statements: Statement[] = [];
  let line = 1;
  for (const chunk of sql.split(/-->[ \t]*statement-breakpoint/)) {
    // A comment above a statement is not part of it. What D1 will not take is
    // recognised by how a statement starts, and a `-- deevy: contract` line on
    // top of drizzle's table rebuild would otherwise hide the PRAGMA under it
    // (ADR-0031).
    const code = chunk.replace(/^(?:\s*--[^\n]*(?:\n|$))+/, "");
    const leading = chunk.length - code.trimStart().length;
    const body = code.trim();
    if (body.length > 0) {
      statements.push({
        sql: body.endsWith(";") ? body : `${body};`,
        line: line + countLines(chunk.slice(0, leading)),
      });
    }
    line += countLines(chunk);
  }
  return statements;
}

function countLines(text: string): number {
  return text.split("\n").length - 1;
}

/**
 * Measured against a local D1, not assumed. The PRAGMA is the one that matters:
 * D1 runs a batch inside a transaction, where SQLite ignores `PRAGMA
 * foreign_keys` — so the `PRAGMA foreign_keys=OFF` drizzle wraps around a table
 * rebuild, and that the Node migrator honours at the connection, does nothing,
 * the rebuild's `DROP TABLE` cascades the children away, and wrangler still
 * reports success. Refusing here beats discovering it in a deploy.
 */
const refused = [
  { pattern: /^PRAGMA\b/i, why: "D1 rejects most PRAGMAs and silently ignores the rest" },
  {
    pattern: /^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i,
    why: "D1 runs every batch in its own transaction and refuses transaction control",
  },
  { pattern: /^(ATTACH|DETACH)\b/i, why: "D1 answers SQLITE_AUTH to ATTACH and DETACH" },
  { pattern: /^VACUUM\b/i, why: "D1 cannot VACUUM from inside its transaction" },
];

function refuseWhatD1WillNotHonour(source: string, { sql, line }: Statement): void {
  for (const { pattern, why } of refused) {
    if (!pattern.test(sql)) continue;
    throw new Error(
      `${source}:${line}: ${why}, so this migration cannot be projected to D1:\n  ${sql}`,
    );
  }
}

function render(source: string, statements: Statement[]): string {
  return [
    `-- Generated from ${source} by \`vp run db#generate:d1\`.`,
    "-- Edit packages/db/src/schema instead; wrangler applies this file to D1 (ADR-0008).",
    "",
    ...statements.flatMap(({ sql }) => [sql, ""]),
  ].join("\n");
}

/** Writes the projection, replacing whatever was there: `vp run db#generate:d1`. */
export async function emitMigrations(): Promise<string[]> {
  const projected = await projectMigrations(drizzleDir);
  await rm(migrationsDir, { recursive: true, force: true });
  await mkdir(migrationsDir, { recursive: true });
  for (const { name, sql } of projected) await writeFile(join(migrationsDir, name), sql);
  return projected.map(({ name }) => name);
}

if (import.meta.main) {
  const written = await emitMigrations();
  console.log(`wrote ${written.length} D1 migrations to packages/db/migrations`);
}
