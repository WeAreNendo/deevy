/**
 * The Event log as it happens, in a terminal.
 *
 * `events.subscribe` is the one streaming operation, and it is not a command
 * the generator can make: every other operation is awaited for a value, and
 * awaiting an async generator as if it were one waits forever.
 *
 * The loop matters as much as the stream. A stream on Workers **ends itself**,
 * signing off with the cursor the caller resumes from, because each poll is one
 * D1 query against a per-invocation cap (ADR-0012). So a `for await` that runs
 * once works against the Docker deployment and silently stops after one poll
 * against a Workers one — which is exactly the shape of bug that is found in
 * production rather than in a test. This reconnects the way the SPA does
 * (apps/web/src/lib/live.ts): straight away when the cursor moved, and after a
 * pause when the stream said nothing, so a stream that ends empty is not a hot
 * loop.
 */
import type { DeevyClient } from "./client.ts";
import type { Ink } from "./render.ts";
import { plain } from "./render.ts";

/**
 * One Event, as the log actually stores it.
 *
 * There is no `issueKey` column — an Event names its subject by type and id,
 * and the Issue key it is about rides in the payload, which is where deevy's
 * own renderer reads it from (apps/web/src/lib/event-text.ts). Writing this
 * interface from memory rather than from the schema is what put a field here
 * that does not exist, and a double cast is what stopped the compiler saying so.
 */
export interface WatchedEvent {
  seq: number;
  kind: string;
  subjectType?: string | null;
  subjectId?: string | null;
  payload?: unknown;
  actorMemberId?: string | null;
  createdAt?: Date | string | null;
}

export interface WatchOptions {
  /** Resume from here; omitted, the stream starts with what happens next. */
  after?: number;
  projectId?: string;
  json?: boolean;
  ink?: Ink;
  out?: (line: string) => void;
  /** Anything that is not an Event: it must not land in `--json`'s stream. */
  note?: (line: string) => void;
  signal?: AbortSignal;
  /** How long to wait after a stream that said nothing. */
  idleMs?: number;
  /** Turns a refusal into the sentence a person can act on; `explain` in practice. */
  explain?: (error: unknown) => string;
  /** Stop after this many Events; only a test passes it. */
  limit?: number;
}

/** The Issue key an Event is about, when it is about one. */
function subjectOf(event: WatchedEvent): string {
  const payload = event.payload;
  if (payload !== null && typeof payload === "object") {
    const key = (payload as { key?: unknown }).key;
    if (typeof key === "string") return key;
  }
  return event.subjectId ?? "";
}

export function eventLine(event: WatchedEvent, ink: Ink): string {
  const at = event.createdAt;
  // Local time with a marker, because a bare ISO string in a terminal is read
  // as local and is not.
  const when =
    at instanceof Date || typeof at === "string"
      ? `${new Date(at).toISOString().replace("T", " ").slice(0, 19)}Z`
      : "";
  // The Event's own vocabulary, in the order CONTEXT.md describes one: what
  // changed, what it was about, and when.
  const about = subjectOf(event);
  return `${ink.dim(String(event.seq).padStart(6))}  ${ink.dim(when)}  ${event.kind}${about ? ` ${about}` : ""}`;
}

/**
 * Follow the log until the signal says stop.
 *
 * Returns the cursor it reached, so a caller that stops can say where to
 * resume — and so a test can assert the loop advanced rather than spun.
 */
export async function watch(
  client: DeevyClient,
  options: WatchOptions = {},
): Promise<number | undefined> {
  const out =
    options.out ??
    ((line: string) => {
      console.log(line);
    });
  const note =
    options.note ??
    ((line: string) => {
      console.error(line);
    });
  const ink = options.ink ?? plain;
  const idleMs = options.idleMs ?? 2000;
  const explainer =
    options.explain ??
    ((error: unknown) => (error instanceof Error ? error.message : String(error)));
  let cursor = options.after;
  let seen = 0;

  while (!options.signal?.aborted) {
    let delivered = 0;
    const startedAt = Date.now();
    try {
      const stream = await client.events.subscribe(
        {
          ...(cursor === undefined ? {} : { after: cursor }),
          ...(options.projectId ? { projectId: options.projectId } : {}),
        },
        options.signal ? { signal: options.signal } : {},
      );
      for await (const message of stream) {
        if (options.signal?.aborted) return cursor;
        delivered += 1;
        // A heartbeat carries the cursor and nothing else: it is how a stream
        // that has seen no Events still lets the caller resume.
        if (message.type === "heartbeat") {
          cursor = message.cursor ?? cursor;
          continue;
        }
        const event: WatchedEvent = message.event;
        cursor = event.seq;
        out(options.json === true ? JSON.stringify(message.event) : eventLine(event, ink));
        seen += 1;
        if (options.limit !== undefined && seen >= options.limit) return cursor;
      }
      // Ended having said something *and* having lasted: the cursor moved, so
      // pick it straight up rather than leaving a gap.
      //
      // "Said something" alone is not enough. `subscribeToEvents` yields an
      // opening heartbeat before its loop, so every stream that opens has
      // spoken — which made this branch unconditional and the pause below
      // unreachable. Against an instance whose streams end at once that is
      // thousands of requests a second from a process somebody left running.
      if (delivered > 0 && Date.now() - startedAt >= MIN_ROUND_MS) continue;
    } catch (error) {
      if (options.signal?.aborted) return cursor;
      // A credential that will never work, an input the server will never
      // accept: retrying is a loop that hides the answer. Convention 27 of
      // docs/plans/cli.md holds here too — a refusal is explained, not relayed
      // — and this is the one command that does not go through generate.ts.
      if (permanent(error)) throw new Error(explainer(error));
      note(ink.dim(`(reconnecting: ${error instanceof Error ? error.message : String(error)})`));
    }
    await sleep(idleMs, options.signal);
  }
  return cursor;
}

/** Shorter than any real stream, long enough that an instant one is noticed. */
const MIN_ROUND_MS = 250;

/**
 * A failure that another attempt will not fix: the credential, the input, or
 * the operation not being there.
 */
function permanent(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return (
    code === "UNAUTHORIZED" ||
    code === "FORBIDDEN" ||
    code === "BAD_REQUEST" ||
    code === "NOT_FOUND" ||
    code === "NOT_IMPLEMENTED"
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
