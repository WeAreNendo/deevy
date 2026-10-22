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

  /**
   * ADR-0020: "The requester, excluded from approving, may still reject." They
   * are told they cannot also be the agreement, not silenced. The Sockets
   * rewrite refused both until 2026-10-16.
   */
  it("lets the one who brought the work reject, and only reject", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asPlanner, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 2, excludeRequester: true }],
    });
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });

    await expect(asAda.gates.approve({ requestId: asked.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("you may still reject it"),
    });
    const ruled = await asAda.gates.reject({ requestId: asked.id, note: "Not this week" });

    expect(ruled).toMatchObject({ status: "rejected" });
    expect(ruled.decisions).toMatchObject([{ decision: "rejected", note: "Not this week" }]);
    expect((await asPlanner.runs.get({ runId: run.id })).status).toBe("active");
    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds).toContain("gate.rejected");
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

describe("an approval already given on the record", () => {
  /**
   * The first real GitHub walk: a Run's plan was approved, the Run failed on
   * the environment, and the next Run built without asking — the Agent's own
   * judgement. deevy decides now: the Agent always asks, and the answer is
   * the approval that stands.
   */
  async function approvedThenFailed(db: Db) {
    const parts = await workspace(db);
    const { asBob, asPlanner, run } = parts;
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "## Plan\n\nAdd greet.sh.",
    });
    await asBob.gates.approve({ requestId: asked.id, note: "Go" });
    await asPlanner.runs.finish({ runId: run.id, status: "failed", summary: "Could not write" });
    const next = await asPlanner.runs.start({ issue: parts.issue.url });
    return { ...parts, asked, next };
  }

  it("answers the same Proposal with the approval that stands, and lets the Run go on", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, asked, next } = await approvedThenFailed(db);

    const answer = await asPlanner.gates.request({
      runId: next.id,
      checkpoint: "plan",
      proposal: "## Plan\n\nAdd greet.sh.",
    });

    // The Gate the Humans ruled on, not a copy of their Rulings on a new one.
    expect(answer).toMatchObject({ id: asked.id, status: "approved" });
    expect((await asPlanner.runs.get({ runId: next.id })).status).not.toBe("awaiting_input");
    // Nobody is asked again, and the Run says what it went past on.
    const asks = (await db.query.event.findMany({})).filter(
      (event) => event.kind === "gate.requested",
    );
    expect(asks).toHaveLength(1);
    const said = (await asPlanner.runs.get({ runId: next.id })).activities.map((one) => one.body);
    expect(said.join("\n")).toContain(`/gates/${asked.id}`);
  });

  it("asks again when the Proposal changed", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, asked, next } = await approvedThenFailed(db);

    const answer = await asPlanner.gates.request({
      runId: next.id,
      checkpoint: "plan",
      proposal: "## Plan\n\nAdd greet.sh, and a test.",
    });

    expect(answer.id).not.toBe(asked.id);
    expect(answer.status).toBe("open");
  });

  it("asks again when the Checkpoint now wants more than that approval had", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asPlanner, seeded, next } = await approvedThenFailed(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "plan", approvalsRequired: 2, excludeRequester: false }],
    });

    const answer = await asPlanner.gates.request({
      runId: next.id,
      checkpoint: "plan",
      proposal: "## Plan\n\nAdd greet.sh.",
    });

    expect(answer.status).toBe("open");
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

/**
 * A Gate links the Checkpoint row it was asked under, and the Slack message
 * and the email read its threshold through that link. Saving replaced every
 * row until 2026-10-16, so any save cut every open Gate loose and both said
 * one approval whatever the Checkpoint wanted. A save now changes the rows it
 * keeps in place.
 */
