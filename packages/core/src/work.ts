import {
  delivery as deliveryTable,
  event as eventTable,
  issue as issueTable,
  socketMirror as socketMirrorTable,
  project as projectTable,
  run as runTable,
  webhookSubscription as webhookSubscriptionTable,
  type Db,
  type Event,
  type Issue,
  type Socket,
} from "@deevy/db";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { EventKind } from "./events.ts";
import { gateRequestIdOf, issueOf } from "./notifications.ts";
import { appendEvent } from "./events.ts";
import { mirrorFor } from "./sockets/mirror.ts";
import { chatGateMessage } from "./sockets/chat-out.ts";
import { forgetOldDeliveries } from "./sockets/hooks.ts";
import type { ChatMessage, ChatMessageRef, SocketModule, SocketModules } from "./sockets/port.ts";
import { socketModuleFor } from "./sockets/registry.ts";
import { deriveWebhookDeliveriesForMany, postWebhook, type FetchLike } from "./webhooks.ts";
import { newId } from "./ids.ts";
import {
  claimDeliveries,
  dueDeliveries,
  eventsOf,
  recordOutcomes,
  retireDeliveries,
  type Attempted,
  type Backoff,
  type Claimed,
  type DueDeliveriesQueryOptions,
} from "./outbox.ts";

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

/**
 * Where deevy is waiting on the Agent and silence means something is wrong.
 * `awaiting_input` is missing on purpose: that Run is waiting at a Gate, and
 * only a Ruling on it un-waits the Run (gates.ts), so sweeping one would
 * strand the Ruling a Human is about to make.
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

/**
 * What is owed to somewhere outside deevy, in three arms over one table.
 *
 * A chat tool, a tracker and a subscribed URL are the same problem: a message
 * owed to a destination that may be down, retried until it lands or is given
 * up on. So they share the `delivery` table (schema/delivery.ts), the claim
 * that makes two senders safe without a transaction, the backoff, and the
 * recording of what came back. What differs is what the message says, how
 * patient each is, and — for a webhook — the signature, and the Event that
 * records giving up.
 */

/** Deliveries one pass may send. Slack answers in tens of milliseconds; twenty fits a tick. */
export const defaultDeliveryLimit = 20;

/**
 * Attempts before a chat message is given up on. Six, with the backoff below,
 * spans about a quarter of an hour: long enough to ride out a blip, and a
 * Gate missed in Slack is still on Needs me.
 */
export const maxDeliveryAttempts = 6;

/**
 * A webhook is given up on later than a chat message, at eight attempts and
 * about twenty minutes. That does not outlast a runtime that is down for an
 * afternoon, and it is not meant to: ADR-0003 pairs retries with polling, and
 * an Agent that comes back later finds its work with runs.list rather than
 * waiting to be told again. Widening the window instead would mean holding a
 * trigger long after it stopped being news.
 */
export const maxWebhookAttempts = 8;

/** A chat tool: 30s, 1m, 2m, 4m, 8m, and then it is given up on. */
const chatBackoff: Backoff = { firstMs: 30_000, ceilingMs: 60 * 60_000, jitter: false };

/** A webhook: 10s doubling to a six-hour ceiling (docs/plans/m2.md). */
const webhookBackoff: Backoff = { firstMs: 10_000, ceilingMs: 6 * 60 * 60_000, jitter: true };

/** Exhausted deliveries whose Events go in one statement; each row binds six columns. */
const exhaustedRowsPerInsert = 16;

