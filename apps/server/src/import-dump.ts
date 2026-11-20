/**
 * A hosted Workspace, taken home (docs/OPERATIONS.md, "Taking a hosted
 * Workspace home"). What the hosted console hands over is the dump
 * `dumpDatabase` writes of the Workspace's Durable Object
 * (packages/adapters/src/durable/dump.ts) and its two secrets; this is what the
 * image does with the dump, the one place a Workspace goes home to (ADR-0037).
 *
 * It goes through a scratch SQLite database: the dump is loaded and checked to
 * be one deevy Workspace whose rows all hold together, migrated with the
 * migrator the server starts with, and moved into place.
 */
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "@deevy/adapters/node";
import { openSecret } from "@deevy/core";

/** Why an import did not happen, said to the person running it. Nothing was written. */
export class ImportRefused extends Error {
  override name = "ImportRefused";
}

/** What a Workspace's dump turned out to hold, and what the import did about it. */
export interface ImportReport {
  workspace: { name: string; slug: string };
  humans: number;
  agents: number;
  /** The addresses of the Humans who are its admins. */
  admins: string[];
  sockets: Array<{ id: string; name: string; provider: string; status: string }>;
  projects: number;
  events: number;
  /** The `seq` the next Event gets: the dump carries the counter, not only the rows. */
  nextSeq: number;
  /** The migrations this release has that the dump's did not, which the image applies on import. */
  migrations: string[];
  /**
   * Whether `DEEVY_SECRET` opens what is sealed under it, when one was given:
   * every Socket's credentials and webhook secret. `failed` names what did not
   * open.
   */
  sealed: { checked: number; failed: string[] } | null;
  /** Things worth knowing that did not stop the import. */
  warnings: string[];
}

export interface ImportOptions {
  /** Where the database goes (`DEEVY_DATABASE_PATH`). Nothing may be there yet. */
  path: string;
  /** The SQL `Platform.dump` handed over. */
  dump: string;
  /** Folder of drizzle's migrations: the image's `dist/drizzle`, packages/db/drizzle in a checkout. */
  migrationsFolder: string;
  /**
   * `BETTER_AUTH_URL`, when it is already known: what the Workspace answers at
   * from now on. Without it everything bound to an address is treated as bound
   * to the old one, which coming from hosted it always is.
   */
  baseURL?: string;
  /** `DEEVY_SECRET`, when it is set: checked against everything sealed under it. */
  socketSecret?: string;
}

/**
 * Loads a dump into a new database file at `path`, for the image to start on.
 *
 * Refused when `path` already holds a database with anything in it: a
 * Workspace is never merged into another, and one already in use is not
 * replaced. The new file is built beside the target and moved into place only
 * once it is complete, migrated and checked, so a refusal or a failure leaves
 * nothing behind and a server never opens half an import.
 *
 * A dump from an older release than this image is brought forward by the
 * image's own migrator, exactly as an upgrade on a volume would be; one from a
 * newer release is refused, because this image would run on a schema it does
 * not know.
 */
export async function importDump(options: ImportOptions): Promise<ImportReport> {
  const target = resolve(options.path);
  const placeholder = refuseExisting(target);
  mkdirSync(dirname(target), { recursive: true });
  const scratch = join(dirname(target), `.${basename(target)}.importing`);
  removeDatabase(scratch);
  try {
    const known = migrationNames(options.migrationsFolder);
    let pending: string[];
    {
      const db = new DatabaseSync(scratch);
      try {
        load(db, options.dump);
        pending = journalAgainst(db, known);
      } finally {
        db.close();
      }
    }
    // The server's own migrator, on the server's own terms: this is the first
    // time the image opens the file, and it is the same call it starts with.
    openDatabase({ path: scratch, migrationsFolder: options.migrationsFolder }).close();

    const db = new DatabaseSync(scratch);
    let report: ImportReport;
    try {
      const left = journalAgainst(db, known);
      if (left.length > 0) {
        throw new Error(`the migrator left ${left.join(", ")} unapplied`);
      }
      report = await inspect(db, options, pending);
      // Back into the one file, so it can move on its own.
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
    place(scratch, target, placeholder);
    return report;
  } finally {
    removeDatabase(scratch);
  }
}

/** The migration folders drizzle-kit wrote, in the order every migrator applies them. */
export function migrationNames(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    throw new Error(`no migrations found in ${folder}`);
  }
}

// -------------------------------------------------------------------- loading

const JOURNAL = "__drizzle_migrations";

/** The tables deevy itself must hold for a dump to be a Workspace's. */
const REQUIRED_TABLES = [JOURNAL, "workspace", "member", "user", "socket", "project", "event"];

