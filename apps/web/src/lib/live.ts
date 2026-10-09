import {
  matchQuery,
  useQueryClient,
  type Query,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { appURL } from "@/lib/base";
import { client, orpc } from "@/lib/orpc";

/** What one Event may have changed on screen, by what it was about. */
export interface LiveEvent {
  subjectType: string;
  projectId: string | null;
}

/**
 * The queries an Event could have changed. Every Event touches the log; what
 * else it touches follows from its subject, so a Run's Activity re-reads Runs
 * and the inbox and nothing about Members. The list errs towards re-reading:
 * an Issue Event covers its comments, Documents and Links too, because those
 * are shown on the same screen and their Events are Issue Events.
 */
export function keysFor(event: LiveEvent): QueryKey[] {
  const keys: QueryKey[] = [orpc.events.key()];
  switch (event.subjectType) {
    case "issue":
      keys.push(orpc.issues.key(), orpc.comments.key(), orpc.links.key(), orpc.inbox.key());
      break;
    case "run":
      // A Run's own Events move the Gate it is waiting at as well: a ruling
      // resumes it, and the Gate screen is reading the same request.
      keys.push(orpc.runs.key(), orpc.gates.key(), orpc.inbox.key());
      break;
    case "gate":
      // A ruling somebody else made, from deevy, the tracker or Slack: the
      // card in front of this Human has to stop offering a decision that has
      // already been taken (ADR-0025).
      keys.push(orpc.gates.key(), orpc.runs.key(), orpc.inbox.key());
      break;
    case "socket":
      keys.push(orpc.sockets.key());
      break;
    case "project":
      keys.push(orpc.projects.key(), orpc.issues.key());
      break;
    case "member":
      // me.get carries the caller's role and suspension, which are Member Events.
      keys.push(orpc.members.key(), orpc.agents.key(), orpc.inbox.key(), orpc.me.key());
      break;
    case "allowlist_rule":
      keys.push(orpc.allowlist.key());
      break;
    case "invitation":
      // A Member joined by one, or an admin issued or revoked one: the Invited
      // row and the Members list are both a screen behind until they re-read.
      keys.push(orpc.invitations.key(), orpc.members.key());
      break;
    case "channel":
      keys.push(orpc.channels.key(), orpc.routing.key());
      break;
    case "webhook":
      keys.push(orpc.webhooks.key());
      break;
    case "workspace":
      // routing.updated is a Workspace Event, and me.get carries the Workspace's name.
      keys.push(orpc.workspace.key(), orpc.routing.key(), orpc.me.key());
      break;
    default:
      if (event.projectId) keys.push(orpc.issues.key());
  }
  return keys;
}

/** How long invalidations are gathered before one pass re-reads each key once. */
export const COALESCE_MS = 16;

/**
 * Whether an Event could still change what a query holds. A finished Run's
 * detail never changes — its Activities are written, its clocks stopped — so
 * an Issue with twenty-five finished Runs does not re-read all of them on
 * every Activity tick of the one still working (review of #8, item 3).
 */
export function stillChanging(query: Query): boolean {
  if (!matchQuery({ queryKey: orpc.runs.get.key() }, query)) return true;
  const data = query.state.data as { finishedAt?: unknown } | undefined;
  return !data?.finishedAt;
}

/**
 * How long a hidden tab keeps listening before it lets go (ADR-0032). Long
 * enough that glancing at another tab costs nothing; short enough that a tab
 * left behind all afternoon holds nothing open on the server — on a hosted
 * Workspace, an open stream is an object kept awake and billed.
 */
export const HIDDEN_GRACE_MS = 30_000;

/** How long a connection that failed waits before the next one. */
export const RETRY_MS = 2_000;

/**
 * How often an open socket says it is still there. The server answers without
 * waking (apps/hosted), and two rounds unanswered mean the line died without
 * saying so, which is what a laptop's socket does when it sleeps.
 */
export const PING_MS = 30_000;

/** How many Events one catch-up read asks for. */
const PAGE = 200;

/** How a deployment tells an open tab about new Events, as `health.ping` says. */
export type LiveTransport = "stream" | "websocket";

/** Where everything a connection hears goes: one cursor, one way to invalidate. */
interface Reader {
  cursor: { current: number | undefined };
  take(event: LiveEvent & { seq: number }): void;
}

/**
 * How one connection ended. A stream that `ended` signed off with its cursor
 * and is resumed at once; one that `failed`, and a socket that `dropped` after
 * opening, wait a moment first. A socket `refused` before it ever opened —
 * a proxy that strips upgrades, a session that is over — hands over to one
 * stream at once, which either works or says why the way it always has.
 */
type Outcome = "ended" | "failed" | "dropped" | "refused";

/**
 * Keeps this browser in step with the Workspace by reading the Event log as it
 * happens (docs/plans/m1.md slice 7). Every Event invalidates the queries that
 * could show it, so nothing here decides what changed: the Event log does.
 *
 * Invalidations are coalesced: an Agent posting an Activity a second while a
 * list, a peek and the inbox are all mounted must cost one refetch per key per
 * tick, not one per Event per key (docs/plans/ui-redesign.md, slice 1).
 *
 * How it hears is the deployment's to say (ADR-0032): where `health.ping`
 * offers a socket, the server pushes each new seq and the tab reads the Events
 * with `events.list`; everywhere else it reads `events.subscribe`. Either way a
 * tab hidden for longer than `HIDDEN_GRACE_MS` lets go, and shown again it
 * resumes from its cursor, so what changed meanwhile is re-read once.
 */
export function useLiveEvents(enabled: boolean) {
  const queryClient = useQueryClient();
  const cursor = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    const pending = new Map<string, QueryKey>();
    let flush: ReturnType<typeof setTimeout> | null = null;
    function invalidateLater(keys: QueryKey[]) {
      for (const key of keys) pending.set(JSON.stringify(key), key);
      flush ??= setTimeout(() => {
        flush = null;
        const batch = [...pending.values()];
        pending.clear();
        void Promise.all(
          batch.map((queryKey) =>
            queryClient.invalidateQueries({ queryKey, predicate: stillChanging }),
          ),
        );
      }, COALESCE_MS);
    }
    const reader: Reader = {
      cursor,
      take(event) {
        cursor.current = event.seq;
        invalidateLater(keysFor(event));
      },
    };
    const transport = offeredTransport(queryClient);

    let following: AbortController | null = null;
    function connect() {
      if (following || disposed) return;
      following = new AbortController();
      void follow(reader, transport, following.signal);
    }
    function disconnect() {
      following?.abort();
      following = null;
    }

    let grace: ReturnType<typeof setTimeout> | null = null;
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        grace ??= setTimeout(() => {
          grace = null;
          disconnect();
        }, HIDDEN_GRACE_MS);
        return;
      }
      if (grace) clearTimeout(grace);
      grace = null;
      connect();
    }

    // A tab opened in the background connects too, and lets go after the grace.
    connect();
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (grace) clearTimeout(grace);
      disconnect();
      if (flush) clearTimeout(flush);
    };
  }, [enabled, queryClient]);
}

