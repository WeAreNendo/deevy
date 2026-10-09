import { DatabaseSync } from "node:sqlite";
import { workspace } from "@deevy/db";
import { migrations } from "@deevy/db/durable-migrations";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { describe, expect, it } from "vite-plus/test";
import {
  createAlarmJobQueue,
  createDurableDb,
  dumpDatabase,
  migrateDurable,
  type AlarmStorage,
  type DurableStorage,
} from "../src/durable/index.ts";
import { createNodeDurableStorage, type NodeDurableStorage } from "../src/testing/index.ts";

const names = Object.keys(migrations).sort();

function journal(storage: DurableStorage): string[] {
  return storage.sql
    .exec<{ name: string }>(`SELECT name FROM "__drizzle_migrations" ORDER BY id`)
    .toArray()
    .map(({ name }) => name);
}

function tables(storage: DurableStorage): string[] {
  return storage.sql
    .exec<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .toArray()
    .map(({ name }) => name);
}

/** A durable database with every migration applied, as an object has after it wakes. */
function migrated(): { storage: NodeDurableStorage; db: ReturnType<typeof createDurableDb> } {
  const storage = createNodeDurableStorage();
  const db = createDurableDb(storage);
  expect(migrateDurable(db, migrations).error).toBeNull();
  return { storage, db };
}

describe("createDurableDb", () => {
  it("is a database the core's queries run on", async () => {
    const { storage, db } = migrated();

    await db.insert(workspace).values({ id: "w1", name: "deevy", slug: "deevy" });

    expect(await db.query.workspace.findFirst({ columns: { slug: true } })).toEqual({
      slug: "deevy",
    });
    // A relational query that finds nothing is undefined, as on Node; only a
    // raw db.get throws, and the core does not use one (the lint says so).
    expect(await db.query.workspace.findFirst({ where: { id: "nobody" } })).toBeUndefined();
    storage.close();
  });
});

describe("migrateDurable", () => {
  it("applies every migration once, in order, and then has nothing to do", () => {
    const storage = createNodeDurableStorage();
    const db = createDurableDb(storage);

    expect(migrateDurable(db, migrations)).toEqual({ applied: names, error: null });
    expect(migrateDurable(db, migrations)).toEqual({ applied: [], error: null });

    expect(journal(storage)).toEqual(names);
    storage.close();
  });

  it("applies only what the object has not seen", () => {
    const storage = createNodeDurableStorage();
    const db = createDurableDb(storage);
    const latest = names.at(-1)!;
    migrateDurable(
      db,
      Object.fromEntries(Object.entries(migrations).filter(([n]) => n !== latest)),
    );

    expect(migrateDurable(db, migrations)).toEqual({ applied: [latest], error: null });
    storage.close();
  });

  it("skips a chunk that holds no statement, which a Durable Object refuses to exec", () => {
    const { storage, db } = migrated();
    const extra = {
      ...migrations,
      "20990101000000_spaced":
        "\n--> statement-breakpoint\nCREATE TABLE `spaced` (`a` integer);\n--> statement-breakpoint\n  -- only a comment\n--> statement-breakpoint\n",
      "20990102000000_nothing": "  \n",
    };
    // What drizzle's migrator does with the same chunk on its own.
    expect(() =>
      migrate(drizzle(storage), {
        migrations: { ...migrations, "20990101000000_spaced": extra["20990101000000_spaced"] },
      }),
    ).toThrow();

    expect(migrateDurable(db, extra)).toEqual({
      applied: ["20990101000000_spaced", "20990102000000_nothing"],
      error: null,
    });

    expect(tables(storage)).toContain("spaced");
    expect(journal(storage).slice(-2)).toEqual(["20990101000000_spaced", "20990102000000_nothing"]);
    storage.close();
  });

  it("says which migration failed and why, and applies none of what was pending", () => {
    const storage = createNodeDurableStorage();
    const db = createDurableDb(storage);
    const broken = {
      ...migrations,
      "20990101000000_fine": "CREATE TABLE `fine` (`a` integer);",
      "20990102000000_broken":
        "CREATE TABLE `half` (`a` integer);\n--> statement-breakpoint\nCREATE TABLE `workspace` (`a` integer);",
    };

    const result = migrateDurable(db, broken);

    expect(result).toEqual({
      applied: [],
      error: {
        migration: "20990102000000_broken",
        message: expect.stringContaining("already exists"),
      },
    });
    // One transaction: not even the migrations before it are kept.
    expect(tables(storage)).toEqual([]);
    storage.close();
  });

  it("names the migration that failed, not an applied one with the same statement", () => {
    const { storage, db } = migrated();
    const statement = "CREATE TABLE `twice` (`a` integer);";
    migrateDurable(db, { ...migrations, "20990101000000_first": statement });

    const result = migrateDurable(db, {
      ...migrations,
      "20990101000000_first": statement,
      "20990102000000_again": statement,
    });

    expect(result.error).toEqual({
      migration: "20990102000000_again",
      message: expect.stringContaining("already exists"),
    });
    storage.close();
  });

  it("names no migration when what failed was the journal itself", () => {
    const storage = createNodeDurableStorage();
    const refusing: DurableStorage = {
      sql: {
        exec(query, ...bindings) {
          if (/CREATE TABLE IF NOT EXISTS "__drizzle_migrations"/.test(query)) {
            throw new Error("SQLITE_AUTH: not authorized");
          }
          return storage.sql.exec(query, ...bindings);
        },
      },
      transactionSync: storage.transactionSync,
    };

    expect(migrateDurable(createDurableDb(refusing), migrations)).toEqual({
      applied: [],
      error: { migration: null, message: "SQLITE_AUTH: not authorized" },
    });
    storage.close();
  });
});

