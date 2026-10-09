import {
  delivery as deliveryTable,
  event as eventTable,
  type Db,
  type deliveryTargets,
  type Event,
} from "@deevy/db";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

/**
 * The outbox's machinery, shared by every arm that sends something deevy owes
 * somewhere outside it: a Slack room or webhook, a chat tool, a tracker, a
 * subscribed URL, an email (schema/delivery.ts). Each arm decides what its
 * message says and where it goes; this is the part they have in common — the
 * due scan, the claim that makes two senders safe without a transaction, the
 * recording of what came back with its backoff, and retiring what can never
 * be sent.
 */

/** How a failed delivery waits before the next attempt. */
export interface Backoff {
  /** The wait after the first failure, doubling with every one after it. */
  firstMs: number;
  /** However many attempts have failed, the next is never further off than this. */
  ceilingMs: number;
  /** Spreads the retries, so a receiver coming back up is not hit by all of them at once. */
  jitter: boolean;
}

/**
 * How long a claim holds a delivery. Long enough for a POST that is timing out
 * to finish, short enough that a process dying mid-send costs one minute.
 */
export const deliveryLockMs = 60_000;

export interface DueDeliveriesQueryOptions {
  workspaceId: string;
  /** The clock this pass reads. */
  now: Date;
  limit: number;
  maxAttempts?: number;
}

/**
 * What is owed and due to one kind of destination, and each sweep's one scan:
 * `delivery_due_idx` is `(deliveredAt, nextAttemptAt)`, so the two leading
 * terms are the two this where clause opens with. There is deliberately no
 * ORDER BY, for the reason `dueRunsQuery` gives: sorting makes SQLite visit
 * every due row before the LIMIT applies, so one pass would cost the backlog.
 */
export function dueDeliveries(
  db: Db,
  target: (typeof deliveryTargets)[number] | Array<(typeof deliveryTargets)[number]>,
  { workspaceId, now, limit, maxAttempts }: Required<DueDeliveriesQueryOptions>,
) {
  return db
    .select({ id: deliveryTable.id })
    .from(deliveryTable)
    .where(
      and(
        isNull(deliveryTable.deliveredAt),
        lte(deliveryTable.nextAttemptAt, now),
        eq(deliveryTable.workspaceId, workspaceId),
        Array.isArray(target)
          ? inArray(deliveryTable.target, target)
          : eq(deliveryTable.target, target),
        // Out of attempts is given up on, not retried forever.
        lt(deliveryTable.attempts, maxAttempts),
        // Somebody else may be sending it right now.
        or(isNull(deliveryTable.lockedUntil), lt(deliveryTable.lockedUntil, now)),
      ),
    )
    .limit(limit);
}

/** One delivery this pass holds, and everything needed to render what it says. */
export interface Claimed {
  id: string;
  targetId: string;
  eventSeq: number;
  attempts: number;
}

/**
 * Takes the deliveries it can, and hands back only those it really took.
 *
 * This is what makes two senders safe without a transaction, which D1 does not
 * have (ADR-0006): the UPDATE re-checks the lock it read, and only the ids it
 * returns are sent, so two passes claim disjoint sets and no destination hears
 * the same Event twice.
 *
 * It also refuses to claim a delivery that has already landed, which is what
 * makes sending one provably idempotent rather than idempotent because the due
 * scan happens to filter it out (docs/plans/m3.md): a caller that names a row
 * directly — a queue message delivered twice, a Redeliver that raced a tick —
 * gets nothing back and so makes no request.
 */
export async function claimDeliveries(db: Db, ids: string[], now: Date): Promise<Claimed[]> {
  return db
    .update(deliveryTable)
    .set({ lockedUntil: new Date(now.getTime() + deliveryLockMs) })
    .where(
      and(
        inArray(deliveryTable.id, ids),
        isNull(deliveryTable.deliveredAt),
        or(isNull(deliveryTable.lockedUntil), lt(deliveryTable.lockedUntil, now)),
      ),
    )
    .returning({
      id: deliveryTable.id,
      targetId: deliveryTable.targetId,
      eventSeq: deliveryTable.eventSeq,
      attempts: deliveryTable.attempts,
    });
}