describe("saving a Project's Checkpoints", () => {
  it("keeps every open Gate linked to its Checkpoint, lowered or not", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asPlanner, bob, carol, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [
        { name: "plan", approvalsRequired: 3 },
        { name: "ship", approvalsRequired: 1, approverMemberIds: [bob.member.id] },
      ],
    });
    const [plan, ship] = (await asAda.checkpoints.list({ projectSlug: seeded.project.slug }))
      .checkpoints;
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Plan it",
    });

    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [
        { name: "plan", approvalsRequired: 2 },
        { name: "ship", approvalsRequired: 1, approverMemberIds: [carol.member.id] },
      ],
    });

    const listed = (await asAda.checkpoints.list({ projectSlug: seeded.project.slug })).checkpoints;
    expect(listed).toMatchObject([
      { id: plan?.id, name: "plan", approvalsRequired: 2, approverMemberIds: [] },
      { id: ship?.id, name: "ship", approvalsRequired: 1, approverMemberIds: [carol.member.id] },
    ]);
    const row = await db.query.gateRequest.findFirst({
      where: { id: asked.id },
      with: { checkpointPolicy: true },
    });
    expect(row?.checkpointId).toBe(plan?.id);
    expect(row?.checkpointPolicy?.approvalsRequired).toBe(2);
  });

  it("cuts loose only the Gates of a Checkpoint it removes, which then want the default's one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asPlanner, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [
        { name: "plan", approvalsRequired: 2 },
        { name: "ship", approvalsRequired: 2 },
      ],
    });
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Plan it",
    });

    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 2 }],
    });

    const row = await db.query.gateRequest.findFirst({ where: { id: asked.id } });
    expect(row).toMatchObject({ status: "open", checkpointId: null });
    expect((await asAda.gates.get({ requestId: asked.id })).policy).toMatchObject({
      id: null,
      approvalsRequired: 1,
    });
  });

  it("links an open Gate to a Checkpoint added after it was asked at that name", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asPlanner, run, seeded } = await workspace(db);
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "security-review",
      proposal: "Nothing touches auth",
    });

    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "security-review", approvalsRequired: 2 }],
    });

    const [added] = (await asAda.checkpoints.list({ projectSlug: seeded.project.slug }))
      .checkpoints;
    const row = await db.query.gateRequest.findFirst({ where: { id: asked.id } });
    expect(row?.checkpointId).toBe(added?.id);
    expect((await asAda.gates.get({ requestId: asked.id })).policy.approvalsRequired).toBe(2);
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

  /**
   * Until 2026-10-22 the reminder marked unread every row its Event had, so on
   * a Gate that wants two approvals the Human who gave the first was asked for
   * it again every four hours.
   */
  it("asks again only the Humans who have not ruled on it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asAda, asBob, asCarol, asPlanner, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 2 }],
    });
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });
    const waiting = (inbox: { notifications: { id: string; kind: string }[] }) =>
      inbox.notifications.filter((row) => row.kind === "gate_awaiting");
    for (const client of [asBob, asCarol]) {
      const unread = waiting(await client.inbox.list({ unreadOnly: true }));
      expect(unread).toHaveLength(1);
      await client.inbox.markRead({ ids: unread.map((row) => row.id) });
    }
    expect(await asBob.gates.approve({ requestId: asked.id })).toMatchObject({ status: "open" });

    const reminded = await remindAboutGates({
      db,
      workspaceId: ada.workspace.id,
      now: new Date(Date.now() + 5 * 60 * 60_000),
    });

    expect(reminded.changed).toBe(1);
    expect(waiting(await asBob.inbox.list({ unreadOnly: true }))).toEqual([]);
    expect(waiting(await asCarol.inbox.list({ unreadOnly: true }))).toHaveLength(1);
  });

  it("does not ask again a Human the Checkpoint stopped naming", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asAda, asBob, asCarol, asPlanner, bob, carol, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 1 }],
    });
    await asPlanner.gates.request({ runId: run.id, checkpoint: "ship", proposal: "Ship it" });
    const waiting = (inbox: { notifications: { id: string; kind: string }[] }) =>
      inbox.notifications.filter((row) => row.kind === "gate_awaiting");
    for (const client of [asAda, asBob, asCarol]) {
      const unread = waiting(await client.inbox.list({ unreadOnly: true }));
      await client.inbox.markRead({ ids: unread.map((row) => row.id) });
    }
    // Only Bob and Carol may rule at ship now, so Ada has nothing to do here.
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [
        { name: "ship", approvalsRequired: 1, approverMemberIds: [bob.member.id, carol.member.id] },
      ],
    });

    await remindAboutGates({
      db,
      workspaceId: ada.workspace.id,
      now: new Date(Date.now() + 5 * 60 * 60_000),
    });

    expect(waiting(await asAda.inbox.list({ unreadOnly: true }))).toEqual([]);
    expect(waiting(await asBob.inbox.list({ unreadOnly: true }))).toHaveLength(1);
    expect(waiting(await asCarol.inbox.list({ unreadOnly: true }))).toHaveLength(1);
  });

  it("asks the Human behind a plain question again, as before", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asAda, asPlanner, run } = await workspace(db);
    await asPlanner.runs.postActivity({
      runId: run.id,
      kind: "elicitation",
      body: "Which base branch should this go to?",
    });
    const questions = (inbox: { notifications: { id: string; kind: string }[] }) =>
      inbox.notifications.filter((row) => row.kind === "run_awaiting_input");
    const unread = questions(await asAda.inbox.list({ unreadOnly: true }));
    expect(unread).toHaveLength(1);
    await asAda.inbox.markRead({ ids: unread.map((row) => row.id) });

    const reminded = await remindAboutGates({
      db,
      workspaceId: ada.workspace.id,
      now: new Date(Date.now() + 5 * 60 * 60_000),
    });

    expect(reminded.changed).toBe(1);
    expect(questions(await asAda.inbox.list({ unreadOnly: true }))).toHaveLength(1);
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
    // Ada is the Human this Run is for: she may rule, by rejecting, and the
    // view says why Approve is not hers so the screen can offer Reject alone.
    const ada = await asAda.gates.get({ requestId: asked.id });
    expect(ada.you).toMatchObject({ mayRule: true, mayApprove: false, why: null });
    expect(ada.you.whyNotApprove).toBe(
      "The ship Checkpoint wants somebody other than the Human this Run is for to approve it; you may still reject it",
    );

    await asBob.gates.approve({ requestId: asked.id });
    const bobAgain = await asBob.gates.get({ requestId: asked.id });
    expect(bobAgain.you).toMatchObject({ mayRule: false, mayApprove: false, hasRuled: true });
    expect(bobAgain.you.why).toBe("You have already ruled on this Gate");
    expect(bobAgain.you.whyNotApprove).toBe(bobAgain.you.why);
    expect(bobAgain.approvals).toBe(1);
    expect(bobAgain.policy.approvalsRequired).toBe(2);
    expect((await asCarol.gates.get({ requestId: asked.id })).you).toMatchObject({
      mayRule: true,
      mayApprove: true,
      whyNotApprove: null,
    });
  });

  it("is waiting on the Humans who may approve it, and not on the one it excludes", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asBob, asPlanner, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 1, excludeRequester: true }],
    });
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });

    // The same answer as the inbox's: Ada is not asked, though she may reject.
    expect((await asBob.gates.list({ mine: true })).gates.map((gate) => gate.id)).toEqual([
      asked.id,
    ]);
    expect((await asAda.gates.list({ mine: true })).gates).toEqual([]);
    const [listed] = (await asAda.gates.list({})).gates;
    expect(listed?.you).toMatchObject({ mayRule: true, mayApprove: false });
  });
});