/** What this deployment offers, asked once per mount; the stream when it cannot say. */
async function offeredTransport(queryClient: QueryClient): Promise<LiveTransport> {
  if (typeof WebSocket !== "function") return "stream";
  try {
    const ping = await queryClient.fetchQuery(orpc.health.ping.queryOptions());
    return ping.live === "websocket" ? "websocket" : "stream";
  } catch {
    return "stream";
  }
}

/** One connection after another, from the cursor, until `signal` says stop. */
async function follow(
  reader: Reader,
  transport: Promise<LiveTransport>,
  signal: AbortSignal,
): Promise<void> {
  let streamNext = false;
  while (!signal.aborted) {
    const viaSocket: boolean = (await transport) === "websocket" && !streamNext;
    const outcome: Outcome = viaSocket
      ? await readSocket(reader, signal)
      : await readStream(reader, signal);
    // After a refused socket one stream, and the socket again once it ends:
    // in a hosted Workspace's object that is minutes, not forever.
    streamNext = outcome === "refused";
    if (outcome === "failed" || outcome === "dropped") await pause(RETRY_MS, signal);
  }
}

/**
 * One `events.subscribe`, from the cursor. A stream that ends of its own
 * accord is not a failure. On Workers every stream does: it spends its query
 * budget and signs off with a heartbeat carrying the cursor it reached, so the
 * next one resumes exactly and the board is one poll behind rather than two
 * seconds behind (docs/plans/m3.md slice 7). A stream that ends having said
 * nothing at all is a different thing — nothing to resume from, and
 * reconnecting at once would be a hot loop — so it waits like a failure does.
 */