/** One claimed delivery, and what came back from sending it. */
export interface Attempted {
  id: string;
  delivered: boolean;
  status: number;
  error: string | null;
}

export interface Recorded {
  delivered: number;
  failed: number;
  /** The ids that just ran out of attempts, which nothing will look at again. */
  exhausted: string[];
}

/**
 * Writes down what came back, in one statement per distinct outcome. A
 * destination that is up answers every message the same way and one that is
 * down refuses them all the same way, so this is one UPDATE in practice and
 * bounded by the limit at worst.
 */
export async function recordOutcomes(
  db: Db,
  attempted: Attempted[],
  options: {
    now: Date;
    backoff: Backoff;
    maxAttempts: number;
    attemptsBefore: Map<string, number>;
  },
): Promise<Recorded> {
  const { now, backoff, maxAttempts, attemptsBefore } = options;
  const outcomes = new Map<string, Attempted[]>();
  for (const one of attempted) {
    const key = `${one.delivered}:${one.status}:${one.error ?? ""}`;
    const group = outcomes.get(key);
    if (group) group.push(one);
    else outcomes.set(key, [one]);
  }

  const recorded: Recorded = { delivered: 0, failed: 0, exhausted: [] };
  for (const group of outcomes.values()) {
    const [first] = group as [Attempted, ...Attempted[]];
    const ids = group.map((one) => one.id);
    if (first.delivered) {
      await db
        .update(deliveryTable)
        .set({
          deliveredAt: now,
          attempts: sql`${deliveryTable.attempts} + 1`,
          lockedUntil: null,
          lastStatus: first.status,
          lastError: null,
        })
        .where(inArray(deliveryTable.id, ids));
      recorded.delivered += group.length;
      continue;
    }
    // Jitter is a per-statement factor in thousandths rather than a value per
    // row: the backoff itself stays arithmetic SQLite does on the row's own
    // attempt count, so a retry needs no second read of what was just written.
    const spread = backoff.jitter ? 900 + Math.floor(Math.random() * 300) : 1000;
    await db
      .update(deliveryTable)
      .set({
        attempts: sql`${deliveryTable.attempts} + 1`,
        lockedUntil: null,
        lastStatus: first.status,
        lastError: first.error,
        nextAttemptAt: sql`${now.getTime()} + min(${backoff.firstMs} * (1 << ${deliveryTable.attempts}), ${backoff.ceilingMs}) * ${spread} / 1000`,
      })
      .where(inArray(deliveryTable.id, ids));
    recorded.failed += group.length;
  }

  // Out of attempts is not a failure to retry: nothing will look at these rows
  // again, because the due scan passes over anything at the ceiling.
  recorded.exhausted = attempted
    .filter((one) => !one.delivered && (attemptsBefore.get(one.id) ?? 0) + 1 >= maxAttempts)
    .map((one) => one.id);
  return recorded;
}

/**
 * Retires deliveries that can never be sent — the Channel or the subscription
 * they were owed to is gone — rather than retrying them to no purpose.
 */
export async function retireDeliveries(db: Db, ids: string[], reason: string, maxAttempts: number) {
  if (ids.length === 0) return;
  await db
    .update(deliveryTable)
    .set({ attempts: maxAttempts, lockedUntil: null, lastError: reason })
    .where(inArray(deliveryTable.id, ids));
}

/** The Events a pass is about to render messages from, in one statement. */
export async function eventsOf(db: Db, claimed: Claimed[]) {
  const rows = await db
    .select({
      seq: eventTable.seq,
      workspaceId: eventTable.workspaceId,
      kind: eventTable.kind,
      actorMemberId: eventTable.actorMemberId,
      subjectType: eventTable.subjectType,
      subjectId: eventTable.subjectId,
      projectId: eventTable.projectId,
      payload: eventTable.payload,
      createdAt: eventTable.createdAt,
    })
    .from(eventTable)
    .where(
      inArray(
        eventTable.seq,
        claimed.map((row) => row.eventSeq),
      ),
    );
  return new Map(rows.map((row) => [row.seq, row as unknown as Event]));
}