/**
 * ADR-0020: "A pool that shrinks afterwards is said out loud, not guessed
 * around." A policy is checked against the Humans there are when it is saved,
 * and suspending one afterwards can leave an open Gate wanting more approvals
 * than anybody left could give. The Gate says so, with both numbers and an
 * admin's way out, and deevy lowers nothing for anybody.
 */
describe("a Gate left short of Humans who could approve it", () => {
  it("says how many it still wants and how many could still give one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asBob, asPlanner, carol, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 2, excludeRequester: true }],
    });
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });
    expect(asked.shortfall).toBeNull();

    // Ada is excluded, so Bob and Carol were the two; without Carol it is one.
    await asAda.members.suspend({ memberId: carol.member.id });

    const short = await asBob.gates.get({ requestId: asked.id });
    expect(short.shortfall).toEqual({
      wanted: 2,
      couldApprove: 1,
      why: "This Gate still wants 2 approvals and only 1 Human can still give one. An admin can lower Approvals on the ship Checkpoint, or reinstate a suspended Member.",
    });
    // Every Human reading it is told, and the list says what the Gate says.
    expect((await asAda.gates.get({ requestId: asked.id })).shortfall).toEqual(short.shortfall);
    const [listed] = (await asBob.gates.list({ runId: run.id })).gates;
    expect(listed?.shortfall).toEqual(short.shortfall);

    // The approval still counts: it is true, and it is what a lower threshold
    // passes the Gate with. Nobody is left after Bob, and lowering still helps.
    const approved = await asBob.gates.approve({ requestId: asked.id });
    expect(approved).toMatchObject({ status: "open", approvals: 1 });
    expect(approved.shortfall).toEqual({
      wanted: 1,
      couldApprove: 0,
      why: "This Gate still wants 1 approval and nobody can still give one. An admin can lower Approvals on the ship Checkpoint, or reinstate a suspended Member.",
    });
  });

  it("stops saying so once an admin lowers Approvals, and the next approval settles it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asBob, asPlanner, carol, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 2, excludeRequester: true }],
    });
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });
    await asAda.members.suspend({ memberId: carol.member.id });

    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 1, excludeRequester: true }],
    });

    expect((await asBob.gates.get({ requestId: asked.id })).shortfall).toBeNull();
    expect(await asBob.gates.approve({ requestId: asked.id })).toMatchObject({
      status: "approved",
      shortfall: null,
    });
  });

  it("counts only the Humans the Checkpoint names", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asCarol, asPlanner, bob, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 1, approverMemberIds: [bob.member.id] }],
    });
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });

    await asAda.members.suspend({ memberId: bob.member.id });

    // Carol is active and could rule anywhere else, but not here. With no
    // approval given and nobody to give one, no threshold an admin could set
    // helps, so the way out names only reinstating.
    expect((await asCarol.gates.get({ requestId: asked.id })).shortfall).toEqual({
      wanted: 1,
      couldApprove: 0,
      why: "This Gate still wants 1 approval and nobody can still give one. An admin can reinstate a suspended Member.",
    });
    await asAda.members.reinstate({ memberId: bob.member.id });
    expect((await asCarol.gates.get({ requestId: asked.id })).shortfall).toBeNull();
  });

  it("says nothing once the Gate is no longer open", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asBob, asPlanner, carol, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 2, excludeRequester: true }],
    });
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });
    await asAda.members.suspend({ memberId: carol.member.id });

    const rejected = await asBob.gates.reject({ requestId: asked.id, note: "Not yet" });

    expect(rejected).toMatchObject({ status: "rejected", shortfall: null });
  });
});

