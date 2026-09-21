import {
  agent as agentTable,
  issue as issueTable,
  member as memberTable,
  run as runTable,
  webhookSubscription as webhookSubscriptionTable,
  type Db,
} from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { isOpen } from "../src/runs.ts";
import { discardingJobQueue } from "../src/jobs.ts";
import {
  deliverDueWebhooks,
  dueAgentsQuery,
  dueRunsQuery,
  dueWebhookDeliveriesQuery,
  runDueWork,
  scheduledIssuesQuery,
  sweepSchedules,
  sweepStaleRuns,
} from "../src/work.ts";
import { agentContext, memberContext, testDb, seedProject, fakeSockets } from "./helpers.ts";
import { newId } from "../src/ids.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const MINUTE = 60_000;

/** An admin, a Project bound to a tracker with one record in it, and an Agent granted it. */
async function workspaceWithAgent() {
  const { db, close } = testDb();
  closers.push(close);
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const { sockets } = fakeSockets();
  const seeded = await seedProject(db, admin.workspace.id);
  const issue = await seeded.record({ externalId: "1", title: "Ship the thing" });
  const agent = await agentContext(db, { sponsor: admin.member, grants: [seeded.project.id] });
  return {
    db,
    admin: { ...admin, sockets },
    asAdmin: createRouterClient(router, { context: { ...admin, sockets } }),
    workspaceId: admin.workspace.id,
    project: seeded.project,
    record: seeded.record,
    issue,
    agent,
  };
}

type RunStatus = "pending" | "active" | "awaiting_input" | "completed";
interface Where {
  issueId: string;
  agentMemberId: string;
}

/**
 * Runs whose last Activity was `silentMinutes` ago, straight into the table —
 * **each on an Issue of its own**. One Agent cannot hold two open Runs on one
 * Issue, and the database says so now rather than leaving it to whoever
 * inserts one (`schema/run.ts`), so a fixture that piled several onto one
 * Issue was describing a world that cannot exist. The sweep does not care which
 * Issue a silent Run is on, which is why it never noticed; the Issue passed in
 * is the template the new ones are cut from.
 */
let seeded = 1_000;

async function seedRuns(
  db: Db,
  where: Where,
  count: number,
  silentMinutes: number,
  status: RunStatus = "active",
) {
  const on = await db.query.issue.findFirst({ where: { id: where.issueId } });
  if (!on) throw new Error("seedRuns: no such Issue");
  const rows = Array.from({ length: count }, () => ({
    id: newId("run"),
    issueId: newId("issue"),
    agentMemberId: where.agentMemberId,
  }));
  await db.insert(issueTable).values(
    rows.map((row) => {
      seeded += 1;
      const key = `acme/deevy#${String(seeded)}`;
      return {
        id: row.issueId,
        projectId: on.projectId,
        socketId: on.socketId,
        externalId: String(seeded),
        externalKey: key,
        url: `https://tracker.test/${key}`,
        title: `Silent ${String(seeded)}`,
        state: "open" as const,
        stateName: "Open",
        externalUpdatedAt: new Date(),
        createdBy: on.createdBy,
      };
    }),
  );
  await db.insert(runTable).values(
    rows.map((row) => ({
      ...row,
      trigger: "manual" as const,
      status,
      lastActivityAt: new Date(Date.now() - silentMinutes * MINUTE),
    })),
  );
  return rows.map((row) => row.id);
}

async function seedRun(db: Db, where: Where, silentMinutes: number, status: RunStatus = "active") {
  const [id] = await seedRuns(db, where, 1, silentMinutes, status);
  return id as string;
}

/**
 * Counts the statements a sweep issues. Every Drizzle statement starts with
 * one of these calls, so the names recorded are the statements, in order.
 */
