import { afterEach, describe, expect, it } from "vite-plus/test";
import { openProxy } from "../src/proxy.ts";
import { deevyToolNames } from "../src/tools.ts";
import { runOnce, workRun } from "../src/work.ts";
import type { Delivery } from "../src/deliver.ts";
import type { Session, SessionEvent } from "../src/session.ts";
import { finished, instance, scripted } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function deevyWithAnAssignedIssue(title = "Ship it") {
  const it = await instance();
  closers.push(it.close);
  await it.assign(title);
  return it;
}

/** The Events the Workspace has recorded, in order, for a test to read as a story. */
async function story(it: Awaited<ReturnType<typeof instance>>): Promise<string[]> {
  const events = await it.asAda.events.list({ limit: 100 });
  return events.events.map((event) => event.kind);
}

const options = { runTimeoutMs: 5_000 };

describe("a pass", () => {
  it("works the Run the trigger already opened, and leaves the record the Human reads", async () => {
    const it = await deevyWithAnAssignedIssue();

    const session = scripted([
      async () => {
        const [run] = await it.deevy.runs("pending");
        await it.deevy.postActivity(run.id, "thought", "Reading the intent");
        await it.deevy.postActivity(run.id, "action", "Wrote the plan");
        await it.deevy.finishRun(run.id, "completed", "Planned it");
      },
      finished,
    ]);

    const pass = await runOnce({ ...options, deevy: it.deevy, proxy: it.proxy, session });

    expect(pass.worked).toEqual([
      { runId: expect.any(String), issueKey: "acme/deevy#1", status: "completed" },
    ]);
    expect(await story(it)).toEqual([
      "socket.connected",
      "project.created",
      "issue.created",
      "issue.assigned",
      "run.started",
      "run.activity",
      "run.activity",
      "run.completed",
    ]);
  });

  it("finds nothing to do the second time round", async () => {
    const it = await deevyWithAnAssignedIssue();
    const session = scripted([
      async () => {
        const [run] = await it.deevy.runs("pending");
        await it.deevy.finishRun(run.id, "completed", "Planned it");
      },
      finished,
    ]);

    await runOnce({ ...options, deevy: it.deevy, proxy: it.proxy, session });
    const again = await runOnce({ ...options, deevy: it.deevy, proxy: it.proxy, session });

    expect(again.worked).toEqual([]);
    expect(again.takenUp).toEqual([]);
  });
});

describe("taking work up from the inbox", () => {
  it("opens a Run for an assignment and clears the Notification it acted on", async () => {
    const it = await instance();
    closers.push(it.close);
    await it.assign("Ship it");
    // The Run the trigger opened is finished, so only the inbox is left to
    // find the work by — which is the path ADR-0003 promises an Agent with no
    // webhook URL, and the one M4 slice 1 made survivable.
    const [opened] = await it.deevy.runs("pending");
    await it.deevy.finishRun(opened.id, "failed", "An earlier attempt gave up");

    const pass = await runOnce({
      ...options,
      deevy: it.deevy,
      proxy: it.proxy,
      session: scripted([
        async () => {
          const [run] = await it.deevy.runs("pending");
          await it.deevy.finishRun(run.id, "completed", "Second time lucky");
        },
        finished,
      ]),
    });

    expect(pass.takenUp).toEqual(["acme/deevy#1"]);
    expect(pass.worked[0]).toMatchObject({ issueKey: "acme/deevy#1", status: "completed" });
    expect(await it.deevy.unread()).toEqual([]);
  });

  it("asks before opening a Run, rather than colliding with the trigger's", async () => {
    const it = await deevyWithAnAssignedIssue();

    const pass = await runOnce({
      ...options,
      deevy: it.deevy,
      proxy: it.proxy,
      session: scripted([
        async () => {
          const [run] = await it.deevy.runs("pending");
          await it.deevy.finishRun(run.id, "completed", "Planned it");
        },
        finished,
      ]),
    });

    // The trigger that wrote the Notification already opened the Run, in the
    // same Event. Starting one here would collide on every assignment there has
    // ever been: a request known to fail on the happy path, and an error in
    // deevy's log on nothing going wrong.
    expect(pass.takenUp).toEqual([]);
    expect(pass.worked[0]).toMatchObject({ issueKey: "acme/deevy#1", status: "completed" });
    expect(it.refused).toEqual([]);
  });

  it("still treats a genuine collision as somebody else's Issue", async () => {
    const it = await deevyWithAnAssignedIssue();

    // Two hosts, one key: the second asks, is told there is nothing open
    // because the first has not written yet, and loses the race. deevy's rule
    // is what makes that safe rather than lucky, so the catch stays.
    const pass = await runOnce({
      ...options,
      deevy: it.deevy,
      proxy: it.proxy,
      session: scripted([
        async () => {
          const [run] = await it.deevy.runs("pending");
          await it.deevy.finishRun(run.id, "completed", "Planned it");
        },
        finished,
      ]),
    });

    expect(pass.takenUp).toEqual([]);
    expect((await it.asAda.runs.list({ issue: "acme/deevy#1" })).runs).toHaveLength(1);
    expect(await it.deevy.unread()).toEqual([]);
  });

  it("opens one when the Issue has none open, and asks only once", async () => {
    const it = await instance();
    closers.push(it.close);
    await it.assign("Ship it");
    const [opened] = await it.deevy.runs("pending");
    await it.deevy.finishRun(opened.id, "failed", "An earlier attempt gave up");

    const pass = await runOnce({
      ...options,
      deevy: it.deevy,
      proxy: it.proxy,
      session: scripted([
        async () => {
          const [run] = await it.deevy.runs("pending");
          await it.deevy.finishRun(run.id, "completed", "Second time lucky");
        },
        finished,
      ]),
    });

    // A finished Run is not an open one, so this is the path that does start
    // one — and it still does not cost a refusal.
    expect(pass.takenUp).toEqual(["acme/deevy#1"]);
    expect(it.refused).toEqual([]);
  });
});

