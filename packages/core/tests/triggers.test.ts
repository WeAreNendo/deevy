import { issue as issueTable } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { appendEvent } from "../src/events.ts";
import { routeIssueTo } from "../src/issues.ts";
import { router } from "../src/operations/index.ts";
import { triggersFor } from "../src/triggers.ts";
import { agentContext, fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/** An admin, a Project bound to a tracker, one projected record, and `@planner`. */
async function workspaceWithAgent() {
  const { db, close } = testDb();
  closers.push(close);
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const { sockets } = fakeSockets();
  const context = { ...admin, sockets };
  const asAdmin = createRouterClient(router, { context });
  const seeded = await seedProject(db, admin.workspace.id);
  const issue = await seeded.record({ externalId: "1", title: "Ship the thing" });
  const agent = await agentContext(db, {
    sponsor: admin.member,
    grants: [seeded.project.id],
    handle: "planner",
  });
  return { db, admin: context, asAdmin, project: seeded.project, record: seeded.record, issue, agent };
}

/** What a delivery does when its routing label names an Agent. */
async function route(
  source: { db: Parameters<typeof routeIssueTo>[0]; workspace: { id: string }; member: { id: string } },
  issue: { id: string; projectId: string },
  memberId: string,
) {
  await routeIssueTo(source.db, issue.id, memberId);
  await appendEvent(source, {
    kind: "issue.assigned",
    subjectType: "issue",
    subjectId: issue.id,
    projectId: issue.projectId,
    payload: { from: null, to: memberId, byRouting: true },
  });
}

describe("the assignment trigger", () => {
  it("creates one pending Run when a record is routed to an Agent", async () => {
    const { admin, asAdmin, issue, agent } = await workspaceWithAgent();

    await route(admin, issue, agent.member.id);

    const { runs } = await asAdmin.runs.list({ issue: issue.url });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      agentMemberId: agent.member.id,
      trigger: "assignment",
      status: "pending",
    });
  });
});

describe("the mention trigger", () => {
  it("creates a Run for an Agent a comment mentions", async () => {
    const { admin, asAdmin, issue, agent } = await workspaceWithAgent();

    await appendEvent(admin, {
      kind: "comment.created",
      subjectType: "issue",
      subjectId: issue.id,
      projectId: issue.projectId,
      payload: { body: "@planner have a look", mentionedMemberIds: [agent.member.id] },
    });

    const { runs } = await asAdmin.runs.list({ issue: issue.url });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agentMemberId: agent.member.id, trigger: "mention" });
  });
});

describe("a record closing", () => {
  it("wakes the Agent that opened the sub-issues, once they are all closed", async () => {
    const { db, admin, asAdmin, record, issue, agent } = await workspaceWithAgent();

    // Two children the Agent opened, as a delegation does.
    const one = await record({ externalId: "2", title: "Part one" });
    const two = await record({ externalId: "3", title: "Part two" });
    await db
      .update(issueTable)
      .set({ parentId: issue.id, createdBy: agent.member.id })
      .where(inArray(issueTable.id, [one.id, two.id]));

    const close = async (child: { id: string; projectId: string }) => {
      await db.update(issueTable).set({ state: "closed" }).where(eq(issueTable.id, child.id));
      await appendEvent(admin, {
        kind: "issue.closed",
        subjectType: "issue",
        subjectId: child.id,
        projectId: child.projectId,
        payload: {},
      });
    };

    // One closed is not all of them, so the parent waits.
    await close(one);
    expect((await asAdmin.runs.list({ issue: issue.url })).runs).toHaveLength(0);

    await close(two);
    const { runs } = await asAdmin.runs.list({ issue: issue.url });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agentMemberId: agent.member.id, trigger: "children_done" });
  });
});

describe("what does not trigger a Run", () => {
  it("says nothing when a record is routed to a Human", async () => {
    const { admin, asAdmin, issue } = await workspaceWithAgent();

    await route(admin, issue, admin.member.id);

    expect((await asAdmin.runs.list({ issue: issue.url })).runs).toHaveLength(0);
  });

  it("starts no second Run when the same Agent is routed the same record again", async () => {
    const { admin, asAdmin, issue, agent } = await workspaceWithAgent();

    await route(admin, issue, agent.member.id);
    await appendEvent(admin, {
      kind: "issue.assigned",
      subjectType: "issue",
      subjectId: issue.id,
      projectId: issue.projectId,
      payload: { from: null, to: agent.member.id },
    });

    expect((await asAdmin.runs.list({ issue: issue.url })).runs).toHaveLength(1);
  });
});

describe("the recursion guard", () => {
  it("makes a Run's own Events trigger nothing at all", async () => {
    const { db, admin, issue, agent } = await workspaceWithAgent();

    await route(admin, issue, agent.member.id);
    const started = await db.query.run.findFirst({ where: { issueId: issue.id } });

    const followed = await triggersFor(db, {
      seq: 999,
      workspaceId: admin.workspace.id,
      actorMemberId: agent.member.id,
      kind: "run.activity",
      subjectType: "run",
      subjectId: started?.id ?? "",
      projectId: issue.projectId,
      payload: { issueId: issue.id },
      createdAt: new Date(),
    });

    expect(followed).toEqual([]);
  });
});
