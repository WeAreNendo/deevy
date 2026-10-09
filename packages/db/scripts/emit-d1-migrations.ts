/**
 * Projects drizzle-kit's migrations into the forms a Workers runtime applies
 * (ADR-0008). drizzle-kit is still the only generator; these are committed
 * renderings of its output, diffed in CI like openapi.json:
 *
 * - `packages/db/migrations/NNNN_<folder>.sql`, which `wrangler d1 migrations
 *   apply` reads for a D1 database;
 * - `packages/db/src/durable-migrations.ts`, which drizzle's durable-sqlite
 *   migrator takes inside a Durable Object. An object cannot read files, so the
 *   SQL has to be a module it imports.
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
export const durableMigrationsFile = new URL("../src/durable-migrations.ts", import.meta.url)
  .pathname;

interface DrizzleMigration {
  /** The folder drizzle-kit wrote, which is also the name every migrator records. */
  folder: string;
  /** Where it lives, relative to packages/db, for messages. */
  source: string;
  /** migration.sql exactly as drizzle-kit wrote it (and NOT NULL was patched into it). */
  sql: string;
  statements: Statement[];
}

/**
 * Every migration in `drizzleDir`, in journal order, each refused if it holds
 * something neither D1 nor a Durable Object will honour. Both projections are
 * read through this, so they cannot disagree about what was refused.
 */
async function readDrizzleMigrations(drizzleDir: string): Promise<DrizzleMigration[]> {
  const folders = (await readdir(drizzleDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    folders.map(async (folder) => {
      const source = `drizzle/${folder}/migration.sql`;
      const sql = await readFile(join(drizzleDir, folder, "migration.sql"), "utf8");
      const statements = statementsIn(sql);
      for (const statement of statements) refuseWhatWorkersWillNotHonour(source, statement);
      return { folder, source, sql, statements };
    }),
  );
}

/**
 * The D1 projection of every migration in `drizzleDir`, in journal order. What
 * this returns is exactly what `packages/db/migrations` must hold, which is
 * what makes a stale projection something CI can see.
 */
export async function projectMigrations(drizzleDir: string): Promise<ProjectedMigration[]> {
  return (await readDrizzleMigrations(drizzleDir)).map(({ folder, source, statements }, index) => ({
    name: `${String(index + 1).padStart(4, "0")}_${folder}.sql`,
    sql: render(source, statements),
  }));
}

/**
 * The Durable Object projection: each folder's name and its migration.sql,
 * verbatim, in journal order — the record drizzle's durable-sqlite migrator
 * takes as `{ migrations }`. Verbatim because that migrator splits on
 * `--> statement-breakpoint` exactly as the Node migrator does, and records each
 * migration under its key in `__drizzle_migrations` where the Node migrator
 * records the folder name, so an object applies what a Node server applies and
 * a database migrated in either opens in the other with nothing left to do.
 */
export async function projectDurableMigrations(
  drizzleDir: string,
): Promise<Record<string, string>> {
  return Object.fromEntries(
    (await readDrizzleMigrations(drizzleDir)).map(({ folder, sql }) => [folder, sql]),
  );
}

/** The module `packages/db/src/durable-migrations.ts` must hold for these migrations. */
export function renderDurableMigrations(migrations: Record<string, string>): string {
  return [
    "// Generated from packages/db/drizzle by `vp run db#generate:d1`; edit packages/db/src/schema instead.",
    "//",
    "// A Durable Object cannot read files, so this is the form drizzle's durable-sqlite migrator takes:",
    "// each drizzle folder's name and its migration.sql, verbatim, in journal order, as",
    '// `migrate(db, { migrations })` from "drizzle-orm/durable-sqlite/migrator". It is reached only',
    "// through `@deevy/db/durable-migrations`, so nothing else bundles it. `vp run db#check:migrations`",
    "// fails when it is stale (packages/db/scripts/emit-d1-migrations.ts).",
    "",
    "export const migrations: Record<string, string> = {",
    ...Object.entries(migrations).map(
      ([folder, sql]) => `  ${JSON.stringify(folder)}:\n    ${JSON.stringify(sql)},`,
    ),
    "};",
    "",
  ].join("\n");
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
    const leading = chunk.length - chunk.trimStart().length;
    const body = chunk.trim();
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
 * Measured against a local D1 and a local Durable Object, not assumed; the two
 * answer alike. The PRAGMA is the one that matters: both run migrations inside
 * a transaction, where SQLite ignores `PRAGMA foreign_keys` — so the `PRAGMA
 * foreign_keys=OFF` drizzle wraps around a table rebuild, and that the Node
 * migrator honours at the connection, is accepted and does nothing, the
 * rebuild's `DROP TABLE` cascades the children away, and the migration still
 * reports success. Refusing here beats discovering it in a deploy.
 */
const refused = [
  {
    pattern: /^PRAGMA\b/i,
    why: "D1 rejects most PRAGMAs, and D1 and a Durable Object both ignore `foreign_keys`",
  },
  {
    pattern: /^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i,
    why: "D1 and a Durable Object run a migration in their own transaction and refuse transaction control",
  },
  {
    pattern: /^(ATTACH|DETACH)\b/i,
    why: "D1 and a Durable Object answer SQLITE_AUTH to ATTACH and DETACH",
  },
  {
    pattern: /^VACUUM\b/i,
    why: "neither D1 nor a Durable Object can VACUUM from inside its transaction",
  },
];

function refuseWhatWorkersWillNotHonour(source: string, { sql, line }: Statement): void {
  for (const { pattern, why } of refused) {
    if (!pattern.test(sql)) continue;
    throw new Error(
      `${source}:${line}: ${why}, so this migration cannot be projected to D1 or a Durable Object:\n  ${sql}`,
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

/**
 * Writes both projections, replacing whatever was there: `vp run
 * db#generate:d1`, which `vp run db#generate` chains after drizzle-kit.
 */
export async function emitMigrations(): Promise<{ d1: string[]; durable: string[] }> {
  const projected = await projectMigrations(drizzleDir);
  const durable = await projectDurableMigrations(drizzleDir);
  await rm(migrationsDir, { recursive: true, force: true });
  await mkdir(migrationsDir, { recursive: true });
  for (const { name, sql } of projected) await writeFile(join(migrationsDir, name), sql);
  await writeFile(durableMigrationsFile, renderDurableMigrations(durable));
  return { d1: projected.map(({ name }) => name), durable: Object.keys(durable) };
}

if (import.meta.main) {
  const { d1, durable } = await emitMigrations();
  console.log(`wrote ${d1.length} D1 migrations to packages/db/migrations`);
  console.log(
    `wrote ${durable.length} Durable Object migrations to packages/db/src/durable-migrations.ts`,
  );
}