async function readStream(reader: Reader, signal: AbortSignal): Promise<Outcome> {
  let delivered = 0;
  try {
    const stream = await client.events.subscribe({ after: reader.cursor.current }, { signal });
    for await (const message of stream) {
      if (signal.aborted) break;
      delivered += 1;
      if (message.type === "heartbeat") {
        reader.cursor.current = message.cursor ?? reader.cursor.current;
        continue;
      }
      reader.take(message.event);
    }
  } catch {
    return "failed";
  }
  return delivered > 0 ? "ended" : "failed";
}

/**
 * One socket at `/api/live`, until it closes. The server says the head of the
 * log as it opens and again whenever the log grows, and nothing else; the
 * Events are read from the cursor with `events.list`, under this tab's own
 * session, so the socket never carries what this Member may not see.
 */
function readSocket(reader: Reader, signal: AbortSignal): Promise<Outcome> {
  return new Promise((resolve) => {
    const socket = new WebSocket(appURL("/api/live").replace(/^http/, "ws"));
    let opened = false;
    let heard = Date.now();
    let keepalive: ReturnType<typeof setInterval> | undefined;
    let wanted = 0;
    let reading = false;

    function finish() {
      clearInterval(keepalive);
      signal.removeEventListener("abort", finish);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.close();
      resolve(opened ? "dropped" : "refused");
    }

    /** Reads from the cursor up to `head`, once at a time; a nudge mid-read extends it. */
    async function catchUp(head: number) {
      wanted = Math.max(wanted, head);
      if (reading) return;
      reading = true;
      try {
        while (!signal.aborted) {
          const from = reader.cursor.current;
          // A first connection starts from now, as a first stream does.
          if (from === undefined) {
            reader.cursor.current = wanted;
            break;
          }
          if (from >= wanted) break;
          const target = wanted;
          const page = await client.events.list({ after: from, limit: PAGE }, { signal });
          for (const event of page.events) reader.take(event);
          // A short page is the end of the log as of the nudge, Events this
          // Member is not shown included, so the cursor may stand there.
          if (page.events.length < PAGE) {
            reader.cursor.current = Math.max(reader.cursor.current ?? target, target);
          }
        }
      } catch {
        // Let this socket go; the next one opens with the head and reads again.
        if (!signal.aborted) finish();
      } finally {
        reading = false;
      }
    }

    socket.onopen = () => {
      opened = true;
      heard = Date.now();
      keepalive = setInterval(() => {
        if (Date.now() - heard > 2 * PING_MS) return finish();
        socket.send("ping");
      }, PING_MS);
    };
    socket.onmessage = (message: MessageEvent) => {
      heard = Date.now();
      const seq = seqOf(message.data);
      if (seq !== null) void catchUp(seq);
    };
    socket.onclose = finish;
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** The seq a push names, or null for anything else (the keepalive's `pong`). */
function seqOf(data: unknown): number | null {
  if (typeof data !== "string" || !data.startsWith("{")) return null;
  try {
    const { seq } = JSON.parse(data) as { seq?: unknown };
    return typeof seq === "number" && Number.isInteger(seq) ? seq : null;
  } catch {
    return null;
  }
}

/** Waits, or stops waiting as soon as `signal` says stop. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