describe("the alarm job queue", () => {
  function alarm(initial: number | null) {
    const set: number[] = [];
    let current = initial;
    const storage: AlarmStorage = {
      getAlarm: () => Promise.resolve(current),
      setAlarm: (time) => {
        set.push(time);
        current = time;
        return Promise.resolve();
      },
    };
    return { storage, set };
  }
  const now = () => 1_000_000;
  const job = { kind: "webhook.delivery", id: "whd_1" };

  it("sets the alarm to now when none is set", async () => {
    const { storage, set } = alarm(null);

    await createAlarmJobQueue(storage, { now }).enqueue(job);

    expect(set).toEqual([1_000_000]);
  });

  it("brings a later alarm forward and leaves an earlier one alone", async () => {
    const later = alarm(5_000_000);
    const earlier = alarm(999_000);

    await createAlarmJobQueue(later.storage, { now }).enqueue(job);
    await createAlarmJobQueue(earlier.storage, { now }).enqueue(job);

    expect(later.set).toEqual([1_000_000]);
    expect(earlier.set).toEqual([]);
  });

  it("waits as long as the job asks, and no longer than an alarm already set", async () => {
    const unset = alarm(null);
    const sooner = alarm(1_010_000);

    await createAlarmJobQueue(unset.storage, { now }).enqueue({ ...job, delaySeconds: 30 });
    await createAlarmJobQueue(sooner.storage, { now }).enqueue({ ...job, delaySeconds: 30 });

    expect(unset.set).toEqual([1_030_000]);
    expect(sooner.set).toEqual([]);
  });

  it("never throws or rejects, as the port requires", async () => {
    const rejecting: AlarmStorage = {
      getAlarm: () => Promise.reject(new Error("storage reset")),
      setAlarm: () => Promise.resolve(),
    };
    const throwing: AlarmStorage = {
      getAlarm: () => Promise.resolve(null),
      setAlarm: () => {
        throw new Error("thrown, not rejected");
      },
    };

    await expect(createAlarmJobQueue(rejecting).enqueue(job)).resolves.toBeUndefined();
    await expect(createAlarmJobQueue(throwing).enqueue(job)).resolves.toBeUndefined();
  });
});

/** Loads a dump into a fresh node:sqlite database, as `deevy import` will. */
function restore(dump: string): DatabaseSync {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  db.exec(dump);
  return db;
}

/** Every value of every row as SQLite would write it, so two databases compare exactly. */
function quoted(db: { all: (query: string) => unknown[] }, table: string, columns: string[]) {
  return db.all(
    `SELECT ${columns.map((c) => `typeof("${c}") || ':' || quote("${c}")`).join(" || ' ' || ")} AS v
     FROM "${table.replaceAll('"', '""')}" ORDER BY rowid`,
  );
}

const onStorage = (storage: DurableStorage) => ({
  all: (query: string) => storage.sql.exec(query).toArray(),
});
const onNode = (db: DatabaseSync) => ({ all: (query: string) => db.prepare(query).all() });