describe("the envelope", () => {
  it("fails the Run when the session throws, rather than leaving it silent", async () => {
    const it = await deevyWithAnAssignedIssue();
    const session = scripted([() => Promise.reject(new Error("the model fell over")), finished]);

    const pass = await runOnce({ ...options, deevy: it.deevy, proxy: it.proxy, session });

    expect(pass.worked[0]).toMatchObject({ status: "failed" });
    expect(pass.worked[0].failedBy).toContain("the model fell over");
    const feed = await it.asAda.runs.get({ runId: pass.worked[0].runId });
    expect(feed.activities.at(-1)).toMatchObject({ kind: "error" });
    expect(feed.summary).toContain("the model fell over");
  });

  it("fails the Run when the session simply stops without finishing", async () => {
    const it = await deevyWithAnAssignedIssue();
    const session = scripted([
      async () => {
        const [run] = await it.deevy.runs("pending");
        await it.deevy.postActivity(run.id, "thought", "Thinking about it");
      },
      finished,
    ]);

    const pass = await runOnce({ ...options, deevy: it.deevy, proxy: it.proxy, session });

    expect(pass.worked[0]).toMatchObject({
      status: "failed",
      failedBy: "The session ended without finishing this Run",
    });
  });

  it("quotes what the session said went wrong, when it left the Run open", async () => {
    const it = await deevyWithAnAssignedIssue();
    const session = scripted([
      async () => {
        const [run] = await it.deevy.runs("pending");
        await it.deevy.postActivity(run.id, "thought", "Reading the intent");
      },
      // What `toSessionEvents` makes of an SDK result that is not a success.
      { type: "done", ok: false, detail: "The session ended: error_during_execution" },
    ]);

    const pass = await runOnce({ ...options, deevy: it.deevy, proxy: it.proxy, session });

    expect(pass.worked[0]).toMatchObject({
      status: "failed",
      failedBy: "The session ended: error_during_execution",
    });
    const feed = await it.asAda.runs.get({ runId: pass.worked[0].runId });
    expect(feed.activities.at(-1)).toMatchObject({
      kind: "error",
      body: "The session ended: error_during_execution",
    });
  });

  it("leaves a Run the session finished alone, whatever the session then reported", async () => {
    const it = await deevyWithAnAssignedIssue();
    const session = scripted([
      async () => {
        const [run] = await it.deevy.runs("pending");
        await it.deevy.finishRun(run.id, "completed", "Planned it");
      },
      // deevy writes before it answers, so a call that errored may already have
      // done what it said (docs/agent-loop.md): a Run failed over work that
      // succeeded is the worst record the runtime could leave.
      { type: "done", ok: false, detail: "the tool call timed out" } satisfies SessionEvent,
    ]);

    const pass = await runOnce({ ...options, deevy: it.deevy, proxy: it.proxy, session });

    expect(pass.worked[0]).toMatchObject({ status: "completed" });
    expect(pass.worked[0].failedBy).toBeUndefined();
    expect((await it.asAda.runs.get({ runId: pass.worked[0].runId })).summary).toBe("Planned it");
  });

  it("stops before spending anything when the session cannot reach deevy", async () => {
    const it = await deevyWithAnAssignedIssue();
    let called = false;
    const session = scripted([
      () => {
        called = true;
        return Promise.resolve();
      },
      finished,
    ]);
    // The supervisor asks before the session does, with the key the session
    // would have used: here one deevy refuses (src/proxy.ts).
    const proxy = () =>
      openProxy({
        url: it.config.url,
        key: "not-a-key",
        tools: deevyToolNames,
        fetch: it.inProcess,
      });

    const pass = await runOnce({ ...options, deevy: it.deevy, proxy, session });

    expect(called).toBe(false);
    expect(pass.worked[0].failedBy).toContain("could not reach deevy");
    expect(pass.worked[0].status).toBe("failed");
  });

  it("stops a session that runs past the Run's timeout and says so", async () => {
    const it = await deevyWithAnAssignedIssue();
    const session: Session = async function* () {
      yield { type: "ready", tools: [], servers: [{ name: "deevy", status: "connected" }] };
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw new Error("should have been aborted");
    };

    const pass = await runOnce({ deevy: it.deevy, proxy: it.proxy, session, runTimeoutMs: 1 });

    expect(pass.worked[0]).toMatchObject({
      status: "failed",
      failedBy: "The session ran past its timeout",
    });
  });
});

