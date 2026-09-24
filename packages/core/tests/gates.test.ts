import type { Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { recordRuling } from "../src/gates.ts";
import { router } from "../src/operations/index.ts";
import { remindAboutGates, sweepStaleRuns } from "../src/work.ts";
import { agentContext, memberContext, seedProject, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * A Gate is a request on a Run (ADR-0024, ADR-0020).
 *
 * The Agent asks to pass a Checkpoint, carrying what it intends to do; Humans
 * rule on that text. What has to hold is the arithmetic: N distinct Humans,
 * the one who brought the work excluded where the policy says so, one
 * rejection ending it, and nothing counting twice — which is the bug the old
 * approval path shipped with and four-eyes fixed once already.
 */
async function workspace(db: Db) {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
  const carol = await memberContext(db, { name: "Carol", email: "carol@example.com" });
  const seeded = await seedProject(db, ada.workspace.id);
  const issue = await seeded.record({ externalId: "42", title: "Checkout rewrite" });
  const planner = await agentContext(db, {
    name: "Planner",
    handle: "planner",
    email: "planner@example.com",
    sponsor: ada.member,
    grants: [seeded.project.id],
  });
  const asPlanner = createRouterClient(router, { context: planner });
  const run = await asPlanner.runs.start({ issue: issue.url });

  return {
    ada,
    bob,
    carol,
    planner,
    seeded,
    issue,
    run,
    asAda: createRouterClient(router, { context: ada }),
    asBob: createRouterClient(router, { context: bob }),
    asCarol: createRouterClient(router, { context: carol }),
    asPlanner,
  };
}

describe("a Checkpoint that wants two Humans", () => {
  it("refuses the one who brought the work, and closes on the second other", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asAda, asBob, asCarol, asPlanner, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 2, excludeRequester: true }],
    });

    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "## What I will do\n\nRewrite the totals, behind a flag.",
    });
    expect(asked).toMatchObject({ status: "open", visit: 1, checkpoint: "ship" });
    expect((await asPlanner.runs.get({ runId: run.id })).status).toBe("awaiting_input");

    // Ada sponsors the Agent that asked, so Ada is the Human behind this Run.
    await expect(asAda.gates.approve({ requestId: asked.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const first = await asBob.gates.approve({ requestId: asked.id, note: "Reads right" });
    expect(first).toMatchObject({ status: "open" });
    expect((await asPlanner.runs.get({ runId: run.id })).status).toBe("awaiting_input");

    const second = await asCarol.gates.approve({ requestId: asked.id });
    expect(second).toMatchObject({ status: "approved" });
    expect((await asPlanner.runs.get({ runId: run.id })).status).toBe("active");

    const kinds = (await db.query.event.findMany({ orderBy: { seq: "asc" } })).map(
      (event) => event.kind,
    );
    expect(kinds.filter((kind) => kind === "gate.approval")).toHaveLength(1);
    expect(kinds).toContain("gate.approved");
    expect(kinds).toContain("run.answered");

    // The Agent hears the outcome where it already looks (ADR-0003).
    const inbox = await asPlanner.inbox.list({ unreadOnly: true });
    expect(inbox.notifications.map((row) => row.kind)).toContain("run_answered");
    expect(ada.member.id).toBeTruthy();
  });

  it("will not let one Human count twice", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asBob, asPlanner, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 2 }],
    });
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });

    await asBob.gates.approve({ requestId: asked.id });

    await expect(asBob.gates.approve({ requestId: asked.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await asBob.gates.get({ requestId: asked.id })).status).toBe("open");
  });
});

describe("asking twice", () => {
  it("is one question while the Proposal is the same", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, run } = await workspace(db);

    const once = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "The same words",
    });
    const twice = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "The same words",
    });

    expect(twice.id).toBe(once.id);
    expect(twice.visit).toBe(1);
    const asks = (await db.query.event.findMany({})).filter(
      (event) => event.kind === "gate.requested",
    );
    expect(asks).toHaveLength(1);
  });

  it("supersedes the old question when the Proposal changed", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, run } = await workspace(db);
    const once = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "The first plan",
    });

    const again = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "The plan, rethought",
    });

    expect(again.id).not.toBe(once.id);
    expect(again.visit).toBe(2);
    expect((await asPlanner.gates.get({ requestId: once.id })).status).toBe("superseded");
    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds).toContain("gate.superseded");
  });
});

