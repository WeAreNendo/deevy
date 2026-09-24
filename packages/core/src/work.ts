import {
  agent as agentTable,
  channel as channelTable,
  delivery as deliveryTable,
  event as eventTable,
  issue as issueTable,
  member as memberTable,
  notification as notificationTable,
  project as projectTable,
  run as runTable,
  webhookSubscription as webhookSubscriptionTable,
  type Db,
  type deliveryTargets,
  type Event,
} from "@deevy/db";
import { and, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { EventKind } from "./events.ts";
import {
  deriveNotifications,
  isHumanNotificationKind,
  issueOf,
  notificationKindOf,
} from "./notifications.ts";
import { openStatuses } from "./runs.ts";
import { postSlackMessage, slackMessage, type FetchLike, type SlackPayload } from "./slack.ts";
import { deriveWebhookDeliveriesForMany, postWebhook } from "./webhooks.ts";
import { newId } from "./ids.ts";

/**
 * Background work, expressed the only way ADR-0006 allows: a bounded function
 * of its arguments that any scheduler can call. No timer lives here — the
 * `Cron` port in jobs.ts brings one — and no scan is unbounded, because M3
 * drives these from a Cloudflare Cron Trigger with a 10 ms CPU budget.
 *
 * The shape every sweep keeps: one indexed SELECT with a LIMIT, one batched
 * UPDATE, and one Event insert per chunk. Never a query per row.
 */

/** Thirty minutes of silence, the window PLAN.md and Linear both settled on. */
export const defaultSilenceMs = 30 * 60_000;

/** How many Runs one pass may move. `more` tells the caller to go again. */
export const defaultSweepLimit = 50;

/**
 * D1 accepts 100 bound parameters per statement and each Event row binds five,
 * so the Events go in chunks of twenty rather than one statement of `limit`
 * rows. The number of statements stays a function of the limit, never of the
 * Workspace. Adding a column to these rows means lowering this number.
 */
const eventRowsPerInsert = 20;

/** The same arithmetic for a Run row, which also binds five columns. */
const runRowsPerInsert = 20;

/**
 * And for a `run.started` Event, which carries a payload as well and so binds
 * six columns rather than five.
 */
const runStartedRowsPerInsert = 16;

/**
 * Where deevy is waiting on the Agent and silence means something is wrong.
 * `awaiting_input` is missing on purpose: that Run is waiting on a Human, and
 * `statusAfterAnswer` in runs.ts only un-blocks a Run that is still
 * `awaiting_input`, so sweeping one would strand the answer.
 */
const sweepableStatuses = ["pending", "active"] as const;

export interface DueRunsQueryOptions {
  workspaceId: string;
  /** Runs quiet since before this are due. */
  cutoff: Date;
  limit: number;
}

/**
 * The sweep's one scan, and the reason it fits a Cron Trigger's CPU budget:
 * `run_status_lastActivityAt_idx` answers it, and the two joins are
 * primary-key lookups that scope it to this Workspace and carry the Project
 * each Event belongs to, so nothing has to be looked up per row afterwards.
 *
 * There is deliberately no ORDER BY. Sorting makes SQLite visit every due Run
 * before applying the LIMIT (`USE TEMP B-TREE FOR ORDER BY`), which would make
 * one pass cost the whole backlog — the one thing the limit exists to prevent.
 * The index still hands back the longest silences first within each status,
 * and `more` brings the caller back for the rest.
 *
 * Exported so a test can EXPLAIN it: the query plan is the guarantee.
 */
export function dueRunsQuery(db: Db, { workspaceId, cutoff, limit }: DueRunsQueryOptions) {
  return db
    .select({ id: runTable.id, projectId: issueTable.projectId })
    .from(runTable)
    .innerJoin(issueTable, eq(issueTable.id, runTable.issueId))
    .innerJoin(projectTable, eq(projectTable.id, issueTable.projectId))
    .where(
      and(
        inArray(runTable.status, [...sweepableStatuses]),
        lt(runTable.lastActivityAt, cutoff),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(limit);
}

export interface SweepStaleRunsOptions {
  db: Db;
  workspaceId: string;
  /** The clock, so a test does not have to wait thirty minutes. */
  now?: Date;
  /** Silence after which a Run is presumed stale. */
  silenceMs?: number;
  /** Most Runs to move in one pass. */
  limit?: number;
}

export interface SweepResult {
  /** Due Runs this pass found. */
  scanned: number;
  /** Runs it actually moved; fewer when something else moved one first. */
  changed: number;
  /** The limit was reached, so call again rather than raising the limit. */
  more: boolean;
}

/**
 * Moves Runs that have gone quiet to `stale` and records why. `stale` is
 * recoverable, never terminal (docs/plans/m2.md): the next Activity puts the
 * Run back to `active`, which is why nothing here is finished or cleaned up.
 */
export async function sweepStaleRuns({
  db,
  workspaceId,
  now = new Date(),
  silenceMs = defaultSilenceMs,
  limit = defaultSweepLimit,
}: SweepStaleRunsOptions): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - silenceMs);
  const due = await dueRunsQuery(db, { workspaceId, cutoff, limit });

  const result = { scanned: due.length, changed: 0, more: due.length >= limit };
  if (due.length === 0) return result;

  // One statement, and it re-checks the status it read: D1 has no interactive
  // transactions (ADR-0006), so a Run the Agent revived between the SELECT and
  // here must not be dragged back. RETURNING says which ones really moved, and
  // only those get an Event.
  const moved = await db
    .update(runTable)
    .set({ status: "stale" })
    .where(
      and(
        inArray(
          runTable.id,
          due.map((row) => row.id),
        ),
        inArray(runTable.status, [...sweepableStatuses]),
      ),
    )
    .returning({ id: runTable.id });

  result.changed = moved.length;
  if (moved.length === 0) return result;

  // lastActivityAt is left alone: it is the record of when the Agent last
  // spoke, and the sweep is not the Agent speaking.
  //
  // These Events are written directly rather than through `appendEvent`. The
  // sweep is the one writer that is not a request; `run.went_stale` derives no
  // Notification, because a Human hears about silence from the Run's own
  // status; and one `appendEvent` per row would make the sweep's cost grow
  // with the Workspace, which is the one thing it must not do. Delivery is
  // still owed, so it is derived in bulk after the insert.
  const projectOf = new Map(due.map((row) => [row.id, row.projectId]));
  const rows = moved.map(({ id }) => ({
    workspaceId,
    kind: "run.went_stale" satisfies EventKind,
    subjectType: "run",
    subjectId: id,
    projectId: projectOf.get(id) ?? null,
  }));
  const written: Array<{ seq: number; kind: EventKind; projectId: string | null }> = [];
  for (let at = 0; at < rows.length; at += eventRowsPerInsert) {
    const inserted = await db
      .insert(eventTable)
      .values(rows.slice(at, at + eventRowsPerInsert))
      .returning({ seq: eventTable.seq, kind: eventTable.kind, projectId: eventTable.projectId });
    written.push(...(inserted as typeof written));
  }
  await deriveWebhookDeliveriesForMany(
    db,
    workspaceId,
    written.map((row) => ({ ...row, workspaceId })),
  );

  return result;
}

export interface DueAgentsQueryOptions {
  workspaceId: string;
  /** The clock this pass reads. */
  now: Date;
  limit: number;
}

/**
 * The Agents whose schedule has come round: never run, or last run longer ago
 * than their own interval. A suspended Agent is not due, which is the Sponsor
 * cascade doing its job (docs/plans/m2.md).
 *
 * Exported so a test can EXPLAIN it. There is one `agent` row per Agent and a
 * Workspace has a handful, so this is bounded by the Workspace's Agents and by
 * the LIMIT, never by its Issues.
 */
export function dueAgentsQuery(db: Db, { workspaceId, now, limit }: DueAgentsQueryOptions) {
  return db
    .select({ memberId: agentTable.memberId })
    .from(agentTable)
    .innerJoin(memberTable, eq(memberTable.id, agentTable.memberId))
    .where(
      and(
        isNotNull(agentTable.scheduleMinutes),
        eq(memberTable.workspaceId, workspaceId),
        isNull(memberTable.suspendedAt),
        or(
          isNull(agentTable.scheduleRanAt),
          // Minutes, in the millisecond column the row already holds, so the
          // comparison is arithmetic SQLite does rather than a row per Agent
          // read back into JavaScript.
          sql`${agentTable.scheduleRanAt} <= ${now.getTime()} - ${agentTable.scheduleMinutes} * 60000`,
        ),
      ),
    )
    .limit(limit);
}

export interface ScheduledIssuesQueryOptions {
  agentMemberIds: string[];
  limit: number;
}

/**
 * The Issues a due Agent owes a Run: assigned to it, still open, and with no
 * open Run of its own. The "at most one open Run per (issue, agent)" rule is
 * the anti-join rather than a lookup per Issue, which is what keeps this one
 * statement (runs.ts holds the same rule for every other path).
 *
 * A closed Issue is left alone. A schedule is for work still to do, and an
 * Issue that reached a `done` State has none; the plan does not say, and this
 * is the reading that does not wake an Agent hourly for the rest of time.
 *
 * Exported so a test can EXPLAIN it: `issue_assignee_idx` answers the scan and
 * `run_agent_status_idx` answers the anti-join.
 */
export function scheduledIssuesQuery(
  db: Db,
  { agentMemberIds, limit }: ScheduledIssuesQueryOptions,
) {
  return db
    .select({
      id: issueTable.id,
      projectId: issueTable.projectId,
      agentMemberId: issueTable.assigneeMemberId,
    })
    .from(issueTable)
    .leftJoin(
      runTable,
      and(
        eq(runTable.issueId, issueTable.id),
        eq(runTable.agentMemberId, issueTable.assigneeMemberId),
        inArray(runTable.status, [...openStatuses]),
      ),
    )
    .where(
      and(
        inArray(issueTable.assigneeMemberId, agentMemberIds),
        eq(issueTable.state, "open"),
        isNull(runTable.id),
      ),
    )
    .limit(limit);
}

export interface SweepSchedulesOptions {
  db: Db;
  workspaceId: string;
  /** The clock, so a test does not have to wait an hour. */
  now?: Date;
  /** Most Agents to consider, and most Runs to start, in one pass. */
  limit?: number;
}

export interface ScheduleSweepResult {
  /** Agents whose schedule came round this pass. */
  due: number;
  /** Runs it started. */
  started: number;
  /** The limit was reached, so call again rather than raising the limit. */
  more: boolean;
}

/**
 * The schedule trigger (PLAN.md): each Agent whose interval has elapsed gets
 * one Run per Issue assigned to it that has no open Run.
 *
 * Bounded exactly like `sweepStaleRuns`, and for the same reason: two indexed
 * SELECTs with a LIMIT, then batched INSERTs and one UPDATE. Nothing here is a
 * query per row, so a pass costs the limit rather than the Workspace and fits
 * inside a Cloudflare Cron Trigger's CPU budget (M3).
 */
export async function sweepSchedules({
  db,
  workspaceId,
  now = new Date(),
  limit = defaultSweepLimit,
}: SweepSchedulesOptions): Promise<ScheduleSweepResult> {
  const due = await dueAgentsQuery(db, { workspaceId, now, limit });
  const result = { due: due.length, started: 0, more: due.length >= limit };
  if (due.length === 0) return result;

  const owed = await scheduledIssuesQuery(db, {
    agentMemberIds: due.map((row) => row.memberId),
    limit,
  });
  // Hitting the Issue limit means this pass did not finish the backlog, so the
  // Agents stay due and the next pass carries on: the Runs just started are
  // open, so the anti-join above excludes them and every pass makes progress.
  const drained = owed.length < limit;
  result.more = result.more || !drained;

  const runs = owed.map((row) => ({
    id: newId("run"),
    issueId: row.id,
    agentMemberId: row.agentMemberId as string,
    // Nobody asked for it. The clock is not a Member, and a Run with no
    // trigger of its own belongs to the Agent's Sponsor (notifications.ts).
    triggeredByMemberId: null,
    trigger: "schedule" as const,
    projectId: row.projectId,
  }));
  for (let at = 0; at < runs.length; at += runRowsPerInsert) {
    await db
      .insert(runTable)
      .values(
        runs.slice(at, at + runRowsPerInsert).map(({ projectId: _projectId, ...values }) => values),
      );
  }
  result.started = runs.length;

  // Written straight to the log rather than through `appendEvent`, for the
  // reasons the stale sweep gives: this is not a request, `run.started` derives
  // no Notification and triggers nothing, and one append per row would make the
  // pass cost the Workspace instead of the limit. What it does still owe is
  // delivery, which is derived in bulk below rather than skipped.
  const rows = runs.map((run) => ({
    workspaceId,
    kind: "run.started" satisfies EventKind,
    subjectType: "run",
    subjectId: run.id,
    projectId: run.projectId,
    payload: { issueId: run.issueId, trigger: run.trigger, agentMemberId: run.agentMemberId },
  }));
  const written: Array<{ seq: number; kind: EventKind; projectId: string | null }> = [];
  for (let at = 0; at < rows.length; at += runStartedRowsPerInsert) {
    const inserted = await db
      .insert(eventTable)
      .values(rows.slice(at, at + runStartedRowsPerInsert))
      .returning({ seq: eventTable.seq, kind: eventTable.kind, projectId: eventTable.projectId });
    written.push(...(inserted as typeof written));
  }
  await deriveWebhookDeliveriesForMany(
    db,
    workspaceId,
    written.map((row) => ({ ...row, workspaceId })),
  );

  // Last, and only once the backlog is drained: an interval that stamped itself
  // before the work was done would skip whatever the limit cut off.
  if (drained) {
    await db
      .update(agentTable)
      .set({ scheduleRanAt: now })
      .where(
        inArray(
          agentTable.memberId,
          due.map((row) => row.memberId),
        ),
      );
  }
  return result;
}

/**
 * What is owed to somewhere outside deevy, in two arms over one table.
 *
 * A Slack Channel and a subscribed URL are the same problem: a message owed to
 * a destination that may be down, retried until it lands or is given up on. So
 * they share the `delivery` table (schema/delivery.ts), the claim that makes
 * two senders safe without a transaction, the backoff, and the recording of
 * what came back. What differs is what the message says, how patient each is,
 * and — for a webhook — the signature, and the Event that records giving up.
 */

/** Deliveries one pass may send. Slack answers in tens of milliseconds; twenty fits a tick. */
export const defaultDeliveryLimit = 20;

/**
 * Attempts before a Slack message is given up on. Six, with the backoff below,
 * spans about a quarter of an hour: long enough to ride out a blip, and a
 * missed Notification still has the inbox behind it.
 */
export const maxDeliveryAttempts = 6;

/**
 * A webhook is given up on later than a Slack message, at eight attempts and
 * about twenty minutes. That does not outlast a runtime that is down for an
 * afternoon, and it is not meant to: ADR-0003 pairs retries with polling, and
 * an Agent that comes back later finds its work with runs.list rather than
 * waiting to be told again. Widening the window instead would mean holding a
 * trigger long after it stopped being news.
 */
export const maxWebhookAttempts = 8;

/** How a failed delivery waits before the next attempt. */
interface Backoff {
  /** The wait after the first failure, doubling with every one after it. */
  firstMs: number;
  /** However many attempts have failed, the next is never further off than this. */
  ceilingMs: number;
  /** Spreads the retries, so a receiver coming back up is not hit by all of them at once. */
  jitter: boolean;
}

/** Slack: 30s, 1m, 2m, 4m, 8m, and then it is given up on. */
const slackBackoff: Backoff = { firstMs: 30_000, ceilingMs: 60 * 60_000, jitter: false };

/** A webhook: 10s doubling to a six-hour ceiling (docs/plans/m2.md). */
const webhookBackoff: Backoff = { firstMs: 10_000, ceilingMs: 6 * 60 * 60_000, jitter: true };

/**
 * How long a claim holds a delivery. Long enough for a POST that is timing out
 * to finish, short enough that a process dying mid-send costs one minute.
 */
const deliveryLockMs = 60_000;

/** Exhausted deliveries whose Events go in one statement; each row binds six columns. */
const exhaustedRowsPerInsert = 16;

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
function dueDeliveries(
  db: Db,
  target: (typeof deliveryTargets)[number],
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
        eq(deliveryTable.target, target),
        // Out of attempts is given up on, not retried forever.
        lt(deliveryTable.attempts, maxAttempts),
        // Somebody else may be sending it right now.
        or(isNull(deliveryTable.lockedUntil), lt(deliveryTable.lockedUntil, now)),
      ),
    )
    .limit(limit);
}