/**
 * Runs the dump and refuses anything that is not exactly one deevy Workspace
 * whose rows hold together. Foreign keys are off while the dump loads (it says
 * so itself), so they are checked here, once, after.
 */
function load(db: DatabaseSync, dump: string): void {
  if (!dump.trimStart().startsWith("PRAGMA foreign_keys=OFF;")) {
    throw new ImportRefused(
      "That file is not a deevy Workspace's dump: the export the hosted console hands over starts with PRAGMA foreign_keys=OFF;.",
    );
  }
  try {
    db.exec(dump);
  } catch (error) {
    throw new ImportRefused(
      `The dump did not load: ${error instanceof Error ? error.message : String(error)}. Was the file cut short on its way here?`,
    );
  }
  // A dump cut off between two statements loads without a word and leaves its
  // transaction open, to be rolled back on close: everything, gone.
  if (db.isTransaction || !dump.trimEnd().endsWith("PRAGMA foreign_keys=ON;")) {
    throw new ImportRefused(
      "The dump stops before its end, so it is not the whole Workspace. Was the file cut short on its way here?",
    );
  }
  const missing = REQUIRED_TABLES.filter((table) => !hasTable(db, table));
  if (missing.length > 0) {
    throw new ImportRefused(
      `That dump is not a deevy Workspace's: it has no ${missing.join(", ")} table${missing.length > 1 ? "s" : ""}.`,
    );
  }
  const workspaces = count(db, "workspace");
  if (workspaces !== 1) {
    throw new ImportRefused(
      `That dump holds ${String(workspaces)} Workspaces, and a deevy of your own serves exactly one.`,
    );
  }
  const broken = db.prepare("PRAGMA foreign_key_check").all() as Array<{ table: string }>;
  if (broken.length > 0) {
    throw new ImportRefused(
      `${String(broken.length)} rows of the dump name a row it does not hold (the first in ${broken[0]!.table}), so it is not a whole Workspace.`,
    );
  }
  const integrity = db.prepare("PRAGMA quick_check").all() as Array<{ quick_check: string }>;
  if (integrity[0]?.quick_check !== "ok") {
    throw new ImportRefused(
      `The dump loaded into a database SQLite calls damaged: ${integrity[0]?.quick_check ?? "no answer"}.`,
    );
  }
}

function journal(db: DatabaseSync): string[] {
  return (
    db.prepare(`SELECT name FROM "${JOURNAL}" ORDER BY id`).all() as Array<{ name: string | null }>
  ).flatMap(({ name }) => (name === null ? [] : [name]));
}

/**
 * What this release would still apply to the dump, refusing one that has
 * applied a migration this release does not have.
 */
function journalAgainst(db: DatabaseSync, known: string[]): string[] {
  const applied = new Set(journal(db));
  const unknown = [...applied].filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new ImportRefused(
      `This dump was written by a newer deevy than this one: it has applied ${unknown.join(", ")}, which this release does not have. Import it with a release at least as new as the hosted one.`,
    );
  }
  return known.filter((name) => !applied.has(name));
}

// ----------------------------------------------------------------- reporting

async function inspect(
  db: DatabaseSync,
  options: ImportOptions,
  pending: string[],
): Promise<ImportReport> {
  const workspace = db.prepare("SELECT name, slug FROM workspace").get() as {
    name: string;
    slug: string;
  };
  const kinds = Object.fromEntries(
    (
      db.prepare("SELECT kind, count(*) AS n FROM member GROUP BY kind").all() as Array<{
        kind: string;
        n: number;
      }>
    ).map(({ kind, n }) => [kind, n]),
  );
  const admins = (
    db
      .prepare(
        `SELECT u.email FROM member m JOIN user u ON u.id = m.user_id
         WHERE m.kind = 'human' AND m.role = 'admin' ORDER BY m.created_at`,
      )
      .all() as Array<{ email: string }>
  ).map(({ email }) => email);
  const sockets = db
    .prepare("SELECT id, name, provider, status FROM socket ORDER BY created_at, id")
    .all() as ImportReport["sockets"];
  const highest = db
    .prepare(
      `SELECT max(coalesce((SELECT max(seq) FROM event), 0),
                  coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'event'), 0)) AS seq`,
    )
    .get() as { seq: number };
  return {
    workspace,
    humans: kinds.human ?? 0,
    agents: kinds.agent ?? 0,
    admins,
    sockets,
    projects: count(db, "project"),
    events: count(db, "event"),
    nextSeq: highest.seq + 1,
    migrations: pending,
    sealed: options.socketSecret ? await openEverySealed(db, options.socketSecret) : null,
    warnings: [],
  };
}