describe("a rejection", () => {
  it("ends the request, lets the Run carry on, and the next ask is a second visit", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asBob, asPlanner, run } = await workspace(db);
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "The first plan",
    });

    const ruled = await asBob.gates.reject({
      requestId: asked.id,
      note: "The flag has to come first",
    });

    expect(ruled).toMatchObject({ status: "rejected" });
    expect((await asPlanner.runs.get({ runId: run.id })).status).toBe("active");
    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds).toContain("gate.rejected");

    // Asking again is a new question, one visit later, and the note is what
    // the Agent had to read to write it.
    const again = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "The plan, with the flag first",
    });
    expect(again).toMatchObject({ visit: 2, status: "open" });
  });
});

describe("a Checkpoint nobody configured", () => {
  it("wants one approval from anybody, so an Agent is never stranded", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asBob, asPlanner, run } = await workspace(db);

    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "security-review",
      proposal: "Nothing touches auth",
    });
    expect(asked.policy).toMatchObject({ approvalsRequired: 1, excludeRequester: false });

    expect(await asBob.gates.approve({ requestId: asked.id })).toMatchObject({
      status: "approved",
    });
  });
});

describe("what a Checkpoint may be set to", () => {
  it("refuses a threshold nobody in the Workspace could meet", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, seeded } = await workspace(db);

    await expect(
      asAda.checkpoints.set({
        projectSlug: seeded.project.slug,
        checkpoints: [{ name: "ship", approvalsRequired: 9 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses more approvals than the Humans it names", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, bob, seeded } = await workspace(db);

    await expect(
      asAda.checkpoints.set({
        projectSlug: seeded.project.slug,
        checkpoints: [{ name: "ship", approvalsRequired: 2, approverMemberIds: [bob.member.id] }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lets only the Humans it names rule, and says what it is set to", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asBob, asCarol, asPlanner, bob, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 1, approverMemberIds: [bob.member.id] }],
    });

    const listed = await asAda.checkpoints.list({ projectSlug: seeded.project.slug });
    expect(listed.checkpoints).toMatchObject([
      { name: "ship", approvalsRequired: 1, approverMemberIds: [bob.member.id] },
    ]);

    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });
    await expect(asCarol.gates.approve({ requestId: asked.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await asBob.gates.approve({ requestId: asked.id })).toMatchObject({
      status: "approved",
    });
  });
});

describe("what the Gates list answers", () => {
  it("shows a Human what is waiting on them, and an Agent what it asked", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asBob, asPlanner, run } = await workspace(db);
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "The plan",
    });

    const mine = await asBob.gates.list({ mine: true });
    expect(mine.gates.map((gate) => gate.id)).toEqual([asked.id]);

    await asBob.gates.approve({ requestId: asked.id });
    expect((await asBob.gates.list({ mine: true })).gates).toEqual([]);
    expect((await asPlanner.gates.list({})).gates.map((gate) => gate.status)).toEqual(["approved"]);
  });
});

describe("a ruling that came from somewhere else", () => {
  it("records where it came from and what it pointed at", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asPlanner, bob, run, seeded } = await workspace(db);
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "The plan",
    });

    await recordRuling(
      { db, workspace: ada.workspace, member: bob.member },
      {
        requestId: asked.id,
        memberId: bob.member.id,
        decision: "approved",
        note: "Approved on the tracker",
        via: "socket",
        socketId: seeded.socketId,
        externalRef: { commentId: "c1" },
      },
    );

    const [decision] = await db.query.gateDecision.findMany({});
    expect(decision).toMatchObject({
      via: "socket",
      socketId: seeded.socketId,
      externalRef: { commentId: "c1" },
      decision: "approved",
    });

    const ruled = await asPlanner.gates.get({ requestId: asked.id });
    expect(ruled.status).toBe("approved");
    // Which tool it came through, in the answer: a screen says "via GitHub"
    // and a Human who reads it never has to ask where a decision was made,
    // which is the whole of what `via` is for (ADR-0025).
    expect(ruled.decisions[0]).toMatchObject({
      via: "socket",
      socket: { provider: "stub", name: "Example tracker" },
    });
  });
});

