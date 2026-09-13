import { workflowState as workflowStateTable, type Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { agentContext, memberContext, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * A Workspace where one Agent can hand work to another: an admin, a Project,
 * DEV-1 to be the parent, and `planner` and `builder` both granted it
 * (docs/plans/sub-issue-delegation.md).
 */
async function workspaceWithTwoAgents() {
  const { db, close } = testDb();
  closers.push(close);
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const asAdmin = createRouterClient(router, { context: admin });
  const project = await asAdmin.projects.create({ key: "DEV", name: "deevy" });
  await asAdmin.issues.create({ projectKey: "DEV", title: "Checkout rewrite" });
  const planner = await agentContext(db, {
    name: "Planner",
    sponsor: admin.member,
    grants: [project.id],
  });
  const builder = await agentContext(db, {
    name: "Builder",
    sponsor: admin.member,
    grants: [project.id],
  });
  return {
    db,
    admin,
    asAdmin,
    project,
    planner,
    builder,
    asPlanner: createRouterClient(router, { context: planner }),
  };
}

/** Names the Agent a State's rule triggers, the way `workflow.update` does. */
async function ruleOn(db: Db, projectId: string, stateName: string, agentMemberId: string) {
  await db
    .update(workflowStateTable)
    .set({ triggerAgentMemberId: agentMemberId })
    .where(
      and(eq(workflowStateTable.projectId, projectId), eq(workflowStateTable.name, stateName)),
    );
}

describe("an Agent handing work to another Agent", () => {
  it("starts the Run of the Agent it was handed to, in one call", async () => {
    const { db, asPlanner, planner, builder } = await workspaceWithTwoAgents();

    const child = await asPlanner.issues.create({
      projectKey: "DEV",
      title: "Refund goes back to the card",
      parentKey: "DEV-1",
      assigneeMemberId: builder.member.id,
    });

    expect(child.parent?.key).toBe("DEV-1");
    const runs = await db.query.run.findMany({ where: { issueId: child.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      agentMemberId: builder.member.id,
      trigger: "assignment",
      status: "pending",
      triggeredByMemberId: planner.member.id,
    });
  });

  it("says in the log what it was opened under, so the Activity does not have to be clicked", async () => {
    const { db, asPlanner, builder } = await workspaceWithTwoAgents();

    const child = await asPlanner.issues.create({
      projectKey: "DEV",
      title: "Refund goes back to the card",
      parentKey: "DEV-1",
      assigneeMemberId: builder.member.id,
    });

    const events = await db.query.event.findMany({ where: { subjectId: child.id } });
    const kinds = events.map((one) => one.kind);
    // In that order: the Issue exists before it is handed to anybody.
    expect(kinds.indexOf("issue.created")).toBeLessThan(kinds.indexOf("issue.assigned"));
    const created = events.find((one) => one.kind === "issue.created");
    expect(created?.payload).toMatchObject({ parentKey: "DEV-1" });
  });

  it("opens no Run at all when the child was handed to nobody", async () => {
    const { db, asPlanner } = await workspaceWithTwoAgents();

    const child = await asPlanner.issues.create({
      projectKey: "DEV",
      title: "Something for later",
      parentKey: "DEV-1",
    });

    expect(await db.query.run.findMany({ where: { issueId: child.id } })).toHaveLength(0);
  });

  it("opens one Run and not two, where the State's own rule names the same Agent", async () => {
    // Both triggers now fire in one request: `issue.created` runs the State
    // rule and `issue.assigned` runs the assignment rule. The "at most one open
    // Run per (issue, agent)" rule is what stops the second, and it has never
    // been asked to do it from two triggers in the same tail.
    const { db, project, asPlanner, builder } = await workspaceWithTwoAgents();
    await ruleOn(db, project.id, "Intent", builder.member.id);

    const child = await asPlanner.issues.create({
      projectKey: "DEV",
      title: "Refund goes back to the card",
      parentKey: "DEV-1",
      assigneeMemberId: builder.member.id,
    });

    expect(await db.query.run.findMany({ where: { issueId: child.id } })).toHaveLength(1);
  });
});
