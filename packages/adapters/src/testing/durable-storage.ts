import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

/**
 * A Durable Object's storage on Node's own SQLite, as much of it as drizzle's
 * `durable-sqlite` driver and migrator touch: `sql.exec`, the cursor's
 * `toArray`, `raw` and `one`, and `transactionSync`. It lets a test run what a
 * Durable Object runs without workerd, so a suite can take the durable driver
 * the way it takes the Node one.
 *
 * Where a Durable Object answers differently from a plain SQLite connection,
 * this answers as the object does, because a shim that is kinder than the real
 * thing passes the tests that production fails. Each of these was measured
 * against a local Durable Object (`wrangler dev --local`), not assumed:
 *
 * - `exec` runs every statement in its string, as the object does, where
 *   `node:sqlite` would quietly run only the first; only the last may take
 *   parameters, and the cursor is the last one's. Anything after the last
 *   statement but whitespace, a comment included, is an error.
 * - Every `exec` runs inside a transaction, as the object's do. That is what
 *   makes `PRAGMA foreign_keys = OFF` accepted and without effect (SQLite
 *   applies it as the statement is prepared, and not at all inside a
 *   transaction) and VACUUM an error. A failed statement does not undo the
 *   ones before it.
 * - Transaction control is refused: the object has `transactionSync` for that.
 * - A boolean is bound as the text "true" or "false", undefined as NULL, and a
 *   bigint is refused. A blob comes back as an ArrayBuffer, and an integer as
 *   a number even past 2^53.
 *
 * Written out rather than typed from `@cloudflare/workers-types`, for the
 * reason `../workers/queue.ts` gives.
 */
export interface NodeDurableStorage {
  sql: SqlStorage;
  /**
   * Runs `closure` in a transaction, committed when it returns and rolled back
   * when it throws. Nested calls nest, as the object's do.
   */
  transactionSync: <T>(closure: () => T) => T;
  /** Closes the connection underneath. Not part of a Durable Object's storage. */
  close: () => void;
}

export type SqlStorageValue = ArrayBuffer | string | number | null;

export interface SqlStorage {
  exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: unknown[]
  ): SqlStorageCursor<T>;
}

export interface SqlStorageCursor<T extends Record<string, SqlStorageValue>> {
  next(): IteratorResult<T, undefined>;
  toArray(): T[];
  /** The only row left, or an error saying there were none or several. */
  one(): T;
  raw<U extends SqlStorageValue[] = SqlStorageValue[]>(): RawCursor<U>;
  readonly columnNames: string[];
  [Symbol.iterator](): Iterator<T, undefined>;
}

/** What `raw()` returns: an iterator that also has the `toArray` drizzle calls on it. */
export interface RawCursor<U> {
  next(): IteratorResult<U, undefined>;
  toArray(): U[];
  [Symbol.iterator](): Iterator<U, undefined>;
}

/**
 * Opens one. `path` is a file, so that what a test migrated here can then be
 * opened by `openDatabase`, or ":memory:".
 */
export function createNodeDurableStorage(path = ":memory:"): NodeDurableStorage {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  return {
    sql: {
      exec: <T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]) =>
        // Kept even when a statement fails, as the object keeps what ran before it.
        withinSavepoint(db, "node_durable_storage_exec", () => exec<T>(db, query, bindings), {
          undoOnError: false,
        }),
    },
    transactionSync: (closure) =>
      withinSavepoint(db, "node_durable_storage_transaction", closure, { undoOnError: true }),
    close: () => db.close(),
  };
}

/**
 * SQLite stacks savepoints of the same name and releases or rolls back to the
 * innermost, so one name per purpose nests without counting. A statement that
 * fails badly enough can end the transaction on its own, which is why each step
 * after the body asks whether there still is one.
 */
function withinSavepoint<T>(
  db: DatabaseSync,
  name: string,
  body: () => T,
  { undoOnError }: { undoOnError: boolean },
): T {
  db.exec(`SAVEPOINT ${name}`);
  try {
    return body();
  } catch (error) {
    if (undoOnError && db.isTransaction) db.exec(`ROLLBACK TO ${name}`);
    throw error;
  } finally {
    if (db.isTransaction) db.exec(`RELEASE ${name}`);
  }
}

