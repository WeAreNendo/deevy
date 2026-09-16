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
  return { db, close: () => client.close() };
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
