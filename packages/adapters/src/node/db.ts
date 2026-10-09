import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { relations, type Db } from "@deevy/db";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

export interface OpenDatabaseOptions {
  /** File path, or ":memory:" for a throwaway database. */
  path: string;
  /** Folder holding drizzle-kit's generated migrations (packages/db/drizzle). */
  migrationsFolder: string;
  /**
   * Told about every statement drizzle runs, migrations included. deevy's own
   * budget test counts them with it, because on D1 the number of statements
   * one request runs is a limit rather than a detail (docs/plans/m3.md).
   */
  logger?: { logQuery: (query: string, params: unknown[]) => void };
}

export interface OpenedDatabase {
  db: Db;
  close: () => void;
}

/**
 * Opens (creating if needed) a SQLite database with Node's built-in driver and
 * applies pending migrations (ADR-0008). Foreign keys are switched off while
 * migrating because table rebuilds would otherwise cascade-delete children.
 */
export function openDatabase({
  path,
  migrationsFolder,
  logger,
}: OpenDatabaseOptions): OpenedDatabase {
  if (!hasMigrations(migrationsFolder)) {
    throw new Error(
      `no migrations found in ${migrationsFolder}; expected drizzle-kit output (<timestamp>_<name>/migration.sql)`,
    );
  }
  if (path !== ":memory:") mustBeWritable(path);
  const client = new DatabaseSync(path);
  if (path !== ":memory:") {
    // The result is read rather than discarded: SQLite does not fail a
    // `journal_mode` it cannot honour, it stays in `delete` and says nothing,
    // so this is the one answer that distinguishes a database this process can
    // write from one it can only read. mustBeWritable above catches the same
    // thing earlier and with a better message; this is the backstop for the
    // filesystems it cannot speak for.
    const mode = client.prepare("PRAGMA journal_mode = WAL").get() as
      | { journal_mode?: string }
      | undefined;
    if (mode?.journal_mode !== "wal")
      throw notWritable(path, `SQLite kept the journal in ${String(mode?.journal_mode)} mode`);
  }
  client.exec("PRAGMA foreign_keys = OFF");
  const db = drizzle({ client, relations, ...(logger ? { logger } : {}) });
  const failure = migrate(db, { migrationsFolder });
  if (failure) throw new Error(`migration failed: ${JSON.stringify(failure)}`);
  client.exec("PRAGMA foreign_keys = ON");
  const newer = migrationsFromANewerRelease(client, migrationsFolder);
  if (newer.length > 0) {
    console.warn(
      `this database has ${String(newer.length)} migration(s) this release does not know ` +
        `(${newer.join(", ")}): a newer deevy has run on it. A release runs on the schema of ` +
        "the one after it and no further, so if that was more than one release ahead, restore " +
        "the backup taken before it instead (docs/OPERATIONS.md, Upgrading).",
    );
  }
  return { db, close: () => client.close() };
}

/**
 * Migrations the database has and this build does not: a newer release ran
 * here, and this is the one before it, rolled back to. drizzle decides what is
 * pending by name alone and passes over the rest without a word, which is what
 * lets a release run on the next one's schema (ADR-0031). The operator is told
 * anyway, because only one release back is promised.
 */
function migrationsFromANewerRelease(client: DatabaseSync, migrationsFolder: string): string[] {
  const known = new Set(
    readdirSync(migrationsFolder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  const applied = client
    .prepare("SELECT name FROM __drizzle_migrations WHERE name IS NOT NULL ORDER BY id")
    .all() as Array<{ name: string }>;
  return applied.map(({ name }) => name).filter((name) => !known.has(name));
}

/**
 * deevy needs to write the database *and* the `-wal` and `-shm` files beside
 * it, so the directory matters as much as the file. The failure this prevents
 * is not a crash but a silence: the server would start, apply no migrations
 * because they are already applied, answer /healthz, and report healthy.
 */
function mustBeWritable(path: string): void {
  const dir = dirname(path);
  try {
    accessSync(dir, constants.W_OK | constants.X_OK);
  } catch {
    throw notWritable(path, `its directory ${dir} is not writable`);
  }
  if (existsSync(path)) {
    try {
      accessSync(path, constants.W_OK);
    } catch {
      throw notWritable(path, `${path} is not writable`);
    }
  }
}

function notWritable(path: string, because: string): Error {
  const uid = process.getuid?.();
  // Named rather than described: the whole point is that the person reading
  // this should not have to work out what to run (docs/OPERATIONS.md, Upgrading).
  const fix =
    uid === undefined
      ? `give ${dirname(path)} and anything already in it to the user deevy runs as`
      : `deevy runs as uid ${String(uid)}; with the container stopped, run\n` +
        `  docker run --rm -v deevy-data:/data alpine chown -R ${String(uid)}:${String(process.getgid?.() ?? uid)} /data`;
  return new Error(`cannot write the database at ${path}: ${because}. ${fix}`);
}

function hasMigrations(folder: string): boolean {
  try {
    return readdirSync(folder, { withFileTypes: true }).some((entry) => entry.isDirectory());
  } catch {
    return false;
  }
}
