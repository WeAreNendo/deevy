import type { Db, Event } from "@deevy/db";

/** How often the stream looks for new Events, and how often it says it is still there. */
export const POLL_MS = 1000;
export const HEARTBEAT_MS = 15_000;

/** What a subscriber receives: an Event, or a heartbeat carrying the cursor. */
export type LiveMessage =
  | { type: "event"; event: Event }
  | { type: "heartbeat"; cursor: number | null };

/**
 * What a runtime decides about a stream rather than a subscriber: how often it
 * looks, and how long it may live. Both are arguments an entry passes, so the
 * core never asks which runtime it is on (docs/plans/m3.md).
 */
export interface LiveOptions {
  /** How often the stream looks for new Events. Defaults to POLL_MS. */
  pollMs?: number;
  /**
   * How long the stream may run before ending itself. Absent, it runs until
   * the request is aborted, which is what `apps/server` wants: a Node process
   * holds a connection for as long as the browser does. A Worker sets it,
   * because each poll is one D1 query and D1 caps the queries one invocation
   * may run, so a stream's life is that cap divided by its poll interval —
   * and a stream that ends itself ends cleanly, with a cursor, rather than
   * being cut off by the platform mid-message.
   */
  maxDurationMs?: number;
}

/**
 * Who a pushed socket is for, once the core has admitted them: the same rule
 * `events.subscribe` answers to, decided by the core so the entry decides
 * nothing about who may read (ADR-0032).
 */
export interface LiveReader {
  memberId: string;
  workspaceId: string;
  /** When the session behind the socket ends; a socket outliving it is closed at the next push. */
  expiresAt: number;
  /** The newest seq in the log as the socket opens: the first thing it is told. */
  head: number;
}

/**
 * A runtime that can keep a browser's socket open without keeping itself
 * awake, and push to it when the log grows (ADR-0032): a hosted Workspace's
 * Durable Object, with WebSocket hibernation. The core admits the reader and
 * the entry answers the upgrade, holds the socket, and sends it a seq whenever
 * `onEventAppended` says the log grew. What the socket carries is a number and
 * nothing else, so what changed is read through the operations, under the
 * reader's own authority, and no authorization is decided twice.
 *
 * Absent — Node, the self-hosted Worker — `health.ping` says `stream` and the
 * SPA reads `events.subscribe` as it always has.
 */
export interface LiveSocket {
  accept(request: Request, reader: LiveReader): Response | Promise<Response>;
}

type AppendedListener = (event: Event) => void;

/**
 * The log's listeners, by the database they listen to. Keyed by the handle
 * rather than held globally, because one isolate runs many hosted Workspaces,
 * each its own object with its own handle: a listener can only ever hear the
 * log of the database it registered on.
 */
const listeners = new WeakMap<Db, Set<AppendedListener>>();

/**
 * Calls `listener` with every Event appended through `db` from now on, once
 * its Notifications and deliveries are written, and returns the function that
 * stops it. Every append goes through `appendEvent`, whichever path built its
 * source — an operation, a tool's delivery, a sign-in, a sweep — so a listener
 * on the handle hears all of them without each path having to carry it.
 *
 * A listener must not throw and must not wait: it runs in the tail of a write
 * that has already succeeded. One that throws is ignored.
 */
export function onEventAppended(db: Db, listener: AppendedListener): () => void {
  let set = listeners.get(db);
  if (!set) {
    set = new Set();
    listeners.set(db, set);
  }
  set.add(listener);
  return () => {
    listeners.get(db)?.delete(listener);
  };
}

/** Tells `db`'s listeners about an Event `appendEvent` just wrote (events.ts). */
export function announceAppended(db: Db, event: Event): void {
  const set = listeners.get(db);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      // A push that failed must not turn a write that succeeded into a failure.
    }
  }
}

/** The newest seq in a Workspace's log, or 0 when it has none. */
export async function headOf(db: Db, workspaceId: string): Promise<number> {
  return latestSeq({ db, workspaceId });
}

export interface SubscribeOptions extends LiveOptions {
  db: Db;
  workspaceId: string;
  projectId?: string | null;
  after?: number;
  signal?: AbortSignal;
  heartbeatMs?: number;
}

/**
 * The Event log as a stream. Everything is request-scoped: the loop ends when
 * the request's abort signal fires, and no timer outlives it, so the same code
 * runs on Workers (ADR-0006). Polling rather than an in-process bus for the
 * same reason: two isolates share the database, not memory.
 *
 * With `after`, the stream resumes from that seq. Without it, it starts from
 * whatever happens next, and the cursor is fixed on the first tick rather than
 * when the request arrives. The opening heartbeat reports that cursor, so a
 * subscriber that also loaded a page of Events can tell whether it missed any
 * and re-read them; a client that cares should pass the `nextCursor` that
 * `events.list` gave it rather than rely on the gap being empty.
 *
 * With `maxDurationMs`, the stream ends itself when its time is up, and the
 * last thing it sends is a heartbeat carrying the cursor it reached. Ending is
 * therefore something a subscriber can act on: it resumes exactly where this
 * stream stopped instead of reconnecting blind and hoping the gap was empty.
 */
export async function* subscribeToEvents(
  options: SubscribeOptions,
): AsyncGenerator<LiveMessage, void, unknown> {
  const pollMs = options.pollMs ?? POLL_MS;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const deadline =
    options.maxDurationMs === undefined ? undefined : Date.now() + options.maxDurationMs;
  let cursor = options.after ?? (await latestSeq(options));
  let lastBeat = Date.now();

  // The stream opens with its cursor, so a subscriber knows where it is
  // reading from before anything happens, and can resume there after a drop.
  yield { type: "heartbeat", cursor };

  while (!options.signal?.aborted) {
    // The deadline is checked before the query rather than after it, so the
    // queries a stream runs are its duration divided by its poll interval and
    // never one more: on D1 that division is the whole budget.
    if (deadline !== undefined && Date.now() >= deadline) {
      yield { type: "heartbeat", cursor };
      return;
    }
    const rows = await readAfter(options, cursor);
    for (const event of rows) {
      cursor = event.seq;
      yield { type: "event", event };
      lastBeat = Date.now();
    }
    if (options.signal?.aborted) return;
    if (Date.now() - lastBeat >= heartbeatMs) {
      yield { type: "heartbeat", cursor };
      lastBeat = Date.now();
    }
    await sleep(pollMs, options.signal);
  }
}

async function latestSeq(
  options: Pick<SubscribeOptions, "db" | "workspaceId" | "projectId">,
): Promise<number> {
  const rows = await options.db.query.event.findMany({
    where: {
      workspaceId: options.workspaceId,
      ...(options.projectId ? { projectId: options.projectId } : {}),
    },
    orderBy: { seq: "desc" },
    limit: 1,
    columns: { seq: true },
  });
  return rows[0]?.seq ?? 0;
}

function readAfter(options: SubscribeOptions, cursor: number) {
  return options.db.query.event.findMany({
    where: {
      workspaceId: options.workspaceId,
      seq: { gt: cursor },
      ...(options.projectId ? { projectId: options.projectId } : {}),
    },
    orderBy: { seq: "asc" },
    limit: 200,
  });
}

/** Resolves early when the request is aborted, so nothing keeps the loop alive. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
  });
}
