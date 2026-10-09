import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import {
  createDurableDb,
  type DurableDb,
  type DurableSqlValue,
  type DurableStorage,
} from "./db.ts";

/**
 * What applying the migrations came to. A failure is a value rather than a
 * throw, because a Durable Object that throws while it wakes is reset and
 * wakes again on the next request, to fail again: the hosted Worker records
 * this and answers 503 until a release fixes it (ADR-0028).
 */
export type DurableMigrationResult =
  | {
      /** The migrations this call applied, in order; empty when none were pending. */
      applied: string[];
      error: null;
    }
  | {
      /** Nothing: every pending migration is applied in one transaction, or none is. */
      applied: [];
      error: {
        /**
         * The migration that failed, or null when what failed was drizzle's own
         * bookkeeping (its journal table) rather than a migration.
         */
        migration: string | null;
        message: string;
      };
    };

const journal = "__drizzle_migrations";
const breakpoint = "--> statement-breakpoint";
const journalInsert = /^\s*insert\s+into\s+"__drizzle_migrations"/i;

/**
 * Applies what is pending of `migrations` (`@deevy/db/durable-migrations`) with
 * drizzle's durable-sqlite migrator, which journals each by its name in
 * `__drizzle_migrations` exactly as the Node migrator does, so a dump of this
 * database opens under `openDatabase` with nothing to apply. Every pending
 * migration runs in one `transactionSync`: all of them land or none does.
 *
 * Two things are added around drizzle's migrator. A chunk between statement
 * breakpoints that holds no statement is dropped, because a Durable Object
 * refuses to exec one where a Node connection shrugs. And a failure is caught
 * and said: the migrator answers any failure with drizzle's bare "Rollback",
 * so the statement that failed, and the migration it belongs to, are watched
 * for on the way past.
 */
export function migrateDurable(
  db: DurableDb,
  migrations: Record<string, string>,
): DurableMigrationResult {
  const storage = db.$client;
  const runnable = withoutEmptyChunks(migrations);
  const journaled: string[] = [];
  let failed: { query: string; error: unknown } | undefined;

  const watched: DurableStorage = {
    sql: {
      exec<T extends Record<string, DurableSqlValue>>(query: string, ...bindings: unknown[]) {
        try {
          const cursor = storage.sql.exec<T>(query, ...bindings);
          // The migrator writes a migration's journal row after its last
          // statement, with the name as the third value.
          if (journalInsert.test(query)) journaled.push(String(bindings[2]));
          return cursor;
        } catch (error) {
          failed = { query, error };
          throw error;
        }
      },
    },
    transactionSync: (closure) => storage.transactionSync(closure),
  };

  try {
    migrate(createDurableDb(watched), { migrations: runnable });
    return { applied: journaled, error: null };
  } catch (error) {
    return {
      applied: [],
      error: {
        migration: failed ? failedMigration(storage, runnable, journaled, failed.query) : null,
        message: messageOf(failed?.error ?? error),
      },
    };
  }
}

/**
 * Which migration `query` belongs to. Read after the rollback, so the journal
 * is what it was before this call: the pending migrations run in name order,
 * each journaled after its statements, so the one that failed is the first
 * pending one this call had not journaled yet — provided the statement that
 * failed is one of its own. Anything else failed in drizzle's bookkeeping.
 */
function failedMigration(
  storage: DurableStorage,
  migrations: Record<string, string>,
  journaledNow: string[],
  query: string,
): string | null {
  const before = new Set(journalNames(storage));
  const pending = Object.keys(migrations)
    .sort()
    .filter((name) => !before.has(name));
  const name = pending[journaledNow.length];
  if (name === undefined) return null;
  const own = migrations[name]!.split(breakpoint);
  return own.includes(query) || journalInsert.test(query) ? name : null;
}

function journalNames(storage: DurableStorage): string[] {
  const exists = storage.sql
    .exec(`SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?`, journal)
    .toArray();
  if (exists.length === 0) return [];
  return storage.sql
    .exec<{ name: string | null }>(`SELECT name FROM "${journal}"`)
    .toArray()
    .flatMap(({ name }) => (name === null ? [] : [name]));
}

/**
 * Each migration with the chunks that hold no statement left out. A Durable
 * Object answers an exec of only whitespace or comments with "SQL code did not
 * contain a statement", where a Node connection runs nothing and says nothing.
 * A migration with no statement at all still has to be journaled, and drizzle
 * refuses an empty one, so it runs `SELECT 1` instead.
 */
function withoutEmptyChunks(migrations: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(migrations).map(([name, sql]) => {
      const chunks = sql.split(breakpoint).filter(holdsAStatement);
      return [name, chunks.length > 0 ? chunks.join(breakpoint) : "SELECT 1"];
    }),
  );
}

const comments = /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;

function holdsAStatement(chunk: string): boolean {
  return chunk.replace(comments, "").replace(/;/g, "").trim() !== "";
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    // drizzle wraps a failed statement as "Failed query: …" with the cause
    // underneath, which is the part that says what went wrong.
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : error.message;
  }
  return String(error);
}