describe("dumpDatabase", () => {
  it("writes every value back exactly, the ones JavaScript cannot hold included", () => {
    const storage = createNodeDurableStorage();
    storage.sql.exec(`CREATE TABLE "odd ""name""" (t text, b blob, i integer, r real, n)`);
    storage.sql.exec(
      `INSERT INTO "odd ""name""" VALUES
         ('it''s', X'00FF10', 1152921504606846977, 0.30000000000000004, NULL),
         ('two
lines; and -- not a comment', X'', -9223372036854775808, 1e300, 'text in an untyped column'),
         ('', NULL, 0, -0.5, 42),
         ('émoji 🦆 and NUL-free unicode', NULL, NULL, NULL, X'DEADBEEF')`,
    );
    const columns = ["t", "b", "i", "r", "n"];

    const restored = restore([...dumpDatabase(storage)].join(""));

    expect(quoted(onNode(restored), 'odd "name"', columns)).toEqual(
      quoted(onStorage(storage), 'odd "name"', columns),
    );
    restored.close();
    storage.close();
  });

  it("pages through a table however its rows are keyed", () => {
    const storage = createNodeDurableStorage();
    storage.sql.exec(`CREATE TABLE plain (a text)`);
    storage.sql.exec(`CREATE TABLE keyed (k text PRIMARY KEY, a integer) WITHOUT ROWID`);
    for (let i = 0; i < 7; i += 1) {
      storage.sql.exec(`INSERT INTO plain VALUES (?)`, `row ${String(i)}`);
      storage.sql.exec(`INSERT INTO keyed VALUES (?, ?)`, `key ${String(i)}`, i);
    }

    const restored = restore([...dumpDatabase(storage, { pageSize: 3 })].join(""));

    expect(restored.prepare(`SELECT count(*) AS n FROM plain`).get()).toEqual({ n: 7 });
    expect(restored.prepare(`SELECT group_concat(a) AS a FROM keyed ORDER BY k`).get()).toEqual({
      a: "0,1,2,3,4,5,6",
    });
    restored.close();
    storage.close();
  });

  it("leaves out Cloudflare's own tables and keeps the AUTOINCREMENT counter where it stood", () => {
    const storage = createNodeDurableStorage();
    storage.sql.exec(`CREATE TABLE _cf_KV (key text PRIMARY KEY, value blob)`);
    storage.sql.exec(`INSERT INTO _cf_KV VALUES ('config', X'01')`);
    storage.sql.exec(`CREATE TABLE event (seq integer PRIMARY KEY AUTOINCREMENT, kind text)`);
    storage.sql.exec(`INSERT INTO event (kind) VALUES ('one'), ('two'), ('three')`);
    storage.sql.exec(`DELETE FROM event WHERE seq = 3`);

    const dump = [...dumpDatabase(storage)].join("");
    const restored = restore(dump);
    restored.exec(`INSERT INTO event (kind) VALUES ('four')`);

    expect(dump).not.toContain("_cf_");
    expect(restored.prepare(`SELECT seq, kind FROM event ORDER BY seq`).all()).toEqual([
      { seq: 1, kind: "one" },
      { seq: 2, kind: "two" },
      { seq: 4, kind: "four" },
    ]);
    restored.close();
    storage.close();
  });

  it("restores rows whose foreign keys point at a table dumped after them", () => {
    const storage = createNodeDurableStorage();
    storage.sql.exec(
      `CREATE TABLE child (id integer PRIMARY KEY, parent integer NOT NULL REFERENCES parent(id))`,
    );
    storage.sql.exec(
      `CREATE TABLE parent (id integer PRIMARY KEY, sponsor integer REFERENCES parent(id))`,
    );
    storage.sql.exec(`CREATE UNIQUE INDEX child_parent ON child (parent)`);
    storage.transactionSync(() => {
      storage.sql.exec(`INSERT INTO parent VALUES (1, 2), (2, NULL)`);
      storage.sql.exec(`INSERT INTO child VALUES (10, 1)`);
    });

    const restored = restore([...dumpDatabase(storage)].join(""));

    expect(restored.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
    expect(restored.prepare(`PRAGMA foreign_keys`).get()).toEqual({ foreign_keys: 1 });
    expect(
      restored.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all(),
    ).toContainEqual({ name: "child_parent" });
    restored.close();
    storage.close();
  });
});
