import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { relations, workspace } from "@deevy/db";
import { migrations } from "@deevy/db/durable-migrations";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { describe, expect, it } from "vite-plus/test";
import { openDatabase } from "../src/node/index.ts";
import { createNodeDurableStorage } from "../src/testing/index.ts";

const migrationsFolder = new URL("../../db/drizzle", import.meta.url).pathname;

async function folders(): Promise<string[]> {
  return (await readdir(migrationsFolder, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function freshPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "deevy-durable-")), "deevy.sqlite");
}

/** Migrates the file at `path` the way a Durable Object does when it wakes. */
function migrateInDurableObject(path: string, only: Record<string, string> = migrations) {
  const storage = createNodeDurableStorage(path);
  try {
    return migrate(drizzle(storage, { relations }), { migrations: only });
  } finally {
    storage.close();
  }
}

/** Opens the file at `path` the way the Node server does, and says what it ran. */
function openOnNode(path: string) {
  const statements: string[] = [];
  const opened = openDatabase({
    path,
    migrationsFolder,
    logger: { logQuery: (query) => statements.push(query) },
  });
  opened.close();
  return statements;
}

function read<T>(path: string, query: string): T[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(query).all() as T[];
  } finally {
    db.close();
  }
}

function journal(path: string): string[] {
  return read<{ name: string }>(path, `SELECT name FROM "__drizzle_migrations" ORDER BY id`).map(
    ({ name }) => name,
  );
}

/**
 * Everything a migration built. The journal's own table is compared by its
 * columns instead, because each migrator writes its CREATE with different
 * whitespace and SQLite keeps the text as written.
 */
function schema(path: string) {
  return {
    objects: read(
      path,
      `SELECT type, name, tbl_name, sql FROM sqlite_master
       WHERE name <> '__drizzle_migrations' ORDER BY type, name`,
    ),
    journal: read(
      path,
      `SELECT name, type, "notnull", pk FROM pragma_table_info('__drizzle_migrations')`,
    ),
  };
}

function journalInserts(statements: string[]): string[] {
  return statements.filter((statement) => /insert into "__drizzle_migrations"/i.test(statement));
}

/**
 * A hosted Workspace keeps its database in a Durable Object, migrated by
 * drizzle's durable-sqlite migrator from `@deevy/db/durable-migrations` when the
 * object wakes. Leaving hosted deevy is a dump opened by the Docker image's
 * `openDatabase`, so the two migrators have to agree on what has been applied:
 * both record a migration by its folder's name and decide what is pending by
 * name alone. The durable migrator stores an empty hash where the Node one
 * stores the file's sha256, which neither reads once the journal has names.
 */
describe("a database migrated in a Durable Object", () => {
  it("takes every drizzle folder, in order, and journals each by its name", async () => {
    const path = await freshPath();

    expect(migrateInDurableObject(path)).toBeUndefined();

    expect(journal(path)).toEqual(await folders());
  });

  it("opens under openDatabase with nothing left to apply and the schema Node builds", async () => {
    const durable = await freshPath();
    migrateInDurableObject(durable);
    const node = await freshPath();
    openOnNode(node);

    const ran = openOnNode(durable);

    expect(journalInserts(ran)).toEqual([]);
    expect(journal(durable)).toEqual(await folders());
    expect(schema(durable)).toEqual(schema(node));
  });

  it("leaves a migration the object has not seen, and only that one, to Node", async () => {
    const path = await freshPath();
    const [latest] = (await folders()).slice(-1);
    migrateInDurableObject(
      path,
      Object.fromEntries(Object.entries(migrations).filter(([name]) => name !== latest)),
    );

    const ran = openOnNode(path);

    expect(journalInserts(ran)).toHaveLength(1);
    expect(journal(path)).toEqual(await folders());
  });

  it("has nothing to apply to a database the Node migrator built", async () => {
    const path = await freshPath();
    openOnNode(path);
    const before = schema(path);

    expect(migrateInDurableObject(path)).toBeUndefined();

    expect(journal(path)).toEqual(await folders());
    expect(schema(path)).toEqual(before);
  });

  it("is a database the durable driver reads and writes", async () => {
    const storage = createNodeDurableStorage();
    const db = drizzle(storage, { relations });
    migrate(db, { migrations });

    await db.insert(workspace).values({ id: "w1", name: "deevy", slug: "deevy" });

    expect((await db.query.workspace.findMany()).map(({ slug }) => slug)).toEqual(["deevy"]);
    storage.close();
  });
});

/**
 * The few places a Durable Object answers differently from a plain SQLite
 * connection, measured against `wrangler dev --local`. Each is a test that
 * would pass on the kinder answer and fail in production.
 */
describe("createNodeDurableStorage", () => {
  it("runs every statement in one exec and hands back the last one's rows", () => {
    const { sql, close } = createNodeDurableStorage();

    const rows = sql
      .exec("CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1); SELECT a FROM t WHERE a = ?", 1)
      .toArray();

    expect(rows).toEqual([{ a: 1 }]);
    expect(() => sql.exec("SELECT ? AS a; SELECT 1 AS b")).toThrow(
      "only the last statement can have parameters",
    );
    expect(() => sql.exec("SELECT 1 AS a; -- and a comment")).toThrow(
      "SQL code did not contain a statement.",
    );
    close();
  });

  it("answers one() with exactly one row or an error", () => {
    const { sql, close } = createNodeDurableStorage();

    expect(sql.exec("SELECT 5 AS v").one()).toEqual({ v: 5 });
    expect(() => sql.exec("SELECT 1 WHERE 0").one()).toThrow("but got no results.");
    expect(() => sql.exec("SELECT 1 UNION ALL SELECT 2").one()).toThrow(
      "but got multiple results.",
    );
    expect(sql.exec("SELECT 1 AS a, 2 AS b").raw().toArray()).toEqual([[1, 2]]);
    close();
  });

  it("refuses transaction control and rolls transactionSync back when it throws", () => {
    const storage = createNodeDurableStorage();
    const { sql } = storage;
    sql.exec("CREATE TABLE t (a INTEGER)");

    expect(() => sql.exec("BEGIN")).toThrow("transactionSync");
    expect(() =>
      storage.transactionSync(() => {
        sql.exec("INSERT INTO t VALUES (1)");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    storage.transactionSync(() => {
      sql.exec("INSERT INTO t VALUES (2)");
      try {
        storage.transactionSync(() => {
          sql.exec("INSERT INTO t VALUES (3)");
          throw new Error("inner");
        });
      } catch {
        // the inner one alone is undone
      }
    });

    expect(sql.exec("SELECT a FROM t").toArray()).toEqual([{ a: 2 }]);
    storage.close();
  });

  it("keeps foreign keys on and binds values as the object does", () => {
    const { sql, close } = createNodeDurableStorage();
    sql.exec(
      "CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (p INTEGER REFERENCES p(id))",
    );

    sql.exec("PRAGMA foreign_keys = OFF");

    expect(() => sql.exec("INSERT INTO c VALUES (5)")).toThrow("FOREIGN KEY constraint failed");
    expect(sql.exec("SELECT ? AS t, ? AS u", true, undefined).one()).toEqual({
      t: "true",
      u: null,
    });
    expect(sql.exec("SELECT ? AS b", new Uint8Array([1, 2]).buffer).one().b).toBeInstanceOf(
      ArrayBuffer,
    );
    close();
  });
});