/** Everything sealed under `DEEVY_SECRET` (packages/core/src/secrets.ts), opened once to prove the secret. */
async function openEverySealed(
  db: DatabaseSync,
  secret: string,
): Promise<NonNullable<ImportReport["sealed"]>> {
  const sealed: Array<{ what: string; value: string }> = [];
  const socketRows = db
    .prepare("SELECT name, credentials, webhook_secret FROM socket ORDER BY created_at, id")
    .all() as Array<{ name: string; credentials: string | null; webhook_secret: string | null }>;
  for (const row of socketRows) {
    if (row.credentials)
      sealed.push({ what: `the ${row.name} Socket's credentials`, value: row.credentials });
    if (row.webhook_secret) {
      sealed.push({ what: `the ${row.name} Socket's webhook secret`, value: row.webhook_secret });
    }
  }
  // An email sender's credentials and an invitation's sealed link were sealed
  // too, until deevy stopped sending email (docs/plans/simplify.md, slice 8):
  // nothing reads them now, so whether they open is nobody's concern.
  const failed: string[] = [];
  for (const { what, value } of sealed) {
    try {
      await openSecret(secret, value);
    } catch {
      failed.push(what);
    }
  }
  return { checked: sealed.length, failed };
}

// -------------------------------------------------------------- the target

/** deevy's own bookkeeping, which a server writes on its first start before anybody signs in. */
const BOOKKEEPING = new Set([JOURNAL]);

/**
 * Refuses a target that already holds anything. Returns true when there is a
 * file there that holds nothing at all — no table, or no byte — which is
 * replaced.
 */
function refuseExisting(target: string): boolean {
  if (!existsSync(target)) {
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      if (existsSync(`${target}${suffix}`)) {
        throw new ImportRefused(
          `There is a ${basename(target)}${suffix} beside where the database goes but no database: remove it, since SQLite would read it into the new one, and import again.`,
        );
      }
    }
    return false;
  }
  if (statSync(target).size === 0) return true;

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(target);
    db.prepare("SELECT 1 FROM sqlite_master LIMIT 1").get();
  } catch (error) {
    throw new ImportRefused(
      `${target} is there and is not a database deevy can read (${error instanceof Error ? error.message : String(error)}). deevy imports into a new database only: give it another volume, or another DEEVY_DATABASE_PATH.`,
    );
  }
  try {
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
        )
        .all() as Array<{ name: string }>
    ).map(({ name }) => name);
    if (tables.length === 0) return true;
    const workspace = tables.includes("workspace")
      ? (db.prepare("SELECT name FROM workspace LIMIT 1").get() as { name: string } | undefined)
      : undefined;
    if (workspace) {
      throw new ImportRefused(
        `${target} already holds the Workspace "${workspace.name}". deevy imports into a new database only, never over or into one in use: give it another volume, or another DEEVY_DATABASE_PATH.`,
      );
    }
    const holding = tables.filter(
      (table) =>
        !BOOKKEEPING.has(table) &&
        db.prepare(`SELECT 1 FROM "${table.replaceAll('"', '""')}" LIMIT 1`).get(),
    );
    if (holding.length > 0) {
      throw new ImportRefused(
        `${target} already holds rows (in ${holding.slice(0, 5).join(", ")}${holding.length > 5 ? ", …" : ""}). deevy imports into a new database only: give it another volume, or another DEEVY_DATABASE_PATH.`,
      );
    }
    throw new ImportRefused(
      `${target} holds an empty deevy database, which a server started before the import made. Stop that server, remove ${basename(target)} and its -wal and -shm beside it, and import again.`,
    );
  } finally {
    db.close();
  }
}

/**
 * Moves the finished file into place without ever replacing a database: a
 * hard link fails when the target appeared in the meantime, which a rename
 * would silently overwrite. A filesystem without hard links gets the rename,
 * after one more look.
 */
function place(scratch: string, target: string, placeholder: boolean): void {
  if (placeholder) {
    // An empty database's journal is still a journal, and SQLite would read
    // one it found beside the file into the new one.
    for (const suffix of ["-wal", "-shm", "-journal"])
      rmSync(`${target}${suffix}`, { force: true });
    renameSync(scratch, target);
    return;
  }
  try {
    linkSync(scratch, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new ImportRefused(
        `Something created ${target} while the import ran, so it was left alone. Was a server started on it?`,
      );
    }
    if (existsSync(target)) throw error;
    renameSync(scratch, target);
  }
}

function removeDatabase(path: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"])
    rmSync(`${path}${suffix}`, { force: true });
}

// ------------------------------------------------------------------- helpers

function hasTable(db: DatabaseSync, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function count(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;
}