/** The webhook arm's due scan. Exported so a test can EXPLAIN it: the plan is the guarantee. */
export function dueWebhookDeliveriesQuery(
  db: Db,
  { maxAttempts = maxWebhookAttempts, ...options }: DueDeliveriesQueryOptions,
) {
  return dueDeliveries(db, "webhook", { ...options, maxAttempts });
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

export interface DeliverDueChatMessagesOptions {
  db: Db;
  workspaceId: string;
  /** The providers this deployment can speak. Without them nothing is sent. */
  sockets?: SocketModules;
  socketSecret?: string;
  /** Where a Human opens a Gate in deevy, which every Gate message links to. */
  baseUrl: string;
  now?: Date;
  limit?: number;
  maxAttempts?: number;
  fetch?: typeof fetch;
}

/**
 * Sends what a chat tool is owed (ADR-0025): a Gate posted in the channel its
 * Project binds (docs/plans/simplify.md, slice 8), and the update a Gate's
 * messages are owed when somebody rules.
 *
 * The third arm beside the webhooks and the trackers, with their claim, their
 * backoff and their retirement. A delivery names one of two things, each
 * looked up in one batched read: a Project (post its Gate where it binds a
 * channel now), or a chat Socket (update every message of the Gate it holds).
 * A Gate is rendered from its own rows at send time, so a message posted after
 * somebody already ruled says so rather than offering a button that would be
 * refused.
 */
export async function deliverDueChatMessages({
  db,
  workspaceId,
  sockets,
  socketSecret,
  baseUrl,
  now = new Date(),
  limit = defaultDeliveryLimit,
  maxAttempts = maxDeliveryAttempts,
  fetch: fetchImpl,
}: DeliverDueChatMessagesOptions): Promise<DeliveryResult> {
  const result: DeliveryResult = { scanned: 0, delivered: 0, failed: 0, gaveUp: 0, more: false };
  if (!sockets) return result;

  const due = await dueDeliveries(db, "chat", { workspaceId, now, limit, maxAttempts });
  result.more = due.length >= limit;
  if (due.length === 0) return result;
  const claimed = await claimDeliveries(
    db,
    "chat",
    due.map((row) => row.id),
    now,
  );
  result.scanned = claimed.length;
  if (claimed.length === 0) return result;

  const eventBySeq = await eventsOf(db, claimed);
  const targetIds = [...new Set(claimed.map((row) => row.targetId))];
  // A post names its Project and goes where the Project binds a channel now,
  // so an admin who moved the binding since the Gate was asked is obeyed.
  const projects = await db.query.project.findMany({
    where: { id: { in: targetIds }, workspaceId },
    columns: { id: true, chatSocketId: true, chatChannel: true },
  });
  const projectById = new Map(projects.map((row) => [row.id, row]));
  // Every chat tool in the Workspace: there are one or two.
  const chatSockets = (
    await db.query.socket.findMany({ where: { workspaceId, status: "active" } })
  ).filter((row) => row.capabilities.includes("chat"));
  const socketById = new Map(chatSockets.map((row) => [row.id, row]));

  // A Gate is the subject of its own Events, and the Run's wait for one names
  // it in its payload: that wait is what posts it (sockets/chat-out.ts).
  const gateOf = (event: Event): string | null =>
    event.subjectType === "gate" ? event.subjectId : gateRequestIdOf(event);
  const readGates = (ids: string[]) =>
    db.query.gateRequest.findMany({
      where: { id: { in: ids } },
      with: {
        issue: { columns: { externalKey: true, url: true } },
        run: { with: { agent: { with: { user: { columns: { name: true } } } } } },
        checkpointPolicy: { columns: { approvalsRequired: true } },
        decisions: {
          with: {
            socket: { columns: { provider: true } },
            member: { with: { user: { columns: { name: true } } } },
          },
        },
        mirrors: { where: { kind: "message" } },
      },
    });
  const gateIds = [...new Set([...eventBySeq.values()].map(gateOf).filter(isText))];
  const gates = gateIds.length ? await readGates(gateIds) : [];
  const gateById = new Map(gates.map((row) => [row.id, row]));
  const origin = baseUrl.replace(/\/+$/, "");

  const undeliverable: string[] = [];
  const attempted: Attempted[] = [];
  // Which tool each attempt was for, so one that runs out is said on it.
  const socketOfRow = new Map<string, Socket>();
  // What each post said, to be checked against the Gate once it is answered.
  const posts: Array<{
    row: Claimed;
    gateId: string;
    socket: Socket;
    chat: NonNullable<SocketModule["chat"]>;
    ref: ChatMessageRef;
    said: string;
  }> = [];
  for (const row of claimed) {
    const event = eventBySeq.get(row.eventSeq);
    const project = projectById.get(row.targetId);
    const channel = project?.chatChannel ?? null;
    const socket = project
      ? project.chatSocketId
        ? socketById.get(project.chatSocketId)
        : undefined
      : socketById.get(row.targetId);
    const gateId = event ? gateOf(event) : null;
    const gate = gateId ? gateById.get(gateId) : undefined;
    // A Project that binds no channel now, a Socket that was rested, a Gate
    // that is gone: none of these become sendable by waiting, so they are
    // retired.
    if (!event || !socket || !gate || (project && !channel)) {
      undeliverable.push(row.id);
      continue;
    }
    const message: ChatMessage = { kind: "gate", gate: chatGateMessage(gate, origin) };
    const held = gate.mirrors.filter((one) => one.socketId === socket.id);
    socketOfRow.set(row.id, socket);
    try {
      const module = await socketModuleFor(
        {
          db,
          sockets,
          ...(socketSecret ? { socketSecret } : {}),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        },
        socket,
      );
      const chat = module.chat;
      if (!chat) throw new Error(`The ${socket.name} Socket is not a chat tool`);

      if (project && channel) {
        // One Gate is one message in a tool: a Gate that already holds one
        // there keeps it, rather than gaining a second set of buttons.
        if (held.length === 0) {
          const ref = await chat.post(channel, message);
          // Where it landed, so a Ruling from any door can change it later.
          await db.insert(socketMirrorTable).values({
            id: newId("socketMirror"),
            gateRequestId: gate.id,
            socketId: socket.id,
            kind: "message",
            externalRef: { channel: ref.channel, ts: ref.ts },
          });
          posts.push({ row, gateId: gate.id, socket, chat, ref, said: JSON.stringify(message) });
        }
      } else {
        for (const mirror of held) {
          const channelId = configText(mirror.externalRef, "channel");
          const ts = configText(mirror.externalRef, "ts");
          if (channelId && ts) await chat.update({ channel: channelId, ts }, message);
        }
      }
      attempted.push({ id: row.id, delivered: true, status: 200, error: null });
    } catch (error) {
      attempted.push({
        id: row.id,
        delivered: false,
        status: 0,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      });
    }
  }

  // A Ruling made while a post was on its way found no message to update,
  // because where it landed was not known yet, so the message would offer
  // buttons for a Gate already decided. One read of the Gates just posted
  // says which changed meanwhile.
  if (posts.length > 0) {
    const since = await readGates([...new Set(posts.map((one) => one.gateId))]);
    const sinceById = new Map(since.map((row) => [row.id, row]));
    for (const post of posts) {
      const gate = sinceById.get(post.gateId);
      if (!gate) continue;
      const message: ChatMessage = { kind: "gate", gate: chatGateMessage(gate, origin) };
      if (JSON.stringify(message) === post.said) continue;
      try {
        await post.chat.update(post.ref, message);
      } catch {
        // The outbox owes it instead, and retries it: its update arm finds
        // the message just recorded.
        await db
          .insert(deliveryTable)
          .values({
            id: newId("delivery"),
            workspaceId,
            target: "chat",
            targetId: post.socket.id,
            eventSeq: post.row.eventSeq,
          })
          .onConflictDoNothing();
      }
    }
  }

  const recorded = await recordOutcomes(db, attempted, {
    now,
    backoff: chatBackoff,
    maxAttempts,
    attemptsBefore: new Map(claimed.map((row) => [row.id, row.attempts])),
  });
  result.delivered = recorded.delivered;
  result.failed = recorded.failed;
  result.gaveUp = recorded.exhausted.length + undeliverable.length;
  await retireDeliveries(
    db,
    undeliverable,
    "the channel, the tool or the Gate is gone",
    maxAttempts,
  );

  // A Gate nobody was shown in the channel is said on the tool, the way a
  // tracker comment deevy gave up on is.
  for (const id of recorded.exhausted) {
    const socket = socketOfRow.get(id);
    if (!socket) continue;
    await appendEvent(
      { db, workspace: { id: workspaceId }, member: null },
      {
        kind: "socket.mirror_exhausted",
        subjectType: "socket",
        subjectId: socket.id,
        payload: { name: socket.name, deliveryId: id },
      },
    );
  }
  return result;
}

export interface DeliverDueSocketMirrorsOptions {
  db: Db;
  workspaceId: string;
  /** The providers this deployment can speak. Without them nothing is sent. */
  sockets?: SocketModules;
  socketSecret?: string;
  /** Where a Human opens the Gate the comment is about. */
  baseUrl?: string;
  now?: Date;
  limit?: number;
  maxAttempts?: number;
  fetch?: typeof fetch;
}

/**
 * Says back in the tracker what happened in deevy (ADR-0024).
 *
 * One of three arms, beside the chat tools and the webhooks, with their claim,
 * their backoff and their retirement: what is different is only where it
 * lands. A Socket an operator has rested retires what it was owed rather than
 * queueing comments against the day they resume it — that is not what resting
 * a tool means.
 */
export async function deliverDueSocketMirrors({
  db,
  workspaceId,
  sockets,
  socketSecret,
  baseUrl,
  now = new Date(),
  limit = defaultDeliveryLimit,
  maxAttempts = maxDeliveryAttempts,
  fetch: fetchImpl,
}: DeliverDueSocketMirrorsOptions): Promise<DeliveryResult> {
  const result: DeliveryResult = {
    scanned: 0,
    delivered: 0,
    failed: 0,
    gaveUp: 0,
    more: false,
  };
  if (!sockets) return result;

  const due = await dueDeliveries(db, "socket", { workspaceId, now, limit, maxAttempts });
  result.more = due.length >= limit;
  if (due.length === 0) return result;

  const claimed = await claimDeliveries(
    db,
    "socket",
    due.map((row) => row.id),
    now,
  );
  result.scanned = claimed.length;
  if (claimed.length === 0) return result;

  // The lookups the comments are rendered from, batched the way a chat tool's are:
  // the Events, the Sockets they are headed for, the records they are about,
  // the Gates they ask about, and who was working.
  const eventBySeq = await eventsOf(db, claimed);
  const events = [...eventBySeq.values()];
  const socketRows = await db.query.socket.findMany({
    where: { id: { in: [...new Set(claimed.map((row) => row.targetId))] } },
  });
  const socketById = new Map(socketRows.map((row) => [row.id, row]));
  const projects = await db.query.project.findMany({
    where: { id: { in: [...new Set(events.map((event) => event.projectId).filter(isText))] } },
  });
  const projectById = new Map(projects.map((row) => [row.id, row]));
  const issueIds = [...new Set(events.map((event) => issueOf(event)).filter(isText))];
  const issues = issueIds.length
    ? await db.query.issue.findMany({ where: { id: { in: issueIds } } })
    : [];
  const issueById = new Map(issues.map((row) => [row.id, row]));

  // A Gate's own words, and the Agent that asked: a comment says which
  // Checkpoint and which Agent, and neither is in the Event.
  const gateIds = events
    .filter((event) => event.kind.startsWith("gate.") && event.subjectType === "gate")
    .map((event) => event.subjectId);
  const gates = gateIds.length
    ? await db.query.gateRequest.findMany({ where: { id: { in: [...new Set(gateIds)] } } })
    : [];
  const gateById = new Map(gates.map((row) => [row.id, row]));
  const runIds = [...new Set(gates.map((gate) => gate.runId))];
  const runs = runIds.length
    ? await db.query.run.findMany({
        where: { id: { in: runIds } },
        with: { agent: { with: { user: true } } },
      })
    : [];
  const runById = new Map(runs.map((row) => [row.id, row]));

  const undeliverable: string[] = [];
  const sending: Array<{
    id: string;
    socket: Socket;
    issue: Issue;
    comment: string;
    gateId: string | null;
  }> = [];
  for (const row of claimed) {
    const event = eventBySeq.get(row.eventSeq);
    const socket = socketById.get(row.targetId);
    const issueId = event ? issueOf(event) : null;
    const issue = issueId ? issueById.get(issueId) : undefined;
    const project = event?.projectId ? projectById.get(event.projectId) : undefined;
    // A Socket that was rested, disconnected or never built, a Project or a
    // record that is gone: none of these become sendable by waiting, so they
    // are retired rather than retried.
    if (!event || !socket || !issue || !project || socket.status !== "active") {
      undeliverable.push(row.id);
      continue;
    }
    const gate = event.subjectType === "gate" ? gateById.get(event.subjectId) : undefined;
    const run = gate ? runById.get(gate.runId) : undefined;
    const comment = mirrorFor(event, {
      gate: gate
        ? {
            id: gate.id,
            checkpoint: gate.checkpoint,
            proposal: gate.proposal,
            links: gate.links,
          }
        : null,
      agentName: run?.agent.user.name ?? null,
      runId: run?.id ?? null,
      ...(baseUrl ? { origin: baseUrl.replace(/\/+$/, "") } : {}),
    });
    if (!comment) {
      undeliverable.push(row.id);
      continue;
    }
    sending.push({ id: row.id, socket, issue, comment, gateId: gate?.id ?? null });
  }

  const attempted: Attempted[] = [];
  for (const { id, socket, issue, comment, gateId } of sending) {
    try {
      const module = await socketModuleFor(
        {
          db,
          sockets,
          ...(socketSecret ? { socketSecret } : {}),
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        },
        socket,
      );
      const tracker = module.tracker;
      if (!tracker) {
        undeliverable.push(id);
        continue;
      }
      const project = projectById.get(issue.projectId);
      const scope = project?.trackerScope ?? {};
      const ref = { externalId: issue.externalId, url: issue.url };
      const posted = await tracker.createComment(scope, ref, comment);
      // Where it landed, so a later Ruling can go back and change what it
      // finds (schema/gate.ts) — unless the tool took nothing, as the generic
      // Socket does, whose adapter hears the Event on a webhook instead.
      if (posted) {
        await db.insert(socketMirrorTable).values({
          id: newId("socketMirror"),
          gateRequestId: gateId,
          socketId: socket.id,
          kind: "comment",
          externalRef: { externalId: posted.externalId, url: posted.url },
        });
      }
      attempted.push({ id, delivered: true, status: 200, error: null });
    } catch (error) {
      attempted.push({
        id,
        delivered: false,
        // No HTTP of deevy's own here: a provider module made the request and
        // what comes back is its refusal in words.
        status: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const recorded = await recordOutcomes(db, attempted, {
    now,
    backoff: chatBackoff,
    maxAttempts,
    attemptsBefore: new Map(claimed.map((row) => [row.id, row.attempts])),
  });
  result.delivered = recorded.delivered;
  result.failed = recorded.failed;
  result.gaveUp = recorded.exhausted.length + undeliverable.length;

  await retireDeliveries(
    db,
    undeliverable,
    "the tool this was owed to is gone or rested",
    maxAttempts,
  );

  // Running out of attempts is deevy admitting it could not say what happened,
  // which belongs in the log the way `webhook.exhausted` does (ADR-0003).
  for (const id of recorded.exhausted) {
    const row = claimed.find((one) => one.id === id);
    const socket = row ? socketById.get(row.targetId) : undefined;
    if (!socket) continue;
    await appendEvent(
      { db, workspace: { id: workspaceId }, member: null },
      {
        kind: "socket.mirror_exhausted",
        subjectType: "socket",
        subjectId: socket.id,
        payload: { name: socket.name, deliveryId: id },
      },
    );
  }
  return result;
}

/** Whether a value is a string, for the id lists these lookups are built from. */
/** One string out of a JSON column, or empty when it is not one. */
function configText(config: Record<string, unknown> | null | undefined, key: string): string {
  const value = config?.[key];
  return typeof value === "string" ? value : "";
}

function isText(value: string | null): value is string {
  return typeof value === "string";
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
 * The same shape as the chat arm and, deliberately, the same claim, backoff
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
      "webhook",
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
 *
 * An id that names some other arm's row claims nothing and so changes nothing:
 * a tracker's comment or a chat message is left exactly as it was for the
 * sweep that knows how to send it, rather than retired here for having no
 * subscription behind it.
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
    claimed: await claimDeliveries(db, "webhook", [deliveryId], now),
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
   * The origin a Gate's message and comment link into deevy on: where a
   * Human's browser finds this deevy, which is the SPA's own origin when this
   * deployment gives it one and this instance's otherwise (`linkOrigin` in
   * operations/shared.ts is the same decision inside a request). Without one
   * a chat tool's deliveries wait in their rows.
   */
  baseUrl?: string;
  /** Aborted when the caller is shutting down. Checked between passes. */
  signal?: AbortSignal;
  /**
   * The providers this deployment can speak (ADR-0024). Without them nothing
   * is said in a tool, which is what a deployment that connects none wants.
   */
  sockets?: SocketModules;
  /** What this deployment seals a Socket's credentials with (secrets.ts). */
  socketSecret?: string;
  /** Injected, so a test reaches a fake tracker or webhook receiver rather than the network. */
  fetch?: typeof fetch;
}

/** What one trigger's worth of background work actually did. */
export interface DueWorkResult {
  /** Runs moved to `stale`. */
  staleRuns: number;
  /** Webhook deliveries a subscribed URL accepted. */
  webhooks: number;
  /** Deliveries old enough that no provider could still replay them. */
  forgottenDeliveries: number;
  /** Comments deevy left in a tracker, saying back what happened here. */
  mirrored: number;
  /** Messages a chat tool was sent or had changed: a Gate in Slack, and its update. */
  chatMessages: number;
  /** The signal was aborted, so the passes after that point did not run. */
  aborted: boolean;
}

/**
 * One trigger's worth of deevy's background work: the stale sweep and the
 * delivery loops, in that order. None of it starts a Run: routing and the
 * parent wake do (docs/plans/simplify.md, slice 6). Nor does it remind
 * anybody of a Gate: Needs me lists it for as long as it is open (slice 8).
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
  sockets,
  socketSecret,
  fetch,
}: RunDueWorkOptions): Promise<DueWorkResult> {
  const {
    silenceMs = defaultSilenceMs,
    sweepLimit,
    deliveryLimit,
    maxPasses = defaultMaxPasses,
  } = limits;
  const sweepBound = sweepLimit === undefined ? {} : { limit: sweepLimit };
  const deliveryBound = deliveryLimit === undefined ? {} : { limit: deliveryLimit };

  const result: DueWorkResult = {
    staleRuns: 0,
    webhooks: 0,
    forgottenDeliveries: 0,
    mirrored: 0,
    chatMessages: 0,
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
  // And what is owed to a subscribed URL, which needs no origin: the body is
  // the Event itself and carries no link (ADR-0003).
  await drain(
    () =>
      deliverDueWebhooks({ db, workspaceId, now, ...deliveryBound, ...(fetch ? { fetch } : {}) }),
    (of) => {
      result.webhooks += of.delivered;
    },
  );
  // And what the trackers are owed: deevy saying back where the work lives, so
  // a team never has to come here to follow along (ADR-0024). Without a
  // registry there is nothing to say it to.
  if (sockets) {
    await drain(
      () =>
        deliverDueSocketMirrors({
          db,
          workspaceId,
          sockets,
          now,
          ...(socketSecret ? { socketSecret } : {}),
          ...(baseUrl ? { baseUrl } : {}),
          ...(fetch ? { fetch } : {}),
          ...deliveryBound,
        }),
      (of) => {
        result.mirrored += of.delivered;
      },
    );
  }
  // And what a chat tool is owed: a Gate in the channel its Project binds,
  // and the update its message is owed when somebody rules. A Gate message
  // links into deevy, so without an origin it waits (ADR-0025).
  if (sockets && baseUrl) {
    await drain(
      () =>
        deliverDueChatMessages({
          db,
          workspaceId,
          sockets,
          baseUrl,
          now,
          ...(socketSecret ? { socketSecret } : {}),
          ...(fetch ? { fetch } : {}),
          ...deliveryBound,
        }),
      (of) => {
        result.chatMessages += of.delivered;
      },
    );
  }
  // Bookkeeping, last: a delivery nobody can replay is not a Workspace event,
  // and forgetting one appends nothing (sockets/hooks.ts).
  await drain(
    () => forgetOldDeliveries({ db, now, ...sweepBound }),
    (of) => {
      result.forgottenDeliveries += of.scanned;
    },
  );

  return result;
}
