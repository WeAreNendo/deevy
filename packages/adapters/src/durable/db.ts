import { relations } from "@deevy/db";
import type { Logger } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

/**
 * What SQLite hands a Durable Object back: a blob is an ArrayBuffer and every
 * integer a number, even past 2^53.
 */
export type DurableSqlValue = ArrayBuffer | string | number | null;

/**
 * The part of a SQLite-backed Durable Object's storage (`ctx.storage`) deevy
 * touches: `sql.exec` and the cursor it returns, and `transactionSync`. Written
 * out rather than taken from `@cloudflare/workers-types`, for the reason
 * `../workers/queue.ts` gives: this package compiles with `types: ["node"]`,
 * and the Workers globals would land on every consumer. The real storage is
 * assignable to it, and so is the Node-backed one in `@deevy/adapters/testing`.
 */
export interface DurableStorage {
  sql: {
    exec<T extends Record<string, DurableSqlValue>>(
      query: string,
      ...bindings: unknown[]
    ): DurableSqlCursor<T>;
  };
  /**
   * Runs `closure` in a transaction, committed when it returns and rolled back
   * when it throws. The closure must be synchronous: a promise it returns is
   * committed before it settles.
   */
  transactionSync<T>(closure: () => T): T;
}

export interface DurableSqlCursor<T extends Record<string, DurableSqlValue>> {
  toArray(): T[];
  /** The only row, or an error when there are none or several. */
  one(): T;
  raw<U extends DurableSqlValue[]>(): Iterable<U>;
}

/** The database a Durable Object holds: the core's `Db`, on drizzle's durable-sqlite driver. */
export type DurableDb = DrizzleSqliteDODatabase<typeof relations> & { $client: DurableStorage };

export interface CreateDurableDbOptions {
  /** Told about every statement drizzle runs, as `openDatabase`'s logger is. */
  logger?: Logger;
}

/**
 * Wraps a Durable Object's storage. Migrations are applied separately, by
 * `migrateDurable`, so an object can record a failed one rather than throw from
 * its constructor (ADR-0028).
 *
 * The driver is of the same synchronous kind as the Node one, with three
 * differences the core is written around rather than told about: a raw
 * `db.get(sql)` that finds no row throws (the lint bans it in the core), `run()`
 * reports no changed rows, and a transaction must be synchronous.
 */
export function createDurableDb(
  storage: DurableStorage,
  options: CreateDurableDbOptions = {},
): DurableDb {
  // drizzle types its client as the global `DurableObjectStorage`, which is
  // only declared where the Workers types are loaded. What it calls is exactly
  // `DurableStorage`, so the cast is to whatever that global is wherever this
  // is compiled.
  const client = storage as unknown as Parameters<typeof drizzle>[0];
  const db = drizzle(client, {
    relations,
    ...(options.logger ? { logger: options.logger } : {}),
  });
  return db as unknown as DurableDb;
}
