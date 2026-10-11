/**
 * A hosted Workspace, taken home (docs/OPERATIONS.md, "Taking a hosted
 * Workspace home"). What the hosted console hands over is the dump
 * `dumpDatabase` writes of the Workspace's Durable Object
 * (packages/adapters/src/durable/dump.ts) and its two secrets; this is what the
 * image does with the dump, and what a Worker of the team's own needs it to be
 * for D1.
 *
 * Both go through a scratch SQLite database: the dump is loaded, checked to be
 * one deevy Workspace whose rows all hold together, and what was bound to the
 * hosted address is forgotten. The image then migrates it with the migrator
 * the server starts with and moves it into place; D1 gets it back as SQL, by
 * the same writer, less what D1 refuses and with wrangler's journal in place of
 * drizzle's.
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
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  dumpDatabase,
  type DurableSqlCursor,
  type DurableSqlValue,
  type DurableStorage,
} from "@deevy/adapters/durable";
import { openDatabase } from "@deevy/adapters/node";
import { API_PATH, MCP_PATH, openSecret } from "@deevy/core";

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
  /**
   * Where the Workspace answered before, read off the OAuth resources its
   * authorization server registered (`<url>/mcp`); null when nothing says.
   */
  previousURL: string | null;
  /**
   * The migrations this release has that the dump's did not. The image applies
   * them on import; for D1 they are what `wrangler d1 migrations apply` applies
   * afterwards.
   */
  migrations: string[];
  /** What was bound to the old address and removed (see `forgetOldAddress`). */
  forgotten: { resources: number; tokens: number };
  /**
   * Whether `DEEVY_SECRET` opens what is sealed under it, when one was given:
   * every Socket's credentials and webhook secret, the email sender's
   * credentials, every invitation's link. `failed` names what did not open.
   */
  sealed: { checked: number; failed: string[] } | null;
  /** Things worth knowing that did not stop the import. */
  warnings: string[];
}