function countingDb(db: Db) {
  const statements: string[] = [];
  const starters = new Set([
    "select",
    "insert",
    "update",
    "delete",
    "run",
    "all",
    "get",
    "batch",
    "execute",
    "transaction",
  ]);
  const counted = new Proxy(db, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      // `query` is the relational API: a sweep reaching for it is reading per
      // row, which is the one thing this design forbids.
      if (property === "query") statements.push("query");
      if (typeof property !== "string" || !starters.has(property)) return value;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        statements.push(property);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as Db;
  return { counted, statements };
}

describe("the stale sweep", () => {
  it("moves a Run silent for longer than the window to stale, and says so in an Event", async () => {
    const { db, workspaceId, project, issue, agent } = await workspaceWithAgent();
    const runId = await seedRun(db, { issueId: issue.id, agentMemberId: agent.member.id }, 31);

    const result = await sweepStaleRuns({ db, workspaceId });
    expect(result).toEqual({ scanned: 1, changed: 1, more: false });
    const row = await db.query.run.findFirst({ where: { id: runId } });
    expect(row?.status).toBe("stale");
    // Stale is silence, not an ending: nothing is finished.
    expect(row?.finishedAt).toBeNull();
    const events = await db.query.event.findMany({ where: { kind: "run.went_stale" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      workspaceId,
      subjectType: "run",
      subjectId: runId,
      projectId: project.id,
      // Nobody did this: silence is not the act of a Member.
      actorMemberId: null,
    });
  });

  it("is answered by the index the sweep was given, and sorts nothing", async () => {
    const { db, workspaceId } = await workspaceWithAgent();
    const query = dueRunsQuery(db, { workspaceId, cutoff: new Date(), limit: 50 });

    const plan = await db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query.getSQL()}`);
    const detail = plan.map((step) => step.detail).join("\n");

    expect(detail).toContain("run USING INDEX run_status_lastActivityAt_idx");
    // A sort would visit every due Run before the LIMIT applied, so one pass
    // would cost the backlog instead of the limit.
    expect(detail).not.toContain("TEMP B-TREE");
    // The joins only follow primary keys; neither is a table scan.
    expect(detail).not.toContain("SCAN");
  });

  it("leaves alone what is still talking, what is finished, and what waits on a Human", async () => {
    const { db, workspaceId, issue, agent } = await workspaceWithAgent();
    const where = { issueId: issue.id, agentMemberId: agent.member.id };
    const fresh = await seedRun(db, where, 29);
    const done = await seedRun(db, where, 90, "completed");
    // A Run waiting on a Human is not a silent Agent, and only an
    // `awaiting_input` Run can be answered: sweeping it strands the answer.
    const waiting = await seedRun(db, where, 90, "awaiting_input");

    const result = await sweepStaleRuns({ db, workspaceId });

    expect(result).toEqual({ scanned: 0, changed: 0, more: false });
    const rows = await db.query.run.findMany();
    const status = new Map(rows.map((row) => [row.id, row.status]));
    expect(status.get(fresh)).toBe("active");
    expect(status.get(done)).toBe("completed");
    expect(status.get(waiting)).toBe("awaiting_input");
    expect(await db.query.event.findMany({ where: { kind: "run.went_stale" } })).toHaveLength(0);
  });

  it("leaves a swept Run open, because stale is recoverable and never terminal", async () => {
    const { db, workspaceId, issue, agent } = await workspaceWithAgent();
    const runId = await seedRun(db, { issueId: issue.id, agentMemberId: agent.member.id }, 31);

    await sweepStaleRuns({ db, workspaceId });

    const row = await db.query.run.findFirst({ where: { id: runId } });
    expect(isOpen(row?.status ?? "completed")).toBe(true);
    // The silence itself survives: the sweep is not the Agent speaking.
    expect(row?.lastActivityAt.getTime()).toBeLessThan(Date.now() - 30 * MINUTE);
  });

  it("costs the same handful of statements whatever the Workspace holds", async () => {
    const { db, workspaceId, issue, agent } = await workspaceWithAgent();
    await seedRuns(db, { issueId: issue.id, agentMemberId: agent.member.id }, 50, 31);
    const { counted, statements } = countingDb(db);

    const result = await sweepStaleRuns({ db: counted, workspaceId });

    expect(result).toEqual({ scanned: 50, changed: 50, more: true });
    // One indexed SELECT, one batched UPDATE, and the Events in chunks that
    // stay inside D1's hundred bound parameters per statement.
    // The trailing select is the subscriptions this sweep owes delivery to:
    // one read for the pass, not one per Run (webhooks.ts).
    expect(statements).toEqual(["select", "update", "insert", "insert", "insert", "select"]);
  });

  it("costs what the limit says, not what the table holds", async () => {
    const { db, workspaceId, issue, agent } = await workspaceWithAgent();
    await seedRuns(db, { issueId: issue.id, agentMemberId: agent.member.id }, 50, 31);
    const { counted, statements } = countingDb(db);

    const first = await sweepStaleRuns({ db: counted, workspaceId, limit: 10 });

    expect(first).toEqual({ scanned: 10, changed: 10, more: true });
    expect(statements).toEqual(["select", "update", "insert", "select"]);
    // `more` means run it again, never raise the limit: one pass has to fit
    // inside a Cloudflare Cron Trigger's CPU budget.
    let passes = 1;
    let result = first;
    while (result.more && passes < 10) {
      result = await sweepStaleRuns({ db, workspaceId, limit: 10 });
      passes += 1;
    }
    // Five passes move ten Runs each and a sixth finds nothing: a full pass
    // cannot know it was the last one without looking again.
    expect(passes).toBe(6);
    expect(result.more).toBe(false);
    expect(await db.query.event.findMany({ where: { kind: "run.went_stale" } })).toHaveLength(50);
  });
});

describe("the job queue port", () => {
  it("swallows the enqueue, because the durable row is the record and the queue is a hint", async () => {
    // A deployment with no queue still works: every sweep finds the same rows,
    // only later. What must never happen is a queue turning a successful write
    // into a failed request.
    await expect(
      discardingJobQueue().enqueue({ kind: "webhook.delivery", id: "d1" }),
    ).resolves.toBeUndefined();
  });
});

/** A second record in the same Project, straight into the table. */
async function seedIssue(db: Db, projectId: string, socketId: string, number: number) {
  const id = newId("issue");
  const key = `acme/deevy#${String(number)}`;
  await db.insert(issueTable).values({
    id,
    projectId,
    socketId,
    externalId: String(number),
    externalKey: key,
    url: `https://tracker.test/${key}`,
    title: `Record ${String(number)}`,
    state: "open",
    stateName: "Open",
    externalUpdatedAt: new Date(),
  });
  return id;
}

/** Gives an Agent a schedule, the way `agents.update` does. */
async function scheduleEvery(db: Db, agentMemberId: string, minutes: number | null) {
  await db
    .update(agentTable)
    .set({ scheduleMinutes: minutes })
    .where(eq(agentTable.memberId, agentMemberId));
}

async function assignTo(db: Db, issueId: string, memberId: string | null) {
  await db.update(issueTable).set({ assigneeMemberId: memberId }).where(eq(issueTable.id, issueId));
}

describe("the schedule sweep", () => {
  it("starts one Run per assigned Issue when an Agent's schedule comes due, and none again", async () => {
    const { db, workspaceId, project, issue, agent } = await workspaceWithAgent();
    const second = await seedIssue(db, project.id, issue.socketId, 2);
    await assignTo(db, issue.id, agent.member.id);
    await assignTo(db, second, agent.member.id);
    await scheduleEvery(db, agent.member.id, 60);

    const first = await sweepSchedules({ db, workspaceId });
    expect(first).toMatchObject({ due: 1, started: 2, more: false });

    // The schedule just ran, so it is not due again until the hour is up, and
    // the two Runs it started are open anyway.
    const again = await sweepSchedules({ db, workspaceId });
    expect(again).toMatchObject({ due: 0, started: 0, more: false });

    const runs = await db.query.run.findMany();
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.trigger === "schedule" && run.status === "pending")).toBe(true);
    // Nobody asked for it: the clock is not a Member.
    expect(runs.every((run) => run.triggeredByMemberId === null)).toBe(true);
  });

  it("leaves alone an Agent with no schedule, one not yet due, and a suspended one", async () => {
    const { db, workspaceId, issue, agent } = await workspaceWithAgent();
    await assignTo(db, issue.id, agent.member.id);

    // No schedule at all.
    expect(await sweepSchedules({ db, workspaceId })).toMatchObject({ due: 0, started: 0 });

    // Due in an hour, swept half an hour in.
    await scheduleEvery(db, agent.member.id, 60);
    await sweepSchedules({ db, workspaceId });
    await db.delete(runTable);
    const halfAnHour = new Date(Date.now() + 30 * MINUTE);
    expect(await sweepSchedules({ db, workspaceId, now: halfAnHour })).toMatchObject({ due: 0 });

    // Due again, but suspended: a stopped Agent does no work (docs/PLAN.md).
    await db
      .update(memberTable)
      .set({ suspendedAt: new Date() })
      .where(eq(memberTable.id, agent.member.id));
    const laterStill = new Date(Date.now() + 90 * MINUTE);
    expect(await sweepSchedules({ db, workspaceId, now: laterStill })).toMatchObject({ due: 0 });
    expect(await db.query.run.findMany()).toHaveLength(0);
  });

  it("is answered by indexes, scans nothing, and sorts nothing", async () => {
    const { db, workspaceId } = await workspaceWithAgent();
    const queries = {
      "due agents": dueAgentsQuery(db, { workspaceId, now: new Date(), limit: 50 }),
      "scheduled issues": scheduledIssuesQuery(db, { agentMemberIds: ["a"], limit: 50 }),
    };

    for (const query of Object.values(queries)) {
      const plan = await db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query.getSQL()}`);
      const detail = plan.map((step) => step.detail).join("\n");
      // A scan would cost the Workspace and a sort would visit every row
      // before the LIMIT applied: one pass has to fit a Cron Trigger's budget.
      expect(detail).not.toContain("SCAN");
      expect(detail).not.toContain("TEMP B-TREE");
    }
    // The anti-join is the "at most one open Run per (issue, agent)" rule, and
    // an index answers it rather than a lookup per Issue.
    const issues = queries["scheduled issues"];
    const plan = await db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${issues.getSQL()}`);
    expect(plan.map((step) => step.detail).join("\n")).toContain("issue_assignee_idx");
  });

  it("costs the same handful of statements whatever the Workspace holds", async () => {
    const { db, workspaceId, project, issue, agent } = await workspaceWithAgent();
    await assignTo(db, issue.id, agent.member.id);
    for (let number = 2; number <= 40; number += 1) {
      await assignTo(db, await seedIssue(db, project.id, issue.socketId, number), agent.member.id);
    }
    await scheduleEvery(db, agent.member.id, 60);
    const { counted, statements } = countingDb(db);

    const result = await sweepSchedules({ db: counted, workspaceId });

    expect(result).toEqual({ due: 1, started: 40, more: false });
    // Two indexed SELECTs, the Runs and their Events in chunks that stay inside
    // D1's hundred bound parameters per statement, and one UPDATE for the
    // clocks. Never a query per Agent or per Issue.
    expect(statements).toEqual([
      "select",
      "select",
      "insert",
      "insert",
      "insert",
      "insert",
      "insert",
      // The subscriptions this pass owes delivery to. One read for the pass,
      // and no insert after it because this Workspace has none; with
      // subscriptions the rows are chunked, so the cost still follows the
      // limit rather than the table (webhooks.ts).
      "select",
      "update",
    ]);
  });

  it("costs what the limit says, not what the table holds", async () => {
    const { db, workspaceId, project, issue, agent } = await workspaceWithAgent();
    await assignTo(db, issue.id, agent.member.id);
    for (let number = 2; number <= 50; number += 1) {
      await assignTo(db, await seedIssue(db, project.id, issue.socketId, number), agent.member.id);
    }
    await scheduleEvery(db, agent.member.id, 60);
    const { counted, statements } = countingDb(db);

    const first = await sweepSchedules({ db: counted, workspaceId, limit: 10 });

    expect(first).toEqual({ due: 1, started: 10, more: true });
    expect(statements).toEqual(["select", "select", "insert", "insert", "select"]);
    // The Agent is deliberately not stamped while the backlog is short of
    // drained: an interval that marked itself done early would skip whatever
    // the limit cut off. The Runs just started are open, so each pass makes
    // progress and the sixth finds nothing left.
    let passes = 1;
    let result = first;
    while (result.more && passes < 10) {
      result = await sweepSchedules({ db, workspaceId, limit: 10 });
      passes += 1;
    }
    expect(passes).toBe(6);
    expect(await db.query.run.findMany()).toHaveLength(50);
    const stamped = await db.query.agent.findFirst({ where: { memberId: agent.member.id } });
    expect(stamped?.scheduleRanAt).not.toBeNull();
  });
});

/** A subscription that wants every Event of this Workspace, straight into the table. */
async function subscribeTo(db: Db, workspaceId: string, kinds: string[] | null = null) {
  const id = newId("webhook");
  await db.insert(webhookSubscriptionTable).values({
    id,
    workspaceId,
    url: "https://runtime.example/deevy",
    secret: "whsec_test",
    kinds,
  });
  return id;
}

describe("the webhook delivery sweep", () => {
  it("is answered by the index the deliveries share, and sorts nothing", async () => {
    const { db, workspaceId } = await workspaceWithAgent();
    const query = dueWebhookDeliveriesQuery(db, { workspaceId, now: new Date(), limit: 20 });

    const plan = await db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query.getSQL()}`);
    const detail = plan.map((step) => step.detail).join("\n");

    expect(detail).toContain("delivery_due_idx");
    // A sort would visit every due delivery before the LIMIT applied, so one
    // pass would cost the backlog instead of the limit.
    expect(detail).not.toContain("TEMP B-TREE");
    expect(detail).not.toContain("SCAN");
  });

  it("is claimed by one pass only, because two of them must not POST it twice", async () => {
    const { db, workspaceId, asAdmin, project } = await workspaceWithAgent();
    await subscribeTo(db, workspaceId);
    // Four records, so four Events are owed: one apiece now that opening one
    // no longer creates a Document beside it (ADR-0024).
    for (const title of ["First", "Second", "Third", "Fourth"]) {
      await asAdmin.issues.create({ projectSlug: project.slug, title });
    }
    const posted: string[] = [];
    const now = new Date();
    const pass = () =>
      deliverDueWebhooks({
        db,
        workspaceId,
        now,
        fetch: async (_url: string, init: RequestInit) => {
          posted.push(init.body as string);
          return new Response("", { status: 200 });
        },
      });

    const [first, second] = await Promise.all([pass(), pass()]);

    // Four Events are owed and four POSTs are made, however the two passes
    // divided them: the claim is what makes that true without a transaction.
    const owed = (await db.query.delivery.findMany()).filter((row) => row.target === "webhook");
    expect(owed).toHaveLength(4);
    expect(first.scanned + second.scanned).toBe(4);
    expect(first.delivered + second.delivered).toBe(4);
    expect(posted).toHaveLength(4);
    expect(owed.every((row) => row.deliveredAt !== null)).toBe(true);
  });

  it("costs the same handful of statements whatever is owed", async () => {
    const { db, workspaceId, asAdmin, project } = await workspaceWithAgent();
    await subscribeTo(db, workspaceId, ["issue.created"]);
    for (let n = 0; n < 20; n += 1) {
      await asAdmin.issues.create({ projectSlug: project.slug, title: `Record ${String(n)}` });
    }
    const { counted, statements } = countingDb(db);

    const result = await deliverDueWebhooks({
      db: counted,
      workspaceId,
      limit: 10,
      fetch: async () => new Response("", { status: 200 }),
    });

    expect(result).toMatchObject({ scanned: 10, delivered: 10, more: true });
    // The due scan, the claim, the two batched lookups the POSTs are rendered
    // from, and one UPDATE for the ten that landed the same way.
    expect(statements).toEqual(["select", "update", "select", "select", "update"]);
  });
});

describe("Events a sweep writes", () => {
  it("are owed to a subscription like any other, though the sweep skips appendEvent", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const { sockets } = fakeSockets();
    const asAda = createRouterClient(router, { context: { ...ada, sockets } });
    const seeded = await seedProject(db, ada.workspace.id);
    const agent = await agentContext(db, { sponsor: ada.member, grants: [seeded.project.id] });
    await asAda.webhooks.create({
      url: "https://runner.example/deevy",
      secret: "whsec_the_receiver_holds_this",
    });
    const nightly = await asAda.issues.create({
      projectSlug: seeded.project.slug,
      title: "Nightly",
      assignAgent: agent.member.id,
    });
    await db
      .update(agentTable)
      .set({ scheduleMinutes: 60 })
      .where(eq(agentTable.memberId, agent.member.id));

    // Assigning already opened a Run, and an Agent has one open Run per Issue,
    // so finish it or the schedule correctly finds nothing to do.
    const asAgent = createRouterClient(router, { context: agent });
    const opened = await asAgent.runs.list({ issue: nightly.url });
    await asAgent.runs.finish({
      runId: opened.runs[0]?.id ?? "",
      status: "completed",
      summary: "done",
    });

    const before = (await db.query.delivery.findMany({ where: { target: "webhook" } })).length;

    // The schedule trigger writes run.started straight to the log so its cost
    // follows its limit. That must not make what it writes undeliverable: an
    // Agent driven by a webhook would simply never hear about a scheduled Run.
    const swept = await sweepSchedules({ db, workspaceId: ada.workspace.id });
    expect(swept.started).toBeGreaterThan(0);

    const after = await db.query.delivery.findMany({ where: { target: "webhook" } });
    expect(after.length).toBe(before + swept.started);
  });
});

/**
 * A database that aborts `controller` the first time a statement of `kind` is
 * issued. The seam is the `db` argument every sweep already takes, so nothing
 * here reaches inside `runDueWork` to decide when the trigger gives up.
 */
function abortOn(db: Db, kind: "update", controller: AbortController): Db {
  let fired = false;
  return new Proxy(db, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (property !== kind || typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (!fired) {
          fired = true;
          controller.abort();
        }
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as Db;
}

describe("one trigger's worth of background work", () => {
  it("stops at the pass the signal was aborted before, and reports what it did", async () => {
    const { db, project, issue, agent } = await workspaceWithAgent();
    await seedRuns(db, { issueId: issue.id, agentMemberId: agent.member.id }, 3, 31);
    // Work for the pass after the stale sweep, so the report saying it started
    // nothing is a fact about the abort rather than about the seed.
    const second = await seedIssue(db, project.id, issue.socketId, 2);
    await assignTo(db, second, agent.member.id);
    await scheduleEvery(db, agent.member.id, 60);

    // The stale sweep's claiming UPDATE is the first of the trigger, so
    // aborting on it lands between that pass and the schedule sweep.
    const controller = new AbortController();
    const result = await runDueWork({
      db: abortOn(db, "update", controller),
      signal: controller.signal,
    });

    expect(result).toMatchObject({ staleRuns: 3, scheduled: 0, aborted: true });
    const runs = await db.query.run.findMany();
    // The pass in flight finished, and the schedule sweep never began.
    expect(runs.map((run) => run.status)).toEqual(["stale", "stale", "stale"]);
  });
});
