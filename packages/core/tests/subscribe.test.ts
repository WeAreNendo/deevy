import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { appendEvent } from "../src/events.ts";
import { router } from "../src/operations/index.ts";
import { countingDb, memberContext, testDb } from "./helpers.ts";
import { newId } from "../src/ids.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("events.subscribe", () => {
  it(
    "opens with a heartbeat carrying the cursor it will read from",
    { timeout: 15000 },
    async () => {
      const { db, close } = testDb();
      closers.push(close);
      const context = await memberContext(db);
      const existing = await appendEvent(context, {
        kind: "workspace.created",
        subjectType: "workspace",
        subjectId: context.workspace.id,
      });
      const client = createRouterClient(router, { context });
      const controller = new AbortController();

      const stream = await client.events.subscribe({}, { signal: controller.signal });
      let opening: { type: string; cursor?: number | null } | undefined;
      for await (const message of stream) {
        opening = message;
        break;
      }
      controller.abort();

      // Without `after`, the stream starts from what happens next, and says so.
      expect(opening).toMatchObject({ type: "heartbeat", cursor: existing.seq });
    },
  );

  it("yields Events appended once it is reading", { timeout: 15000 }, async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db);
    const client = createRouterClient(router, { context });
    const controller = new AbortController();

    const stream = await client.events.subscribe({}, { signal: controller.signal });
    const seen: string[] = [];
    const opened = Promise.withResolvers<void>();
    const reading = (async () => {
      for await (const message of stream) {
        if (message.type === "heartbeat") opened.resolve();
        if (message.type === "event") seen.push(message.event.kind);
        if (seen.length === 1) break;
      }
    })();

    // The opening heartbeat is the signal that the cursor is fixed; appending
    // before it would land in the gap the cursor is chosen from.
    await opened.promise;
    await appendEvent(context, {
      kind: "issue.created",
      subjectType: "issue",
      subjectId: newId("issue"),
    });
    await reading;
    controller.abort();

    expect(seen).toEqual(["issue.created"]);
  });

  it(
    "starts from the cursor it is given, skipping what came before",
    { timeout: 15000 },
    async () => {
      const { db, close } = testDb();
      closers.push(close);
      const context = await memberContext(db);
      const before = await appendEvent(context, {
        kind: "workspace.created",
        subjectType: "workspace",
        subjectId: context.workspace.id,
      });
      const client = createRouterClient(router, { context });
      const controller = new AbortController();

      const stream = await client.events.subscribe(
        { after: before.seq },
        { signal: controller.signal },
      );
      const seen: string[] = [];
      const reading = (async () => {
        for await (const message of stream) {
          if (message.type === "event") seen.push(message.event.kind);
          if (seen.length === 1) break;
        }
      })();

      await appendEvent(context, {
        kind: "member.joined",
        subjectType: "member",
        subjectId: context.member.id,
      });
      await reading;
      controller.abort();

      expect(seen).toEqual(["member.joined"]);
    },
  );

  it("ends when the request is aborted", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db);
    const client = createRouterClient(router, { context });
    const controller = new AbortController();

    const stream = await client.events.subscribe({}, { signal: controller.signal });
    const drained = (async () => {
      for await (const _ of stream) {
        // Nothing is appended, so this only ends when the signal fires.
      }
      return "ended";
    })();
    controller.abort();

    expect(await Promise.race([drained, timeout(3000)])).toBe("ended");
  });

  it("refuses an anonymous caller", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const client = createRouterClient(router, {
      context: { db, session: null, member: null, workspace: null },
    });
    await expect(client.events.subscribe({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

function timeout(ms: number) {
  return new Promise((resolve) => setTimeout(() => resolve("timed out"), ms));
}

describe("a stream that has to end", () => {
  it("returns after maxDurationMs, with a heartbeat carrying the seq it got to", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db);
    const client = createRouterClient(router, {
      context: { ...context, live: { pollMs: 50, maxDurationMs: 500 } },
    });
    const controller = new AbortController();
    closers.push(() => {
      controller.abort();
    });

    // Measured from the subscriber's side, which is the only side that can see
    // it: the stream's clock starts no earlier than this call.
    const started = Date.now();
    const stream = await client.events.subscribe({ after: 0 }, { signal: controller.signal });
    const appended = await appendEvent(context, {
      kind: "issue.created",
      subjectType: "issue",
      subjectId: newId("issue"),
    });

    const seen: Array<{ type: string; cursor?: number | null }> = [];
    for await (const message of stream) seen.push(message);

    // It ends *after* its duration and not before: a stream that signed off
    // early would still send the right messages, and would spend half the
    // budget it was given while the board went stale waiting for it.
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    // The Event the stream did yield, and then the cursor a subscriber resumes
    // from, so ending is something the client can act on rather than a drop.
    expect(seen.map((message) => message.type)).toEqual(["heartbeat", "event", "heartbeat"]);
    expect(seen.at(-1)).toEqual({ type: "heartbeat", cursor: appended.seq });
  });

  /**
   * On D1 a stream's life is arithmetic: one query per poll, against a cap on
   * the queries one invocation may run. So the number that matters is the one
   * the entry can compute before it chooses a duration, and it is asserted
   * here rather than assumed (docs/plans/m3.md slice 7).
   */
  it("runs no more queries than maxDurationMs / pollMs", async () => {
    const { db, close, statements } = countingDb();
    closers.push(close);
    const context = await memberContext(db);
    const live = { pollMs: 100, maxDurationMs: 1000 };
    const client = createRouterClient(router, { context: { ...context, live } });
    const controller = new AbortController();
    closers.push(() => {
      controller.abort();
    });

    // `after` spares the stream the query that would have found its cursor, so
    // what is left to count is polls and nothing else.
    const stream = await client.events.subscribe({ after: 0 }, { signal: controller.signal });
    statements.length = 0;
    const seen: Array<{ type: string }> = [];
    for await (const message of stream) seen.push(message);

    expect(statements.length).toBeGreaterThan(1);
    expect(statements.length).toBeLessThanOrEqual(live.maxDurationMs / live.pollMs);
    expect(seen.at(-1)).toEqual({ type: "heartbeat", cursor: 0 });
  });

  /**
   * The seam a self-ending stream opens: an Event appended after its last poll
   * is one it will never deliver, so the cursor it signs off with has to be the
   * last seq it actually yielded and not the last seq in the log. The two
   * streams together see every Event exactly once, which is the whole claim.
   */
  it("hands the next stream everything it did not deliver itself", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db);
    const live = { pollMs: 200, maxDurationMs: 600 };
    const client = createRouterClient(router, { context: { ...context, live } });
    const controller = new AbortController();
    closers.push(() => {
      controller.abort();
    });

    const first = await appendEvent(context, {
      kind: "issue.created",
      subjectType: "issue",
      subjectId: newId("issue"),
    });
    const stream = await client.events.subscribe({ after: 0 }, { signal: controller.signal });

    // Appended between the stream's last poll and its deadline: the Event with
    // nowhere to be delivered but the stream that comes next.
    const during = new Promise<{ seq: number }>((resolve, reject) => {
      setTimeout(() => {
        appendEvent(context, {
          kind: "issue.synced",
          subjectType: "issue",
          subjectId: newId("issue"),
        }).then(resolve, reject);
      }, 500);
    });

    const delivered: number[] = [];
    let cursor = 0;
    for await (const message of stream) {
      if (message.type === "event") delivered.push(message.event.seq);
      else cursor = message.cursor ?? cursor;
    }

    const second = await during;
    const third = await appendEvent(context, {
      kind: "issue.closed",
      subjectType: "issue",
      subjectId: newId("issue"),
    });

    const resumed = await client.events.subscribe({ after: cursor }, { signal: controller.signal });
    for await (const message of resumed) {
      if (message.type === "event") delivered.push(message.event.seq);
      if (delivered.includes(third.seq)) break;
    }

    expect(delivered).toEqual([first.seq, second.seq, third.seq]);
  });

  /**
   * The default is unbounded, which is what makes the parameter invisible to
   * `apps/server`: a Node process holds a connection for as long as the browser
   * does, and nothing in this slice changes that (docs/plans/m3.md slice 7).
   */
  it("stays open when nothing gave it a duration", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db);
    const client = createRouterClient(router, { context });
    const controller = new AbortController();

    const stream = await client.events.subscribe({ after: 0 }, { signal: controller.signal });
    const drained = (async () => {
      for await (const _ of stream) {
        // Nothing is appended, so only an end of its own could finish this.
      }
      return "ended";
    })();

    // Longer than any bounded stream in this file lives, and longer than the
    // poll it would have to end on.
    expect(await Promise.race([drained, timeout(1500)])).toBe("timed out");
    controller.abort();
  });
});
