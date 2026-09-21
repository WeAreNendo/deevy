import { afterEach, describe, expect, it } from "vite-plus/test";
import { startLoop } from "../src/loop.ts";
import type { Pass } from "../src/work.ts";
import { finished, instance, scripted } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/** A wait that records what it was asked for and returns at once. */
function recordingSleep() {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number, signal: AbortSignal) => {
      waits.push(ms);
      if (signal.aborted) return;
      await Promise.resolve();
    },
  };
}

/** Stops the loop after it has reported `count` passes. */
function stopAfter(count: number) {
  let seen = 0;
  const passes: Pass[] = [];
  let stop: () => void = () => undefined;
  return {
    passes,
    arm: (halt: () => void) => {
      stop = halt;
    },
    onPass: (pass: Pass) => {
      passes.push(pass);
      seen += 1;
      if (seen >= count) stop();
    },
  };
}

describe("the loop", () => {
  it("backs off while there is nothing to do, and drops back the moment there is", async () => {
    const it = await instance();
    closers.push(it.close);
    const clock = recordingSleep();
    const counter = stopAfter(4);
    let assigned = false;

    const loop = startLoop({
      deevy: it.deevy,
      proxy: it.proxy,
      runTimeoutMs: 5_000,
      pollSeconds: 1,
      maxPollSeconds: 4,
      sleep: clock.sleep,
      onPass: (pass) => {
        counter.onPass(pass);
        if (clock.waits.length === 2 && !assigned) {
          assigned = true;
          void (async () => {
            await it.assign("Ship it");
          })();
        }
      },
      session: scripted([
        async () => {
          const [run] = await it.deevy.runs("pending");
          await it.deevy.finishRun(run.id, "completed", "Planned it");
        },
        finished,
      ]),
    });
    counter.arm(() => void loop.stop());
    await loop.done;

    // Doubling from one second to the ceiling, then straight back to the floor
    // on the pass that found the Issue.
    expect(clock.waits).toEqual([2000, 4000, 4000, 1000]);
  });

  it("never runs two passes at once, because there is only ever one", async () => {
    const it = await instance();
    closers.push(it.close);
    await it.assign("Ship it");
    let inside = 0;
    let overlapped = false;
    const counter = stopAfter(3);

    const loop = startLoop({
      deevy: it.deevy,
      proxy: it.proxy,
      runTimeoutMs: 5_000,
      pollSeconds: 1,
      sleep: async () => {
        await Promise.resolve();
      },
      // A pass is only ever inside one session, and the loop only starts a pass
      // when the last one returned: `startRunner` needs an overlap guard
      // because a timer can fire into a pass in flight, and nothing here can.
      session: async function* () {
        inside += 1;
        if (inside > 1) overlapped = true;
        yield { type: "ready", tools: [], servers: [{ name: "deevy", status: "connected" }] };
        await new Promise((resolve) => setTimeout(resolve, 2));
        const [run] = await it.deevy.runs("pending");
        if (run) await it.deevy.finishRun(run.id, "completed", "Planned it");
        inside -= 1;
        yield finished;
      },
      onPass: (pass) => {
        counter.onPass(pass);
      },
    });
    counter.arm(() => void loop.stop());
    await loop.done;

    expect(overlapped).toBe(false);
    expect(counter.passes.length).toBeGreaterThanOrEqual(3);
  });

  it("waits for the pass in flight before it stops", async () => {
    const it = await instance();
    closers.push(it.close);
    await it.assign("Ship it");
    let finishedWorking = false;

    const loop = startLoop({
      deevy: it.deevy,
      proxy: it.proxy,
      runTimeoutMs: 5_000,
      pollSeconds: 1,
      sleep: async () => {
        await Promise.resolve();
      },
      session: scripted([
        async () => {
          const [run] = await it.deevy.runs("pending");
          await it.deevy.finishRun(run.id, "completed", "Planned it");
          finishedWorking = true;
        },
        finished,
      ]),
      onPass: () => void loop.stop(),
    });
    await loop.done;

    expect(finishedWorking).toBe(true);
    expect((await it.asAda.runs.list({ issue: "acme/deevy#1" })).runs[0].status).toBe("completed");
  });
});

describe("stopping with a Run in flight", () => {
  it("fails the Run and says the runtime stopped, rather than leaving it silent", async () => {
    const it = await instance();
    closers.push(it.close);
    await it.assign("Ship it");
    const stopping = new AbortController();

    const loop = startLoop({
      deevy: it.deevy,
      proxy: it.proxy,
      runTimeoutMs: 60_000,
      pollSeconds: 1,
      sleep: async () => {
        await Promise.resolve();
      },
      // The session notices the abort the way the SDK does: the signal fires,
      // the work in flight throws, and the supervisor is left to explain it.
      session: async function* (input) {
        yield { type: "ready", tools: [], servers: [{ name: "deevy", status: "connected" }] };
        stopping.abort();
        await new Promise((resolve) => setTimeout(resolve, 1));
        input.signal.throwIfAborted();
      },
      signal: stopping.signal,
    });
    await loop.done;

    const run = (await it.asAda.runs.list({ issue: "acme/deevy#1" })).runs[0];
    expect(run.status).toBe("failed");
    expect(run.summary).toBe("The runtime stopped while this Run was in flight");
    const feed = await it.asAda.runs.get({ runId: run.id });
    expect(feed.activities.at(-1)).toMatchObject({ kind: "error" });
  });
});