const transactionControl = /^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
const leadingTrivia = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/;

function exec<T extends Record<string, SqlStorageValue>>(
  db: DatabaseSync,
  query: string,
  bindings: unknown[],
): SqlStorageCursor<T> {
  let rest = query;
  for (;;) {
    const statement = prepare(db, rest);
    // SQLite compiles the first statement and hands back where it stopped;
    // node:sqlite keeps that to itself, but `sourceSQL` is exactly the text it
    // compiled, so the rest of the string is what follows it.
    const source = statement.sourceSQL;
    rest = rest.slice(source.length);
    const last = rest.trim() === "";
    if (!last && statement.expandedSQL !== source) {
      throw new Error(
        "When executing multiple SQL statements in a single call, only the last statement can have parameters.",
      );
    }
    if (transactionControl.test(source.replace(leadingTrivia, ""))) {
      throw new Error(
        "To execute a transaction, please use the state.storage.transaction() or " +
          "state.storage.transactionSync() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements.",
      );
    }
    const rows = run(statement, last ? bindings : []);
    if (last) {
      return cursor<T>(
        statement.columns().map(({ name }) => name),
        rows,
      );
    }
  }
}

function prepare(db: DatabaseSync, sql: string): StatementSync {
  try {
    return db.prepare(sql);
  } catch (error) {
    if (error instanceof Error && /contains no statements/.test(error.message)) {
      throw new Error("SQL code did not contain a statement.", { cause: error });
    }
    throw error;
  }
}

function run(statement: StatementSync, bindings: unknown[]): SqlStorageValue[][] {
  statement.setReturnArrays(true);
  statement.setReadBigInts(true);
  const rows = statement.all(...bindings.map(bind)) as unknown as unknown[][];
  return rows.map((row) => row.map(read));
}

function bind(value: unknown): SQLInputValue {
  if (value === undefined) return null;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "bigint") throw new TypeError("Cannot convert a BigInt value to a number");
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value as SQLInputValue;
}

function read(value: unknown): SqlStorageValue {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Uint8Array) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  }
  return value as SqlStorageValue;
}

function cursor<T extends Record<string, SqlStorageValue>>(
  columnNames: string[],
  rows: SqlStorageValue[][],
): SqlStorageCursor<T> {
  let position = 0;
  const nextRow = (): IteratorResult<SqlStorageValue[], undefined> =>
    position < rows.length
      ? { done: false, value: rows[position++]! }
      : { done: true, value: undefined };
  // A later column of the same name wins, as it does in the object.
  const asObject = (row: SqlStorageValue[]) =>
    Object.fromEntries(columnNames.map((name, index) => [name, row[index] ?? null])) as T;
  const drain = <V>(next: () => IteratorResult<V, undefined>): V[] => {
    const values: V[] = [];
    for (let step = next(); !step.done; step = next()) values.push(step.value);
    return values;
  };

  const next = (): IteratorResult<T, undefined> => {
    const step = nextRow();
    return step.done ? step : { done: false, value: asObject(step.value) };
  };
  const self: SqlStorageCursor<T> = {
    columnNames,
    next,
    toArray: () => drain(next),
    one() {
      const first = next();
      if (first.done) {
        throw new Error("Expected exactly one result from SQL query, but got no results.");
      }
      if (!next().done) {
        throw new Error("Expected exactly one result from SQL query, but got multiple results.");
      }
      return first.value;
    },
    raw<U extends SqlStorageValue[]>() {
      const nextRaw = nextRow as () => IteratorResult<U, undefined>;
      const raw: RawCursor<U> = {
        next: nextRaw,
        toArray: () => drain(nextRaw),
        [Symbol.iterator]: () => raw,
      };
      return raw;
    },
    [Symbol.iterator]: () => self,
  };
  return self;
}
