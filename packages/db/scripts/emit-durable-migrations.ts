/**
 * Projects drizzle-kit's migrations into the form a Durable Object applies
 * (ADR-0008, ADR-0037): `packages/db/src/durable-migrations.ts`, which
 * drizzle's durable-sqlite migrator takes inside a hosted Workspace's object.
 * An object cannot read files, so the SQL has to be a module it imports.
 * drizzle-kit is still the only generator, the image's Node migrator reads its
 * folders as they are, and this is a committed rendering of them, diffed in CI
 * like openapi.json.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const drizzleDir = new URL("../drizzle/", import.meta.url).pathname;
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
 * something a Durable Object will not honour.
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
      for (const statement of statements) refuseWhatAnObjectWillNotHonour(source, statement);
      return { folder, source, sql, statements };
    }),
  );
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
    "// Generated from packages/db/drizzle by `vp run db#generate:durable`; edit packages/db/src/schema instead.",
    "//",
    "// A Durable Object cannot read files, so this is the form drizzle's durable-sqlite migrator takes:",
    "// each drizzle folder's name and its migration.sql, verbatim, in journal order, as",
    '// `migrate(db, { migrations })` from "drizzle-orm/durable-sqlite/migrator". It is reached only',
    "// through `@deevy/db/durable-migrations`, so nothing else bundles it. `vp run db#check:migrations`",
    "// fails when it is stale (packages/db/scripts/emit-durable-migrations.ts).",
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
 * drizzle marks its own statement boundaries with a comment. Each statement is
 * read on its own, so that a refusal can name the line it starts on.
 */
function statementsIn(sql: string): Statement[] {
  const statements: Statement[] = [];
  let line = 1;
  for (const chunk of sql.split(/-->[ \t]*statement-breakpoint/)) {
    // A comment above a statement is not part of it. What an object will not
    // take is recognised by how a statement starts, and a `-- deevy: contract` line on
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
 * Measured against a local Durable Object, not assumed, and a local D1 when
 * deevy still ran on one answered alike. The PRAGMA is the one that matters: an
 * object runs a migration inside a transaction, where SQLite ignores `PRAGMA
 * foreign_keys` — so the `PRAGMA foreign_keys=OFF` drizzle wraps around a
 * table rebuild, and that the Node migrator honours at the connection, is
 * accepted and does nothing, the rebuild's `DROP TABLE` cascades the children
 * away, and the migration still reports success. Refusing here beats
 * discovering it in a deploy.
 */
const refused = [
  {
    pattern: /^PRAGMA\b/i,
    why: "a Durable Object ignores `foreign_keys` inside the transaction it migrates in",
  },
  {
    pattern: /^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i,
    why: "a Durable Object runs a migration in its own transaction and refuses transaction control",
  },
  {
    pattern: /^(ATTACH|DETACH)\b/i,
    why: "a Durable Object answers SQLITE_AUTH to ATTACH and DETACH",
  },
  {
    pattern: /^VACUUM\b/i,
    why: "a Durable Object cannot VACUUM from inside its transaction",
  },
];

function refuseWhatAnObjectWillNotHonour(source: string, { sql, line }: Statement): void {
  for (const { pattern, why } of refused) {
    if (!pattern.test(sql)) continue;
    throw new Error(
      `${source}:${line}: ${why}, so this migration cannot run in a hosted Workspace:\n  ${sql}`,
    );
  }
}

/**
 * Writes the module, replacing whatever was there: `vp run db#generate:durable`,
 * which `vp run db#generate` chains after drizzle-kit.
 */
export async function emitMigrations(): Promise<string[]> {
  const durable = await projectDurableMigrations(drizzleDir);
  await writeFile(durableMigrationsFile, renderDurableMigrations(durable));
  return Object.keys(durable);
}

if (import.meta.main) {
  const durable = await emitMigrations();
  console.log(
    `wrote ${durable.length} Durable Object migrations to packages/db/src/durable-migrations.ts`,
  );
}