describe("a repository the Run cannot have", () => {
  it("fails the Run before the session starts, naming what could not be cloned", async () => {
    const it = await deevyWithAnAssignedIssue();
    let started = false;

    const pass = await runOnce({
      ...options,
      deevy: it.deevy,
      proxy: it.proxy,
      workspace: () => Promise.reject(new Error("Could not clone https://example.test/repo.git")),
      session: scripted([
        () => {
          started = true;
          return Promise.resolve();
        },
        finished,
      ]),
    });

    expect(started).toBe(false);
    expect(pass.worked[0]).toMatchObject({
      status: "failed",
      failedBy: "Could not clone https://example.test/repo.git",
    });
    const feed = await it.asAda.runs.get({ runId: pass.worked[0].runId });
    expect(feed.activities.at(-1)).toMatchObject({ kind: "error" });
  });
});

describe("a tool the session may not call", () => {
  it("is recorded in the feed, and the Run carries on", async () => {
    const it = await deevyWithAnAssignedIssue();
    // Held before the pass: the supervisor's own denial Activity moves the Run
    // to `active`, exactly as the model's first Activity would, so a session
    // looking for a `pending` Run after one has already been recorded finds
    // none.
    const [waiting] = await it.deevy.runs("pending");

    const pass = await runOnce({
      ...options,
      deevy: it.deevy,
      proxy: it.proxy,
      session: scripted([
        { type: "denied", name: "Bash", reason: "no approval surface" },
        async () => {
          await it.deevy.finishRun(waiting.id, "completed", "Did it another way");
        },
        finished,
      ]),
    });

    expect(pass.worked[0]).toMatchObject({ status: "completed" });
    const feed = await it.asAda.runs.get({ runId: pass.worked[0].runId });
    expect(feed.activities.map((activity) => activity.body)).toContain(
      "Refused Bash: no approval surface",
    );
  });

  it("stops filling the feed once a session is only being refused", async () => {
    const it = await deevyWithAnAssignedIssue();
    const denials = Array.from({ length: 12 }, () => ({
      type: "denied" as const,
      name: "Bash",
      reason: "no approval surface",
    }));
    const [waiting] = await it.deevy.runs("pending");

    const pass = await runOnce({
      ...options,
      deevy: it.deevy,
      proxy: it.proxy,
      session: scripted([
        ...denials,
        async () => {
          await it.deevy.finishRun(waiting.id, "completed", "Gave up on the shell");
        },
        finished,
      ]),
    });

    const feed = await it.asAda.runs.get({ runId: pass.worked[0].runId });
    expect(feed.activities.filter((a) => a.body.startsWith("Refused "))).toHaveLength(5);
  });
});