interface Common {
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

export interface ImportOptions extends Common {
  /** Where the database goes (`DEEVY_DATABASE_PATH`). Nothing may be there yet. */
  path: string;
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

/**
 * The dump as SQL for a new, empty D1 database: `wrangler d1 execute <db>
 * --remote --file`, in place of `wrangler d1 migrations apply` for the first
 * time. Three things differ from the dump itself, each because D1 would refuse
 * or misread it:
 *
 * - No transaction control and no `PRAGMA foreign_keys`: D1 runs the file in a
 *   transaction of its own and enforces foreign keys inside it, so the rows,
 *   which come table by table rather than in the order their keys need, go in
 *   under `PRAGMA defer_foreign_keys`, checked once at the end.
 * - wrangler's journal, `d1_migrations`, in place of drizzle's: D1 is only
 *   ever migrated by wrangler, which names a migration by its file in
 *   packages/db/migrations (`NNNN_<folder>.sql`), so each one the dump had
 *   applied is recorded under that name and `wrangler d1 migrations list`
 *   shows only what this release added since.
 * - A statement over D1's 100 KB limit is refused here, by table, rather than
 *   by D1 halfway through.
 */
export async function dumpForD1(options: Common): Promise<{ sql: string; report: ImportReport }> {
  const known = migrationNames(options.migrationsFolder);
  const db = new DatabaseSync(":memory:");
  try {
    load(db, options.dump);
    const pending = journalAgainst(db, known);
    const applied = journal(db);
    const report = await inspect(db, options, pending);
    db.exec(`DROP TABLE "${JOURNAL}"`);

    const statements: string[] = [D1_HEADER, "PRAGMA defer_foreign_keys = true;\n"];
    for (const item of dumpDatabase(storageOf(db))) {
      if (TRANSACTION_CONTROL.has(item)) continue;
      const bytes = encoder.encode(item).byteLength;
      if (bytes > D1_MAX_STATEMENT_BYTES) {
        throw new ImportRefused(
          `A row of ${tableOf(item)} is ${String(Math.ceil(bytes / 1000))} KB as a statement, and D1 refuses any over 100 KB. This Workspace can go to the image, which has no such limit, but not to D1.`,
        );
      }
      if (item.includes("BEGIN TRANSACTION")) {
        report.warnings.push(
          `A row of ${tableOf(item)} contains the words BEGIN TRANSACTION. wrangler's local d1 execute --file deletes them from the file wherever they are; --remote does not.`,
        );
      }
      statements.push(item);
    }
    statements.push(D1_JOURNAL);
    for (const name of applied) {
      statements.push(
        `INSERT INTO d1_migrations (name) VALUES(${quote(d1FileName(name, known))});\n`,
      );
    }
    return { sql: statements.join(""), report };
  } finally {
    db.close();
  }
}

/**
 * The file packages/db/migrations holds for a drizzle folder: its place among
 * this release's folders, then its name. The same rule
 * packages/db/scripts/emit-d1-migrations.ts writes them by, and migrations are
 * only ever added after the last, so a name means the same file in every later
 * release.
 */
export function d1FileName(folder: string, known: string[]): string {
  const index = known.indexOf(folder);
  if (index === -1) throw new Error(`${folder} is not one of this release's migrations`);
  return `${String(index + 1).padStart(4, "0")}_${folder}.sql`;
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

/** What `dumpDatabase` wraps the dump in, which D1 neither needs nor takes. */
const TRANSACTION_CONTROL = new Set([
  "PRAGMA foreign_keys=OFF;\n",
  "BEGIN TRANSACTION;\n",
  "COMMIT;\n",
  "PRAGMA foreign_keys=ON;\n",
]);

const encoder = new TextEncoder();

/** D1's limit on one SQL statement, in bytes (Cloudflare's D1 limits page). */
const D1_MAX_STATEMENT_BYTES = 100_000;

const D1_HEADER =
  "-- A deevy Workspace for a new, empty D1 database, written by `import.mjs --for-d1`.\n" +
  "-- Apply it in place of the first `wrangler d1 migrations apply`, never after one:\n" +
  "--   wrangler d1 execute deevy --remote --file <this file>\n" +
  "-- then `wrangler d1 migrations list deevy --remote` shows what is newer than the dump.\n";

/** Exactly what wrangler creates, so whichever of the two comes first the table is the same. */
const D1_JOURNAL = `CREATE TABLE IF NOT EXISTS d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
`;

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

// ------------------------------------------------------- the old address

/**
 * What was bound to the hosted address and is no good anywhere else. deevy is
 * an OAuth authorization server for a Human's MCP client and for the CLI, and
 * everything it issued names the address it was at (auth.ts,
 * `oauthServerPlugins`): its two protected resources, `<url>/mcp` and
 * `<url>/api`, and every access and refresh token, bound to those and to the
 * old issuer. None of them is accepted at the new address, so a client signs
 * in again either way; removing them is so that the Workspace holds no
 * credential for an address it no longer answers at. The resources at the new
 * address are registered by the server when it starts (Better Auth seeds them),
 * and registered clients, consents and the signing keys are kept.
 *
 * Nothing else deevy stores is bound to its address: a Socket's delivery
 * address, a Gate's link and an email's are all built from `BETTER_AUTH_URL`
 * as they are needed. What the tools themselves were told is theirs to be told
 * again, which is the operator's list, not this function's.
 */
function forgetOldAddress(
  db: DatabaseSync,
  baseURL: string | undefined,
): { previousURL: string | null; resources: number; tokens: number } {
  const identifiers = hasTable(db, "oauth_resource")
    ? (
        db.prepare("SELECT identifier FROM oauth_resource").all() as Array<{ identifier: string }>
      ).map(({ identifier }) => identifier)
    : [];
  const mcp = identifiers.find((identifier) => identifier.endsWith(MCP_PATH));
  const previousURL = mcp ? mcp.slice(0, -MCP_PATH.length) : null;
  const next = baseURL?.replace(/\/+$/, "");
  if (next !== undefined && next === previousURL) return { previousURL, resources: 0, tokens: 0 };

  const current = new Set(next === undefined ? [] : [`${next}${MCP_PATH}`, `${next}${API_PATH}`]);
  const stale = identifiers.filter((identifier) => !current.has(identifier));
  for (const identifier of stale) {
    if (hasTable(db, "oauth_client_resource")) {
      db.prepare("DELETE FROM oauth_client_resource WHERE resource_id = ?").run(identifier);
    }
    db.prepare("DELETE FROM oauth_resource WHERE identifier = ?").run(identifier);
  }
  let tokens = 0;
  // Access tokens first: one names the refresh token it was minted beside.
  for (const table of ["oauth_access_token", "oauth_refresh_token"]) {
    if (hasTable(db, table)) tokens += Number(db.prepare(`DELETE FROM "${table}"`).run().changes);
  }
  return { previousURL, resources: stale.length, tokens };
}

// ----------------------------------------------------------------- reporting

async function inspect(
  db: DatabaseSync,
  options: Common,
  pending: string[],
): Promise<ImportReport> {
  const forgotten = forgetOldAddress(db, options.baseURL);
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
    previousURL: forgotten.previousURL,
    migrations: pending,
    forgotten: { resources: forgotten.resources, tokens: forgotten.tokens },
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
  if (hasTable(db, "email_sender")) {
    for (const { credentials } of db
      .prepare("SELECT credentials FROM email_sender")
      .all() as Array<{
      credentials: string;
    }>) {
      sealed.push({ what: "the email sender's credentials", value: credentials });
    }
  }
  // From the release that sealed it; a dump from before then has no column for it.
  if (hasColumn(db, "invitation", "sealed_token")) {
    for (const { email, sealed_token } of db
      .prepare(
        `SELECT email, sealed_token FROM invitation
         WHERE sealed_token IS NOT NULL AND accepted_at IS NULL AND revoked_at IS NULL`,
      )
      .all() as Array<{ email: string; sealed_token: string }>) {
      sealed.push({ what: `the invitation link for ${email}`, value: sealed_token });
    }
  }
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
const BOOKKEEPING = new Set([JOURNAL, "oauth_resource", "jwks"]);

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

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ?").get(table, column),
  );
}

function count(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;
}

function quote(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/** The table a dump statement writes, for a message. */
function tableOf(statement: string): string {
  return /^INSERT INTO "((?:[^"]|"")+)"/.exec(statement)?.[1]?.replaceAll('""', '"') ?? "a table";
}

/**
 * A plain SQLite connection as the storage `dumpDatabase` reads, so the D1
 * file is written by the writer the dump was. It only ever reads.
 */
function storageOf(db: DatabaseSync): DurableStorage {
  return {
    sql: {
      exec<T extends Record<string, DurableSqlValue>>(
        query: string,
        ...bindings: unknown[]
      ): DurableSqlCursor<T> {
        const rows = db.prepare(query).all(...(bindings as SQLInputValue[])) as T[];
        return {
          toArray: () => rows,
          one: () => {
            if (rows.length !== 1) throw new Error(`expected one row, got ${String(rows.length)}`);
            return rows[0]!;
          },
          raw: <U extends DurableSqlValue[]>() => rows.map((row) => Object.values(row) as U),
        };
      },
    },
    transactionSync: (closure) => closure(),
  };
}
