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

/** One Event, as a line. */
export interface WatchedEvent {
  seq: number;
  kind: string;
  issueKey?: string | null;
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
  signal?: AbortSignal;
  /** How long to wait after a stream that said nothing. */
  idleMs?: number;
  /** Stop after this many Events; only a test passes it. */
  limit?: number;
}

export function eventLine(event: WatchedEvent, ink: Ink): string {
  const when =
    event.createdAt instanceof Date
      ? event.createdAt.toISOString().replace("T", " ").slice(0, 19)
      : typeof event.createdAt === "string"
        ? event.createdAt.replace("T", " ").slice(0, 19)
        : "";
  // The Event's own vocabulary, in the order CONTEXT.md describes one: what
  // changed, what it was about, and when.
  const about = event.issueKey ? ` ${event.issueKey}` : "";
  return `${ink.dim(String(event.seq).padStart(6))}  ${ink.dim(when)}  ${event.kind}${about}`;
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
  const ink = options.ink ?? plain;
  const idleMs = options.idleMs ?? 2000;
  let cursor = options.after;
  let seen = 0;

  while (!options.signal?.aborted) {
    let delivered = 0;
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
        const event = message.event as unknown as WatchedEvent;
        cursor = event.seq;
        out(options.json === true ? JSON.stringify(message.event) : eventLine(event, ink));
        seen += 1;
        if (options.limit !== undefined && seen >= options.limit) return cursor;
      }
      // Ended having said something: the cursor moved, so pick it straight up
      // rather than leaving a gap somebody has to notice.
      if (delivered > 0) continue;
    } catch (error) {
      if (options.signal?.aborted) return cursor;
      // A stream that fails is the same as one that ends empty, as far as what
      // to do next goes — but say so once, because a watch that goes quiet for
      // a bad reason should not look like one that is simply waiting.
      out(ink.dim(`(reconnecting: ${error instanceof Error ? error.message : String(error)})`));
    }
    await sleep(idleMs, options.signal);
  }
  return cursor;
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