describe("who is asked", () => {
  it("is everybody who could rule, and nobody who could not", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asBob, asCarol, asPlanner, bob, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 1, approverMemberIds: [bob.member.id] }],
    });

    await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });

    const waiting = (inbox: { notifications: { kind: string }[] }) =>
      inbox.notifications.filter((row) => row.kind === "gate_awaiting");
    expect(waiting(await asBob.inbox.list({ unreadOnly: true }))).toHaveLength(1);
    expect(waiting(await asCarol.inbox.list({ unreadOnly: true }))).toEqual([]);
    expect(waiting(await asAda.inbox.list({ unreadOnly: true }))).toEqual([]);
  });

  it("is every active Human where the Checkpoint names nobody, minus the one it excludes", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asBob, asCarol, asPlanner, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 1, excludeRequester: true }],
    });

    await asPlanner.gates.request({ runId: run.id, checkpoint: "ship", proposal: "Ship it" });

    const waiting = (inbox: { notifications: { kind: string }[] }) =>
      inbox.notifications.filter((row) => row.kind === "gate_awaiting");
    expect(waiting(await asBob.inbox.list({ unreadOnly: true }))).toHaveLength(1);
    expect(waiting(await asCarol.inbox.list({ unreadOnly: true }))).toHaveLength(1);
    // Ada sponsors the Agent, and this Checkpoint wants somebody else, so
    // asking her would be asking somebody who is about to be refused.
    expect(waiting(await asAda.inbox.list({ unreadOnly: true }))).toEqual([]);
  });
});

describe("a Run waiting at a Gate", () => {
  it("is not swept stale, however long nobody rules", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asPlanner, run } = await workspace(db);
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "The plan" });

    const swept = await sweepStaleRuns({
      db,
      workspaceId: ada.workspace.id,
      now: new Date(Date.now() + 8 * 60 * 60_000),
    });

    expect(swept.changed).toBe(0);
    expect((await asPlanner.runs.get({ runId: run.id })).status).toBe("awaiting_input");
  });

  it("has its approvers asked again once it has been quiet for hours", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asBob, asPlanner, run } = await workspace(db);
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "The plan" });
    const waiting = await asBob.inbox.list({ unreadOnly: true });
    await asBob.inbox.markRead({ ids: waiting.notifications.map((row) => row.id) });

    const reminded = await remindAboutGates({
      db,
      workspaceId: ada.workspace.id,
      now: new Date(Date.now() + 5 * 60 * 60_000),
    });

    expect(reminded.changed).toBe(1);
    // The same ask, unread again, rather than a second row about one question.
    const again = await asBob.inbox.list({ unreadOnly: true });
    expect(again.notifications.filter((row) => row.kind === "gate_awaiting")).toHaveLength(1);
  });
});

describe("what the Gate says to the Human reading it", () => {
  it("says whether they may rule, and why not when they may not", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asBob, asCarol, asPlanner, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 2, excludeRequester: true }],
    });
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });

    // The screen asks the server rather than working the policy out again: the
    // rules that refuse a Ruling and the words that explain it are one thing.
    expect((await asBob.gates.get({ requestId: asked.id })).you).toMatchObject({
      mayRule: true,
      hasRuled: false,
      why: null,
    });
    const ada = await asAda.gates.get({ requestId: asked.id });
    expect(ada.you.mayRule).toBe(false);
    expect(ada.you.why).toContain("somebody other than the Human this Run is for");

    await asBob.gates.approve({ requestId: asked.id });
    const bobAgain = await asBob.gates.get({ requestId: asked.id });
    expect(bobAgain.you).toMatchObject({ mayRule: false, hasRuled: true });
    expect(bobAgain.approvals).toBe(1);
    expect(bobAgain.policy.approvalsRequired).toBe(2);
    expect((await asCarol.gates.get({ requestId: asked.id })).you.mayRule).toBe(true);
  });
});