/**
 * Lowering a Checkpoint's Approvals to what an open Gate already has passes
 * it, the way it would have passed had the threshold been that low when the
 * last of those approvals landed. Without this, a Gate short of approvers with
 * an approval in hand waited for ever: lowering the threshold settled nothing,
 * and nobody was left to give the approval that would.
 */
describe("an admin lowering Approvals", () => {
  it("passes an open Gate that already has what it now wants, as the admin, and says why", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asAda, asBob, asPlanner, carol, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 2, excludeRequester: true }],
    });
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });
    await asBob.gates.approve({ requestId: asked.id, note: "Reads right" });
    await asAda.members.suspend({ memberId: carol.member.id });

    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 1, excludeRequester: true }],
    });

    expect(await asBob.gates.get({ requestId: asked.id })).toMatchObject({
      status: "approved",
      approvals: 1,
      shortfall: null,
    });
    expect((await asPlanner.runs.get({ runId: run.id })).status).toBe("active");

    // The history reads true: the policy changed, then the Gate passed because
    // of it, both by the admin who saved it, and nothing claims a Ruling.
    const events = await db.query.event.findMany({ orderBy: { seq: "asc" } });
    const kinds = events.map((event) => event.kind);
    expect(kinds.lastIndexOf("project.updated")).toBeLessThan(kinds.indexOf("gate.approved"));
    expect(events.find((event) => event.kind === "gate.approved")).toMatchObject({
      actorMemberId: ada.member.id,
      payload: { approvals: 1, required: 1, loweredFrom: 2, via: "web", checkpoint: "ship" },
    });
    expect(events.find((event) => event.kind === "run.answered")).toMatchObject({
      actorMemberId: ada.member.id,
      payload: { decision: "approved", loweredFrom: 2 },
    });
    expect(await db.query.gateDecision.findMany({})).toHaveLength(1);

    // The Agent hears it where it hears every answer (ADR-0003).
    const inbox = await asPlanner.inbox.list({ unreadOnly: true });
    expect(inbox.notifications.map((row) => row.kind)).toContain("run_answered");
    const said = (await asPlanner.runs.get({ runId: run.id })).activities.map((one) => one.body);
    expect(said).toContainEqual(
      "@ada lowered Approvals on the ship Checkpoint from 2 to 1, so it passed with the 1 approval it had",
    );
  });

  it("settles nothing that is raised, kept, or lowered to more than the Gate has", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asBob, asPlanner, run, seeded } = await workspace(db);
    const ship = (approvalsRequired: number) =>
      asAda.checkpoints.set({
        projectSlug: seeded.project.slug,
        checkpoints: [{ name: "ship", approvalsRequired }],
      });
    await ship(2);
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });
    await asBob.gates.approve({ requestId: asked.id });

    await ship(2);
    await ship(3);
    await ship(2);
    expect((await asBob.gates.get({ requestId: asked.id })).status).toBe("open");

    await ship(1);
    expect((await asBob.gates.get({ requestId: asked.id })).status).toBe("approved");
    const passed = (await db.query.event.findMany({})).filter(
      (event) => event.kind === "gate.approved",
    );
    expect(passed).toHaveLength(1);
    expect(passed[0]?.payload).toMatchObject({ loweredFrom: 2, required: 1 });
  });

  it("never counts an approval that was refused, when the exclusion is turned off", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asPlanner, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 2, excludeRequester: true }],
    });
    const asked = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "Ship it",
    });
    await expect(asAda.gates.approve({ requestId: asked.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // Lower and drop the exclusion in one save: Ada's refused click was never
    // an approval, so there is nothing to pass the Gate with.
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [{ name: "ship", approvalsRequired: 1, excludeRequester: false }],
    });
    expect((await asAda.gates.get({ requestId: asked.id })).status).toBe("open");

    // Now she may approve, and her approval is a new one that counts.
    expect(await asAda.gates.approve({ requestId: asked.id })).toMatchObject({
      status: "approved",
    });
  });

  it("passes a Gate whose Checkpoint was taken off the list, which wants one approval again", async () => {
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

    await asAda.checkpoints.set({ projectSlug: seeded.project.slug, checkpoints: [] });

    const passed = await asBob.gates.get({ requestId: asked.id });
    expect(passed).toMatchObject({ status: "approved", policy: { approvalsRequired: 1 } });
  });

  it("leaves the Gates of a Checkpoint that was not lowered alone", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asBob, asPlanner, run, seeded } = await workspace(db);
    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [
        { name: "plan", approvalsRequired: 2 },
        { name: "ship", approvalsRequired: 2 },
      ],
    });
    const plan = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Plan it",
    });
    await asBob.gates.approve({ requestId: plan.id });

    await asAda.checkpoints.set({
      projectSlug: seeded.project.slug,
      checkpoints: [
        { name: "plan", approvalsRequired: 2 },
        { name: "ship", approvalsRequired: 1 },
      ],
    });

    expect((await asBob.gates.get({ requestId: plan.id })).status).toBe("open");
  });
});