/** The Slack arm's due scan. Exported so a test can EXPLAIN it: the plan is the guarantee. */
export function dueDeliveriesQuery(
  db: Db,
  { maxAttempts = maxDeliveryAttempts, ...options }: DueDeliveriesQueryOptions,
) {
  return dueDeliveries(db, "slack", { ...options, maxAttempts });
}

/** The webhook arm's, which differs only in the destination and in how patient it is. */
export function dueWebhookDeliveriesQuery(
  db: Db,
  { maxAttempts = maxWebhookAttempts, ...options }: DueDeliveriesQueryOptions,
) {
  return dueDeliveries(db, "webhook", { ...options, maxAttempts });
}

/** One delivery this pass holds, and everything needed to render what it says. */
interface Claimed {
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
async function claimDeliveries(db: Db, ids: string[], now: Date): Promise<Claimed[]> {
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
interface Attempted {
  id: string;
  delivered: boolean;
  status: number;
  error: string | null;
}

interface Recorded {
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
async function recordOutcomes(
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
async function retireDeliveries(db: Db, ids: string[], reason: string, maxAttempts: number) {
  if (ids.length === 0) return;
  await db
    .update(deliveryTable)
    .set({ attempts: maxAttempts, lockedUntil: null, lastError: reason })
    .where(inArray(deliveryTable.id, ids));
}

/** The Events a pass is about to render messages from, in one statement. */
async function eventsOf(db: Db, claimed: Claimed[]) {
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

export interface DeliverDueChannelMessagesOptions {
  db: Db;
  workspaceId: string;
  /** The public origin of this instance, so every message links back to the Issue. */
  baseUrl: string;
  /** The clock, so a test does not have to wait out the backoff. */
  now?: Date;
  /** Most deliveries to send in one pass. */
  limit?: number;
  /** Attempts before a delivery is given up on. */
  maxAttempts?: number;
  /** The way out to Slack. A test passes its own and never reaches the network. */
  fetch?: FetchLike;
}

export interface DeliveryResult {
  /** Deliveries this pass claimed. Fewer than were due when another sweep held them. */
  scanned: number;
  /** Messages the destination accepted. */
  delivered: number;
  /** Messages it refused, which will be tried again. */
  failed: number;
  /** Deliveries that ran out of attempts, or whose destination is gone. */
  gaveUp: number;
  /** The limit was reached, so call again rather than raising the limit. */
  more: boolean;
}

/**
 * Sends what the Event log says is owed to a Slack Channel.
 *
 * Bounded exactly like the sweeps above: one indexed SELECT with a LIMIT, one
 * UPDATE that claims what it found, three batched lookups for the rows the
 * messages are rendered from, and one UPDATE per distinct outcome. Never a
 * query per row, so a pass costs the limit rather than the Workspace (M3's
 * Cron Trigger).
 */
export async function deliverDueChannelMessages({
  db,
  workspaceId,
  baseUrl,
  now = new Date(),
  limit = defaultDeliveryLimit,
  maxAttempts = maxDeliveryAttempts,
  fetch: fetchImpl = fetch,
}: DeliverDueChannelMessagesOptions): Promise<DeliveryResult> {
  const due = await dueDeliveriesQuery(db, { workspaceId, now, limit, maxAttempts });
  const result: DeliveryResult = {
    scanned: 0,
    delivered: 0,
    failed: 0,
    gaveUp: 0,
    more: due.length >= limit,
  };
  if (due.length === 0) return result;

  const claimed = await claimDeliveries(
    db,
    due.map((row) => row.id),
    now,
  );
  result.scanned = claimed.length;
  if (claimed.length === 0) return result;

  // The three lookups the messages are rendered from, batched: the Events
  // themselves, the Channels they are headed for, and the Issues they name.
  // The payload was never stored, so this is where it is built (ADR-0003).
  const eventBySeq = await eventsOf(db, claimed);
  const channels = await db
    .select({ id: channelTable.id, config: channelTable.config })
    .from(channelTable)
    .where(
      inArray(
        channelTable.id,
        claimed.map((row) => row.targetId),
      ),
    );

  const webhookOf = new Map(channels.map((row) => [row.id, row.config?.webhookUrl] as const));
  const issueIds = [
    ...new Set([...eventBySeq.values()].map((event) => issueOf(event)).filter((id) => id !== null)),
  ];
  const issues = issueIds.length
    ? await db
        // One table: the key is the tracker's and rides on the projection, so
        // the Project join this used to need is one statement fewer.
        .select({ id: issueTable.id, key: issueTable.externalKey, title: issueTable.title })
        .from(issueTable)
        .where(inArray(issueTable.id, issueIds))
    : [];
  const issueById = new Map(issues.map((row) => [row.id, { key: row.key, title: row.title }]));

  // A delivery whose Channel or Event is gone can never be sent, so it is
  // retired rather than retried: the Channel was deleted after the Event.
  const undeliverable: string[] = [];
  const sending: Array<{ id: string; webhookUrl: string; payload: SlackPayload }> = [];
  for (const row of claimed) {
    const event = eventBySeq.get(row.eventSeq);
    const webhookUrl = webhookOf.get(row.targetId);
    const kind = event ? notificationKindOf(event) : null;
    // An Agent's kind among these would be a message Slack has no words for,
    // and a routing rule cannot name one, so it joins the deleted Channel as
    // something to retire rather than retry (notifications.ts).
    if (
      !event ||
      !kind ||
      !isHumanNotificationKind(kind) ||
      typeof webhookUrl !== "string" ||
      webhookUrl.length === 0
    ) {
      undeliverable.push(row.id);
      continue;
    }
    const issueId = issueOf(event);
    sending.push({
      id: row.id,
      webhookUrl,
      payload: slackMessage({
        kind,
        issue: (issueId && issueById.get(issueId)) || null,
        baseUrl,
      }),
    });
  }

  const attempted: Attempted[] = await Promise.all(
    sending.map(async ({ id, webhookUrl, payload }) => {
      const posted = await postSlackMessage(webhookUrl, payload, fetchImpl);
      return {
        id,
        delivered: posted.delivered,
        status: posted.status,
        error: posted.error ?? null,
      };
    }),
  );

  const recorded = await recordOutcomes(db, attempted, {
    now,
    backoff: slackBackoff,
    maxAttempts,
    attemptsBefore: new Map(claimed.map((row) => [row.id, row.attempts])),
  });
  result.delivered = recorded.delivered;
  result.failed = recorded.failed;
  result.gaveUp = recorded.exhausted.length + undeliverable.length;

  await retireDeliveries(db, undeliverable, "the Channel this was owed to is gone", maxAttempts);
  return result;
}

export interface DeliverDueWebhooksOptions {
  db: Db;
  workspaceId: string;
  /** The clock, so a test does not have to wait out the backoff. */
  now?: Date;
  /** Most deliveries to send in one pass. */
  limit?: number;
  /** Attempts before a delivery is given up on. */
  maxAttempts?: number;
  /** The way out. A test passes its own and never reaches the network. */
  fetch?: FetchLike;
}

/**
 * Sends what the Event log says is owed to a subscribed URL (ADR-0003).
 *
 * The same shape as the Slack arm and, deliberately, the same claim, backoff
 * and outcome recording: one indexed SELECT with a LIMIT, one claiming UPDATE,
 * two batched lookups, one UPDATE per outcome, and one insert for whatever ran
 * out of attempts. Never a query per row.
 */
export async function deliverDueWebhooks({
  db,
  workspaceId,
  now = new Date(),
  limit = defaultDeliveryLimit,
  maxAttempts = maxWebhookAttempts,
  fetch: fetchImpl = fetch,
}: DeliverDueWebhooksOptions): Promise<DeliveryResult> {
  const due = await dueWebhookDeliveriesQuery(db, { workspaceId, now, limit, maxAttempts });
  const result: DeliveryResult = {
    scanned: 0,
    delivered: 0,
    failed: 0,
    gaveUp: 0,
    more: due.length >= limit,
  };
  if (due.length === 0) return result;

  return sendClaimedWebhooks({
    db,
    claimed: await claimDeliveries(
      db,
      due.map((row) => row.id),
      now,
    ),
    now,
    maxAttempts,
    fetchImpl,
    result,
  });
}

export interface DeliverWebhookOptions {
  db: Db;
  /** The durable row this is about. A queue message carries nothing else (jobs.ts). */
  deliveryId: string;
  now?: Date;
  maxAttempts?: number;
  fetch?: FetchLike;
}

/**
 * One delivery, claimed and sent on its own.
 *
 * This is the form a queue consumer drives, one message at a time (M3's
 * Cloudflare Queue), and the form the SPA's Redeliver button ends at. It is
 * the sweep with the scan replaced by an id, so it claims, backs off and gives
 * up in exactly the same way: a delivery must not be sent twice because two
 * different things decided to send it.
 */
export async function deliverWebhook({
  db,
  deliveryId,
  now = new Date(),
  maxAttempts = maxWebhookAttempts,
  fetch: fetchImpl = fetch,
}: DeliverWebhookOptions): Promise<DeliveryResult> {
  return sendClaimedWebhooks({
    db,
    claimed: await claimDeliveries(db, [deliveryId], now),
    now,
    maxAttempts,
    fetchImpl,
    result: { scanned: 0, delivered: 0, failed: 0, gaveUp: 0, more: false },
  });
}

/** What both webhook forms do once they hold their deliveries. */
async function sendClaimedWebhooks({
  db,
  claimed,
  now,
  maxAttempts,
  fetchImpl,
  result,
}: {
  db: Db;
  claimed: Claimed[];
  now: Date;
  maxAttempts: number;
  fetchImpl: FetchLike;
  result: DeliveryResult;
}): Promise<DeliveryResult> {
  result.scanned = claimed.length;
  if (claimed.length === 0) return result;

  // The two lookups the POSTs are rendered from, batched: the Events, and the
  // subscriptions they are headed for. Nothing was copied into the delivery
  // row, so the body is built here, from the log itself (ADR-0003).
  const eventBySeq = await eventsOf(db, claimed);
  const subscriptions = await db
    .select({
      id: webhookSubscriptionTable.id,
      url: webhookSubscriptionTable.url,
      secret: webhookSubscriptionTable.secret,
      disabledAt: webhookSubscriptionTable.disabledAt,
    })
    .from(webhookSubscriptionTable)
    .where(
      inArray(
        webhookSubscriptionTable.id,
        claimed.map((row) => row.targetId),
      ),
    );
  const subscriptionById = new Map(subscriptions.map((row) => [row.id, row]));

  // A delivery whose subscription is gone, or has since been disabled, can
  // never be sent: it is retired rather than retried.
  const undeliverable: string[] = [];
  const sending: Array<{ id: string; event: Event; url: string; secret: string }> = [];
  for (const row of claimed) {
    const event = eventBySeq.get(row.eventSeq);
    const subscription = subscriptionById.get(row.targetId);
    if (!event || !subscription || subscription.disabledAt !== null) {
      undeliverable.push(row.id);
      continue;
    }
    sending.push({ id: row.id, event, url: subscription.url, secret: subscription.secret });
  }

  const attempted: Attempted[] = await Promise.all(
    sending.map(async ({ id, event, url, secret }) => {
      const posted = await postWebhook({
        url,
        secret,
        event,
        deliveryId: id,
        now,
        fetch: fetchImpl,
      });
      return {
        id,
        delivered: posted.delivered,
        status: posted.status,
        error: posted.error ?? null,
      };
    }),
  );

  const recorded = await recordOutcomes(db, attempted, {
    now,
    backoff: webhookBackoff,
    maxAttempts,
    attemptsBefore: new Map(claimed.map((row) => [row.id, row.attempts])),
  });
  result.delivered = recorded.delivered;
  result.failed = recorded.failed;
  result.gaveUp = recorded.exhausted.length + undeliverable.length;

  await retireDeliveries(
    db,
    undeliverable,
    "the subscription this was owed to is gone",
    maxAttempts,
  );

  // Giving up is worth recording: a subscriber that has stopped answering is
  // the operator's problem, and the Event log is where deevy says so. Written
  // straight to the log rather than through `appendEvent`, like the sweeps
  // above: this is not a request, and an Event appended here would derive a
  // delivery to the very URL that just refused eight of them.
  if (recorded.exhausted.length > 0) {
    // Only a delivery that was actually sent can run out of attempts, so its
    // Event and its subscription are both in hand here.
    const sentById = new Map(sending.map((one) => [one.id, one]));
    const outcomeById = new Map(attempted.map((one) => [one.id, one]));
    const subscriptionOf = new Map(claimed.map((row) => [row.id, row.targetId]));
    const rows = recorded.exhausted.map((id) => {
      const { event } = sentById.get(id) as { event: Event };
      const outcome = outcomeById.get(id);
      return {
        workspaceId: event.workspaceId,
        kind: "webhook.exhausted" satisfies EventKind,
        subjectType: "webhook",
        subjectId: subscriptionOf.get(id) as string,
        projectId: event.projectId,
        payload: {
          eventSeq: event.seq,
          attempts: maxAttempts,
          status: outcome?.status ?? 0,
          error: outcome?.error ?? null,
        },
      };
    });
    for (let at = 0; at < rows.length; at += exhaustedRowsPerInsert) {
      await db.insert(eventTable).values(rows.slice(at, at + exhaustedRowsPerInsert));
    }
  }

  return result;
}

/** Four hours of nobody deciding, by default, before the approvers are asked again. */
const defaultGateSilenceMs = 4 * 60 * 60 * 1000;

export interface RemindAboutGatesOptions {
  db: Db;
  workspaceId: string;
  now?: Date;
  silenceMs?: number;
  limit?: number;
}

/**
 * Runs waiting on a Gate that nobody has decided, ordered by how long they have
 * been waiting. Read straight off (status, lastActivityAt), which is the same
 * index the stale sweep uses, so there is no sort.
 */
export function waitingOnGatesQuery(
  db: Db,
  options: { workspaceId: string; cutoff: Date; limit: number },
) {
  return db
    .select({ id: runTable.id, lastActivityAt: runTable.lastActivityAt })
    .from(runTable)
    .innerJoin(issueTable, eq(runTable.issueId, issueTable.id))
    .innerJoin(projectTable, eq(issueTable.projectId, projectTable.id))
    .where(
      and(
        eq(runTable.status, "awaiting_input"),
        lt(runTable.lastActivityAt, options.cutoff),
        eq(projectTable.workspaceId, options.workspaceId),
      ),
    )
    .limit(options.limit);
}

/**
 * Asks a Gate's approvers again when nobody has decided it.
 *
 * A Run waiting on a Human is not stale, so the stale sweep leaves it alone
 * for ever (docs/plans/m2.md). Left there it occupies the Agent's one open Run
 * on that Issue and nobody is reminded, so this re-derives the Notification the
 * Gate already produced once. It moves no Run and appends no Event: nothing has
 * happened in the Workspace, someone simply has not looked yet.
 *
 * Which is why asking again is that Notification coming back unread rather
 * than a second copy of it. One inbox row per Member per kind per Event is the
 * schema's invariant (docs/plans/m3.md), and a second copy was never what a
 * reminder meant: the ask is the same ask, and the Human has still not made it.
 *
 * Bounded like every other sweep: one indexed scan with a limit, then the
 * Events those Runs already wrote, then the derivation and one update for each
 * of them.
 */
export async function remindAboutGates({
  db,
  workspaceId,
  now = new Date(),
  silenceMs = defaultGateSilenceMs,
  limit = defaultSweepLimit,
}: RemindAboutGatesOptions): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - silenceMs);
  const waiting = await waitingOnGatesQuery(db, { workspaceId, cutoff, limit });

  const result = { scanned: waiting.length, changed: 0, more: waiting.length >= limit };
  if (waiting.length === 0) return result;

  // The Event that put each Run into the Gate is the one to re-derive from: it
  // carries the State, so the same approvers are asked as the first time.
  const asked = await db.query.event.findMany({
    where: {
      kind: "run.awaiting_input",
      subjectId: { in: waiting.map((row) => row.id) },
    },
    orderBy: { seq: "asc" },
  });

  const latest = new Map<string, (typeof asked)[number]>();
  for (const event of asked) latest.set(event.subjectId, event);

  for (const event of latest.values()) {
    // Touching the Run is what stops this asking twice in the same round, and
    // it is honest: someone was told just now.
    await db.update(runTable).set({ lastActivityAt: now }).where(eq(runTable.id, event.subjectId));
    // The derivation still runs, because an approver added since the Gate was
    // reached has no row yet and is owed one; for everyone else the unique
    // index makes it a no-op and the unread flag is what asks them again. A
    // Slack room owed a message for that Event keeps the one it was owed, for
    // the same reason (docs/plans/m3.md, slice 2).
    await deriveNotifications(db, event);
    await db
      .update(notificationTable)
      .set({ readAt: null })
      .where(eq(notificationTable.eventId, event.seq));
    result.changed += 1;
  }
  return result;
}

/** Passes one call may take before it leaves the rest for the next one. */
export const defaultMaxPasses = 5;

/**
 * The numbers a trigger is allowed to cost. They are arguments rather than a
 * branch because the two runtimes need different ones: Node drains until there
 * is nothing left, and a Cron Trigger takes one bounded pass and lets the
 * platform bring it back (docs/plans/m3.md).
 */
export interface DueWorkLimits {
  /** Silence after which a Run is presumed stale. */
  silenceMs?: number;
  /** Silence after which an undecided Gate asks its approvers again. */
  gateSilenceMs?: number;
  /** Runs one sweep pass may move. */
  sweepLimit?: number;
  /** Messages one delivery pass may send. */
  deliveryLimit?: number;
  /** Passes one sweep may take before it leaves the rest for the next call. */
  maxPasses?: number;
}

export interface RunDueWorkOptions {
  db: Db;
  /** The clock, so a test does not have to wait thirty minutes. */
  now?: Date;
  limits?: DueWorkLimits;
  /**
   * The origin a Slack message's link back to the Issue is built on: where a
   * Human's browser finds this deevy, which is the SPA's own origin when this
   * deployment gives it one and this instance's otherwise (`linkOrigin` in
   * operations/shared.ts is the same decision inside a request). Without one
   * those deliveries wait in their rows.
   */
  baseUrl?: string;
  /** Aborted when the caller is shutting down. Checked between passes. */
  signal?: AbortSignal;
}

/** What one trigger's worth of background work actually did. */
export interface DueWorkResult {
  /** Runs moved to `stale`. */
  staleRuns: number;
  /** Runs the schedule trigger started. */
  scheduled: number;
  /** Messages a Slack Channel accepted. */
  channelMessages: number;
  /** Webhook deliveries a subscribed URL accepted. */
  webhooks: number;
  /** Gates whose approvers were asked again. */
  gateReminders: number;
  /** The signal was aborted, so the passes after that point did not run. */
  aborted: boolean;
}

/**
 * One trigger's worth of deevy's background work: the stale sweep, the
 * schedule trigger, both delivery loops and the Gate reminder, in that order.
 *
 * It lives here rather than beside a scheduler because the two runtimes own
 * their schedules differently and neither owns this. Node's `startRunner`
 * brings a timer, a drain loop and a SIGTERM; a Cloudflare Cron Trigger hands
 * a one-shot `scheduled(controller, env, ctx)` and owns the schedule itself.
 * Writing a Workers `Cron` would have been a port lying about who holds the
 * timer, so the pass moved instead and the difference between the runtimes is
 * `limits` (docs/plans/m3.md).
 */
export async function runDueWork({
  db,
  now = new Date(),
  limits = {},
  baseUrl,
  signal,
}: RunDueWorkOptions): Promise<DueWorkResult> {
  const {
    silenceMs = defaultSilenceMs,
    gateSilenceMs = defaultGateSilenceMs,
    sweepLimit,
    deliveryLimit,
    maxPasses = defaultMaxPasses,
  } = limits;
  const sweepBound = sweepLimit === undefined ? {} : { limit: sweepLimit };
  const deliveryBound = deliveryLimit === undefined ? {} : { limit: deliveryLimit };

  const result: DueWorkResult = {
    staleRuns: 0,
    scheduled: 0,
    channelMessages: 0,
    webhooks: 0,
    gateReminders: 0,
    aborted: false,
  };

  // A self-hosted instance serves one Workspace (CONTEXT.md), and it does not
  // exist until the first admin signs in, so a fresh deployment sweeps nothing.
  const workspace = await db.query.workspace.findFirst();
  if (!workspace) return result;
  const workspaceId = workspace.id;

  /**
   * One unit of background work, run until it says it is done or this call has
   * had enough passes. `more` means the limit was reached: go again rather
   * than raise it, so one trigger stays bounded whatever the backlog is. On
   * Workers `maxPasses` is one and the thing that comes back is the platform.
   */
  async function drain<T>(pass: () => Promise<T & { more: boolean }>, add: (of: T) => void) {
    for (let attempt = 0; attempt < maxPasses; attempt += 1) {
      if (signal?.aborted) {
        result.aborted = true;
        return;
      }
      const outcome = await pass();
      add(outcome);
      if (!outcome.more) return;
    }
  }

  await drain(
    () => sweepStaleRuns({ db, workspaceId, now, silenceMs, ...sweepBound }),
    (of) => {
      result.staleRuns += of.changed;
    },
  );
  // The schedule trigger rides the same trigger: one timer on Node, one Cron
  // Trigger on Cloudflare, and nothing else to configure or forget.
  await drain(
    () => sweepSchedules({ db, workspaceId, now, ...sweepBound }),
    (of) => {
      result.scheduled += of.started;
    },
  );
  // And so does what is owed to a Channel. Without an origin a Slack message
  // could not link back to the Issue, so the deliveries wait rather than go
  // out useless: they are durable rows, and the next trigger with one sends them.
  if (baseUrl) {
    await drain(
      () => deliverDueChannelMessages({ db, workspaceId, baseUrl, now, ...deliveryBound }),
      (of) => {
        result.channelMessages += of.delivered;
      },
    );
  }
  // And what is owed to a subscribed URL, which needs no origin: the body is
  // the Event itself and carries no link (ADR-0003).
  await drain(
    () => deliverDueWebhooks({ db, workspaceId, now, ...deliveryBound }),
    (of) => {
      result.webhooks += of.delivered;
    },
  );
  // A Run waiting on a Gate is not silent, so the stale sweep never touches
  // it; without this a Gate nobody decides holds the Agent's one open Run on
  // that Issue for ever and nobody is asked again (docs/plans/m2.md).
  await drain(
    () => remindAboutGates({ db, workspaceId, now, silenceMs: gateSilenceMs, ...sweepBound }),
    (of) => {
      result.gateReminders += of.changed;
    },
  );

  return result;
}
