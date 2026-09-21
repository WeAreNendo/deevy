import { activity, run } from "@deevy/db";
import { eq } from "drizzle-orm";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * An admin, a Project bound to a tracker, one projected record, and an Agent
 * granted that Project. A Run is one Agent's attempt on one record, so there is
 * no arrangement smaller than this (ADR-0016, ADR-0024).
 */
async function workspaceWithAgent() {
  const { db, close } = testDb();
  closers.push(close);
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const { sockets } = fakeSockets();
  const context = { ...admin, sockets };
  const asAdmin = createRouterClient(router, { context });
  const seeded = await seedProject(db, admin.workspace.id);
  const issue = await seeded.record({ externalId: "1", title: "Ship the thing" });
  const agent = await agentContext(db, { sponsor: admin.member, grants: [seeded.project.id] });
  return {
    db,
    admin: context,
    asAdmin,
    project: seeded.project,
    record: seeded.record,
    issue,
    agent,
    asAgent: createRouterClient(router, { context: { ...agent, sockets } }),
  };
}

describe("the Run lifecycle", () => {
  it("starts pending, so a triggered Run exists before the Agent says anything", async () => {
    const { asAgent, issue } = await workspaceWithAgent();

    const run = await asAgent.runs.start({ issue: issue.url });

    expect(run).toMatchObject({
      issueKey: issue.externalKey,
      status: "pending",
      trigger: "manual",
    });
    expect(run.startedAt).toBeNull();
  });

  it("goes active on the first Activity, which is when the Agent actually started", async () => {
    const { asAgent, issue } = await workspaceWithAgent();
    const run = await asAgent.runs.start({ issue: issue.url });

    const posted = await asAgent.runs.postActivity({
      runId: run.id,
      kind: "thought",
      body: "Reading the Issue",
    });

    expect(posted.activity).toMatchObject({ kind: "thought", body: "Reading the Issue" });
    expect(posted.run.status).toBe("active");
    expect(posted.run.startedAt).toBeInstanceOf(Date);
  });

  it("waits on an elicitation, and tells the Human behind the Run that it waits", async () => {
    const { asAdmin, asAgent, issue } = await workspaceWithAgent();
    const run = await asAgent.runs.start({ issue: issue.url });

    const posted = await asAgent.runs.postActivity({
      runId: run.id,
      kind: "elicitation",
      body: "Postgres or SQLite?",
    });

    expect(posted.run.status).toBe("awaiting_input");
    // The Agent triggered its own Run, so the accountable Human is its Sponsor.
    const { notifications } = await asAdmin.inbox.list({});
    const waiting = notifications.filter((row) => row.kind === "run_awaiting_input");
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.issue?.externalKey).toBe(issue.externalKey);
    // Never the actor: the Agent asked the question, it does not need telling.
    const forTheAgent = await asAgent.inbox.list({});
    expect(forTheAgent.notifications).toHaveLength(0);
  });

  it("comes back to active when a Human answers, with the answer where the Agent reads", async () => {
    const { asAdmin, asAgent, issue } = await workspaceWithAgent();
    const run = await asAgent.runs.start({ issue: issue.url });
    await asAgent.runs.postActivity({
      runId: run.id,
      kind: "elicitation",
      body: "Postgres or SQLite?",
    });

    const answered = await asAdmin.runs.answer({ runId: run.id, body: "SQLite" });

    expect(answered.run.status).toBe("active");
    expect(answered.activity).toMatchObject({ kind: "prompt", body: "SQLite" });
  });

  it("finishes with a summary, and tells the Human behind it once", async () => {
    const { asAdmin, asAgent, issue } = await workspaceWithAgent();
    const run = await asAgent.runs.start({ issue: issue.url });
    await asAgent.runs.postActivity({ runId: run.id, kind: "thought", body: "Working" });

    const finished = await asAgent.runs.finish({
      runId: run.id,
      status: "completed",
      summary: "Opened a pull request",
    });

    expect(finished).toMatchObject({ status: "completed", summary: "Opened a pull request" });
    expect(finished.finishedAt).toBeInstanceOf(Date);
    const { notifications } = await asAdmin.inbox.list({});
    expect(notifications.filter((row) => row.kind === "run_finished")).toHaveLength(1);
  });

  it("refuses an Agent posting into another Agent's Run", async () => {
    const { db, admin, project, asAgent, issue } = await workspaceWithAgent();
    const run = await asAgent.runs.start({ issue: issue.url });
    const other = await agentContext(db, {
      sponsor: admin.member,
      grants: [project.id],
      name: "Reviewer",
    });
    const asOther = createRouterClient(router, { context: other });

    await expect(
      asOther.runs.postActivity({ runId: run.id, kind: "thought", body: "Mine now" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists Runs by Issue and by Agent, newest first", async () => {
    const { db, agent, asAgent, issue, record } = await workspaceWithAgent();
    const second = await record({ externalId: "2", title: "Second thing" });
    const older = await asAgent.runs.start({ issue: issue.url });
    const newer = await asAgent.runs.start({ issue: second.url });
    // Two Runs a millisecond apart order by whatever the clock did; an hour
    // apart says what "newest first" means.
    await db
      .update(run)
      .set({ createdAt: new Date(Date.now() - 3_600_000) })
      .where(eq(run.id, older.id));

    const onTheIssue = await asAgent.runs.list({ issue: issue.url });
    const byTheAgent = await asAgent.runs.list({ agentMemberId: agent.member.id });

    expect(onTheIssue.runs.map((row) => row.id)).toEqual([older.id]);
    expect(byTheAgent.runs.map((row) => row.id)).toEqual([newer.id, older.id]);
    expect(byTheAgent.runs.map((row) => row.issueKey)).toEqual([
      second.externalKey,
      issue.externalKey,
    ]);
  });

  it("gives one Run with its Activities in the order they happened", async () => {
    const { db, asAdmin, asAgent, issue } = await workspaceWithAgent();
    const started = await asAgent.runs.start({ issue: issue.url });
    const thought = await asAgent.runs.postActivity({
      runId: started.id,
      kind: "thought",
      body: "Reading the Issue",
    });
    const question = await asAgent.runs.postActivity({
      runId: started.id,
      kind: "elicitation",
      body: "Postgres or SQLite?",
    });
    const answer = await asAdmin.runs.answer({ runId: started.id, body: "SQLite" });
    // Three writes inside one millisecond order by nothing in particular;
    // spacing them says what the feed is supposed to be sorted by.
    const seconds = [thought.activity.id, question.activity.id, answer.activity.id];
    for (const [at, id] of seconds.entries()) {
      await db
        .update(activity)
        .set({ createdAt: new Date(Date.now() - 10_000 + at * 1_000) })
        .where(eq(activity.id, id));
    }

    const detail = await asAdmin.runs.get({ runId: started.id });

    expect(detail).toMatchObject({
      id: started.id,
      issueKey: issue.externalKey,
      status: "active",
    });
    expect(detail.activities.map((row) => [row.kind, row.body])).toEqual([
      ["thought", "Reading the Issue"],
      ["elicitation", "Postgres or SQLite?"],
      ["prompt", "SQLite"],
    ]);
  });

  it("carries each Run's last three Activities and their count in the list", async () => {
    const { db, asAdmin, asAgent, issue, record } = await workspaceWithAgent();
    const second = await record({ externalId: "2", title: "Second thing" });
    const busy = await asAgent.runs.start({ issue: issue.url });
    const quiet = await asAgent.runs.start({ issue: second.url });
    const posted: string[] = [];
    for (const body of ["one", "two", "three", "four", "five"]) {
      const { activity: row } = await asAgent.runs.postActivity({
        runId: busy.id,
        kind: "action",
        body,
      });
      posted.push(row.id);
    }
    // Spaced out, so the order is the feed's and not the millisecond's.
    for (const [at, id] of posted.entries()) {
      await db
        .update(activity)
        .set({ createdAt: new Date(Date.now() - 10_000 + at * 1_000) })
        .where(eq(activity.id, id));
    }

    const page = await asAdmin.runs.list({ issue: issue.url });
    expect(page.runs).toHaveLength(1);
    expect(page.runs[0]?.activityCount).toBe(5);
    expect(page.runs[0]?.lastActivities.map((row) => row.body)).toEqual(["three", "four", "five"]);
    expect(page.runs[0]?.lastActivities[0]?.createdAt).toBeInstanceOf(Date);

    const empty = await asAdmin.runs.list({ issue: second.url });
    expect(empty.runs.map((row) => [row.id, row.activityCount, row.lastActivities])).toEqual([
      [quiet.id, 0, []],
    ]);
  });

  it("attributes evidence to the Run that found it", async () => {
    const { asAdmin, asAgent, issue } = await workspaceWithAgent();
    const started = await asAgent.runs.start({ issue: issue.url });

    const link = await asAgent.links.add({
      issue: issue.url,
      url: "https://github.com/deevy/deevy/pull/7",
      runId: started.id,
    });

    expect(link.runId).toBe(started.id);
    const { links } = await asAdmin.links.list({ issue: issue.url });
    expect(links.map((row) => row.runId)).toEqual([started.id]);
  });

  it("keeps at most one open Run per Issue and Agent", async () => {
    const { asAgent, issue } = await workspaceWithAgent();
    const first = await asAgent.runs.start({ issue: issue.url });

    await expect(asAgent.runs.start({ issue: issue.url })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    // Finished, the Issue is free for another attempt.
    await asAgent.runs.finish({ runId: first.id, status: "failed", summary: "Out of my depth" });
    const second = await asAgent.runs.start({ issue: issue.url });
    expect(second.status).toBe("pending");
  });

  it("refuses an Agent answering an elicitation, because the question is for a Human", async () => {
    const { asAgent, issue } = await workspaceWithAgent();
    const started = await asAgent.runs.start({ issue: issue.url });
    await asAgent.runs.postActivity({
      runId: started.id,
      kind: "elicitation",
      body: "Postgres or SQLite?",
    });

    await expect(asAgent.runs.answer({ runId: started.id, body: "SQLite" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("pages Runs from a cursor, showing each one once", async () => {
    const { db, agent, asAgent, issue, record } = await workspaceWithAgent();
    const second = await record({ externalId: "2", title: "Second thing" });
    const older = await asAgent.runs.start({ issue: issue.url });
    const newer = await asAgent.runs.start({ issue: second.url });
    await db
      .update(run)
      .set({ createdAt: new Date(Date.now() - 3_600_000) })
      .where(eq(run.id, older.id));

    const page = await asAgent.runs.list({ agentMemberId: agent.member.id, limit: 1 });
    const next = await asAgent.runs.list({
      agentMemberId: agent.member.id,
      before: page.nextCursor ?? undefined,
      limit: 1,
    });

    expect(page.runs.map((row) => row.id)).toEqual([newer.id]);
    expect(next.runs.map((row) => row.id)).toEqual([older.id]);
    expect(next.nextCursor).not.toBe(page.nextCursor);
  });

  it("has started once it has spoken, even when its first word is a question", async () => {
    const { asAgent, issue } = await workspaceWithAgent();
    const started = await asAgent.runs.start({ issue: issue.url });

    const posted = await asAgent.runs.postActivity({
      runId: started.id,
      kind: "elicitation",
      body: "Postgres or SQLite?",
    });

    expect(posted.run.status).toBe("awaiting_input");
    expect(posted.run.startedAt).toBeInstanceOf(Date);
  });
});

describe("what a Human says into a Run", () => {
  it("is a prompt, not the Agent's own response, so a ported agent can tell them apart", async () => {
    const { asAgent, asAdmin, issue } = await workspaceWithAgent();
    const run = await asAgent.runs.start({ issue: issue.url });
    await asAgent.runs.postActivity({ runId: run.id, kind: "elicitation", body: "Which repo?" });

    await asAdmin.runs.answer({ runId: run.id, body: "the deevy one" });

    const detail = await asAgent.runs.get({ runId: run.id });
    const last = detail.activities.at(-1);
    expect(last).toMatchObject({ kind: "prompt", body: "the deevy one" });
  });

  it("is a word only a Human may use", async () => {
    const { asAgent, issue } = await workspaceWithAgent();
    const run = await asAgent.runs.start({ issue: issue.url });

    // TypeScript already refuses this, which is why the cast is here: the
    // callers that are not typechecked are the ones that matter, an MCP tool
    // call or a raw HTTP request, and for those the schema is the only guard.
    const posting = asAgent.runs.postActivity({
      runId: run.id,
      kind: "prompt",
      body: "answering myself",
    } as unknown as Parameters<typeof asAgent.runs.postActivity>[0]);

    await expect(posting).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("a Run, seen from a Human", () => {
  it("is an Agent's alone: the registry refuses a Human before the handler runs", async () => {
    const { asAdmin, issue } = await workspaceWithAgent();

    // The mirror of "An Agent cannot do that" (ADR-0011): one middleware, one
    // message, no per-handler check to forget (ADR-0016).
    await expect(asAdmin.runs.start({ issue: issue.url })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only an Agent can do that",
    });
  });
});

/**
 * What the Runs feed answers a Human (docs/plans/sockets.md, slice 3).
 *
 * The old list refused a Human who named nobody, because every query had to
 * ride an index and a Workspace-wide scan was not on offer. A screen that says
 * "what is happening" is exactly that question, so the list answers it — off
 * `created_at`, one page at a time — and keeps refusing to fan out.
 */
describe("the Runs a Human reads", () => {
  it("answers the whole Workspace when nobody is named, and only mine when I say so", async () => {
    const { db, asAdmin, asAgent, admin, issue, record } = await workspaceWithAgent();
    const second = await record({ externalId: "2", title: "Another" });
    await asAgent.runs.start({ issue: issue.url });

    // A second Agent, sponsored by somebody else: its Runs are not mine.
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    const { sockets } = fakeSockets();
    const other = await agentContext(db, {
      name: "Builder",
      email: "builder@example.com",
      sponsor: bob.member,
      grants: [],
    });
    await db.insert(run).values({
      id: "run_otherstub00",
      issueId: second.id,
      agentMemberId: other.member.id,
      triggeredByMemberId: bob.member.id,
      trigger: "manual",
    });

    const everything = await asAdmin.runs.list({});
    expect(everything.runs).toHaveLength(2);

    // "Mine" is the Human behind the Run: the one who triggered it, or the
    // Sponsor of the Agent that is working it (PLAN.md's accountability rule).
    const mine = await asAdmin.runs.list({ mine: true });
    expect(mine.runs.map((row) => row.agentMemberId)).toEqual([
      (await db.query.run.findFirst({ where: { issueId: issue.id } }))?.agentMemberId,
    ]);
    expect(admin.member.id).toBeTruthy();
    expect(sockets).toBeTruthy();
  });

  it("says which Gate a waiting Run stopped at, so a feed can link to it", async () => {
    const { asAdmin, asAgent, issue } = await workspaceWithAgent();
    const started = await asAgent.runs.start({ issue: issue.url });
    const asked = await asAgent.gates.request({
      runId: started.id,
      checkpoint: "plan",
      proposal: "The plan",
    });

    const [listed] = (await asAdmin.runs.list({})).runs;

    expect(listed?.openGateRequestId).toBe(asked.id);
    expect(listed?.status).toBe("awaiting_input");
  });
});