describe("the evidence a Run leaves on the Issue", () => {
  /** A working directory that is already a repository with something in it. */
  function delivering(delivered: Delivery | null) {
    return {
      workspace: () =>
        Promise.resolve({
          cwd: "/tmp/unused",
          repo: { url: "https://github.com/owner/repo.git", baseBranch: "main" },
          git: () => Promise.resolve(""),
          release: () => Promise.resolve(),
        }),
      forge: null,
      delivered,
    };
  }

  it("attaches the pull request to the Run that produced it", async () => {
    const it = await deevyWithAnAssignedIssue();
    const [waiting] = await it.deevy.runs("pending");
    const shipped: Delivery = {
      branch: "deevy/dev-1-run-abcd",
      commit: "a".repeat(40),
      pullRequest: { url: "https://github.com/owner/repo/pull/7", number: 7 },
    };

    const pass = await runOnce({
      ...options,
      ...delivering(shipped),
      deevy: it.deevy,
      proxy: it.proxy,
      deliver: () => Promise.resolve(shipped),
      session: scripted([
        async () => {
          await it.deevy.finishRun(waiting.id, "completed", "Wrote the code");
        },
        finished,
      ]),
    });

    expect(pass.worked[0]).toMatchObject({ status: "completed", delivered: shipped });
    const links = await it.asAda.links.list({ issue: "acme/deevy#1" });
    expect(links.links).toHaveLength(1);
    expect(links.links[0]).toMatchObject({
      url: "https://github.com/owner/repo/pull/7",
      kind: "pull_request",
      runId: waiting.id,
    });
    // A comment rather than an Activity, because the model closed its own Run
    // before there was a branch to name and a closed Run takes no more.
    // The comment is the tracker's: deevy stores none of them, and signs each
    // one with the Member who wrote it (ADR-0024).
    const said = it.tracker.comments.get("1") ?? [];
    expect(said.at(-1)?.body).toContain(
      `Run \`${waiting.id}\` pushed \`deevy/dev-1-run-abcd\` and opened https://github.com/owner/repo/pull/7`,
    );
  });

  it("attaches nothing when the Run changed nothing", async () => {
    const it = await deevyWithAnAssignedIssue();
    const [waiting] = await it.deevy.runs("pending");

    await runOnce({
      ...options,
      ...delivering(null),
      deevy: it.deevy,
      proxy: it.proxy,
      deliver: () => Promise.resolve(null),
      session: scripted([
        async () => {
          await it.deevy.finishRun(waiting.id, "completed", "Nothing needed doing");
        },
        finished,
      ]),
    });

    expect((await it.asAda.links.list({ issue: "acme/deevy#1" })).links).toEqual([]);
    expect(it.tracker.comments.get("1")).toBeUndefined();
  });

  it("says so in the feed when the work is done and the record is not", async () => {
    const it = await deevyWithAnAssignedIssue();
    const [waiting] = await it.deevy.runs("pending");

    const pass = await runOnce({
      ...options,
      ...delivering(null),
      deevy: it.deevy,
      proxy: it.proxy,
      deliver: () => Promise.reject(new Error("the remote rejected the push")),
      session: scripted([
        async () => {
          await it.deevy.finishRun(waiting.id, "completed", "Wrote the code");
        },
        finished,
      ]),
    });

    // The Run's own outcome stands: the work happened, only the record of it
    // failed, and a Human can see both.
    expect(pass.worked[0]).toMatchObject({ status: "completed" });
    const said = it.tracker.comments.get("1") ?? [];
    expect(said.at(-1)?.body).toContain("could not be delivered");
  });
});

describe("a Run that is not ours to drive", () => {
  it("is left where it is", async () => {
    const it = await deevyWithAnAssignedIssue();
    const [run] = await it.deevy.runs("pending");
    await it.deevy.postActivity(run.id, "thought", "Somebody else got here first");

    const result = await workRun(
      { ...options, deevy: it.deevy, proxy: it.proxy, session: scripted([finished]) },
      { ...run, status: "active" },
    );

    expect(result).toEqual({ runId: run.id, issueKey: "acme/deevy#1", status: "active" });
  });
});
