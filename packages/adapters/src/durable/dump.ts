import type { DurableSqlValue, DurableStorage } from "./db.ts";

export interface DumpOptions {
  /** Rows read per statement. A page is one `exec`, so this bounds what is held at once. */
  pageSize?: number;
}

interface SchemaObject extends Record<string, DurableSqlValue> {
  type: string;
  name: string;
  tbl_name: string;
  sql: string;
}

/**
 * A logical dump of a Durable Object's database: SQL that rebuilds it in a
 * fresh SQLite file, one statement per item, each ending in ";\n". A Durable
 * Object keeps 30 days of point-in-time recovery and offers no export, so this
 * is the backup beyond that and a team's way home: the Docker image's
 * `openDatabase` opens what it builds with nothing to apply, because
 * `__drizzle_migrations` is dumped like any other table (ADR-0028).
 *
 * In order: every table's CREATE as SQLite keeps it, every row, the
 * AUTOINCREMENT counters (so an Event's `seq` is never handed out twice), then
 * the indexes, triggers and views, after the rows as `sqlite3 .dump` puts
 * them. SQLite's own tables and Cloudflare's (`_cf_*`, which hold the object's
 * key-value storage and are no part of the Workspace's database) are left out.
 *
 * Values are written by SQLite's own `quote()`, not by JavaScript: a Durable
 * Object reads an integer past 2^53 back as a rounded number, where `quote()`
 * writes it exactly, a REAL in as many digits as it takes to read back the
 * same, a blob as X'…', text with its quotes doubled, and NULL as NULL.
 *
 * Rows are read a page at a time, as the dump is pulled. It is a consistent
 * snapshot only if nothing writes in between: pull it to the end without
 * awaiting, or inside `blockConcurrencyWhile`, which is the hosted object's
 * job and not this function's.
 */
export function* dumpDatabase(
  storage: DurableStorage,
  { pageSize = 500 }: DumpOptions = {},
): Generator<string, void, undefined> {
  const objects = storage.sql
    .exec<SchemaObject>(
      `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid`,
    )
    .toArray()
    .filter(({ name, tbl_name }) => !internal(name) && !internal(tbl_name));
  const tables = objects.filter(({ type }) => type === "table");

  // node:sqlite and the sqlite3 shell honour this, so rows can go in table by
  // table without ordering them by their foreign keys (a Member names its
  // Sponsor, another Member). It is outside the transaction because SQLite
  // ignores it inside one, and a Durable Object, whose every statement is
  // inside one, ignores it altogether: this dump is for a plain SQLite file.
  yield "PRAGMA foreign_keys=OFF;\n";
  yield "BEGIN TRANSACTION;\n";
  for (const { sql } of tables) yield `${sql};\n`;
  for (const table of tables) yield* rowsOf(storage, table, pageSize);
  yield* counters(storage, new Set(tables.map(({ name }) => name)));
  for (const { sql } of objects.filter(({ type }) => type !== "table")) yield `${sql};\n`;
  yield "COMMIT;\n";
  yield "PRAGMA foreign_keys=ON;\n";
}

/** SQLite's own tables, and the ones Cloudflare keeps in every object's database. */
function internal(name: string): boolean {
  return name.startsWith("sqlite_") || name.startsWith("_cf_");
}

function* rowsOf(
  storage: DurableStorage,
  table: SchemaObject,
  pageSize: number,
): Generator<string, void, undefined> {
  // table_info leaves out generated columns, which cannot be inserted into.
  const columns = storage.sql
    .exec<{ name: string }>(`SELECT name FROM pragma_table_info(?) ORDER BY cid`, table.name)
    .toArray()
    .map(({ name }) => identifier(name));
  if (columns.length === 0) return;
  const into = `INSERT INTO ${identifier(table.name)} (${columns.join(", ")}) VALUES(`;
  const values = columns.map((column) => `quote(${column})`).join(` || ',' || `);
  const from = identifier(table.name);

  if (/\bwithout\s+rowid\b/i.test(table.sql)) {
    // No rowid to page by; the primary key orders it instead.
    for (let offset = 0; ; offset += pageSize) {
      const page = storage.sql
        .exec<{ v: string }>(
          `SELECT ${values} AS v FROM ${from} ORDER BY ${primaryKey(storage, table.name)} LIMIT ? OFFSET ?`,
          pageSize,
          offset,
        )
        .toArray();
      for (const { v } of page) yield `${into}${v});\n`;
      if (page.length < pageSize) return;
    }
  }

  // By rowid rather than by offset, so each page is one index seek however
  // far into the table it is.
  const select = `SELECT rowid AS r, ${values} AS v FROM ${from}`;
  for (let after: number | null = null; ;) {
    const page: Array<{ r: number; v: string }> = (
      after === null
        ? storage.sql.exec<{ r: number; v: string }>(`${select} ORDER BY rowid LIMIT ?`, pageSize)
        : storage.sql.exec<{ r: number; v: string }>(
            `${select} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
            after,
            pageSize,
          )
    ).toArray();
    for (const { v } of page) yield `${into}${v});\n`;
    if (page.length < pageSize) return;
    after = page[page.length - 1]!.r;
  }
}

function primaryKey(storage: DurableStorage, table: string): string {
  return storage.sql
    .exec<{ name: string }>(`SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk`, table)
    .toArray()
    .map(({ name }) => identifier(name))
    .join(", ");
}

/**
 * Where each AUTOINCREMENT table's counter stood. Inserting the rows already
 * moved it to the highest one; this puts it back where it was, which is higher
 * when the newest rows were deleted.
 */
function* counters(
  storage: DurableStorage,
  dumped: Set<string>,
): Generator<string, void, undefined> {
  const exists = storage.sql
    .exec(`SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'`)
    .toArray();
  if (exists.length === 0) return;
  const rows = storage.sql
    .exec<{ name: string; v: string }>(
      `SELECT name, quote(name) || ',' || quote(seq) AS v FROM sqlite_sequence ORDER BY name`,
    )
    .toArray()
    .filter(({ name }) => dumped.has(name));
  if (rows.length === 0) return;
  yield "DELETE FROM sqlite_sequence;\n";
  for (const { v } of rows) yield `INSERT INTO sqlite_sequence (name, seq) VALUES(${v});\n`;
}

function identifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
