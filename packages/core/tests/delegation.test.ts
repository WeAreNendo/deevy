import {
  workflowState as workflowStateTable,
  workspace as workspaceTable,
  type Db,
} from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { DelegationLimits } from "../src/issues.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, memberContext, testDb, type MemberContext } from "./helpers.ts";

/** The router as one Member sees it, which is how every test here calls deevy. */
const clientFor = (context: MemberContext) => createRouterClient(router, { context });
type Client = ReturnType<typeof clientFor>;

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * A Workspace where one Agent can hand work to another: an admin, a Project,
 * DEV-1 to be the parent, and `planner` and `builder` both granted it
 * (docs/plans/sub-issue-delegation.md).
 */
async function workspaceWithTwoAgents(
  /**
   * The Workspace's ceilings, applied before the Agents' contexts are built. A
   * context holds the Workspace it was made with, and a real request builds one
   * per call — so a test that changed the row afterwards would be asking Agents
   * that had never heard of the new numbers.
   */
  limits: Partial<DelegationLimits> = {},
) {
  const { db, close } = testDb();
  closers.push(close);
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  if (Object.keys(limits).length > 0) {
    await db.update(workspaceTable).set(limits).where(eq(workspaceTable.id, admin.workspace.id));
  }
  const asAdmin = clientFor(admin);
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
  // No Gates. What a Gate does to an Issue is four-eyes-gates.md's subject, and
  // a fixture where nothing can be closed without two rulings turns every test
  // below into a test about rulings.
  await db
    .update(workflowStateTable)
    .set({ isGate: false })
    .where(eq(workflowStateTable.projectId, project.id));
  return {
    db,
    admin,
    asAdmin,
    project,
    planner,
    builder,
    asPlanner: clientFor(planner),
  };
}

/** Moves an Issue into its Project's `done` State, which is what closing one is. */
async function closeIssue(client: Client, key: string) {
  const project = await client.projects.get({ key: key.split("-")[0] as string });
  const done = project.states.find((state) => state.category === "done");
  if (!done) throw new Error(`${key}'s Project has no State that closes an Issue`);
  return client.issues.move({ key, stateId: done.id });
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

describe("a child in another Project", () => {
  /** DEV and OPS, with `planner` granted both and `builder` granted only OPS. */
  async function twoProjects() {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const asAdmin = clientFor(admin);
    const dev = await asAdmin.projects.create({ key: "DEV", name: "deevy" });
    const ops = await asAdmin.projects.create({ key: "OPS", name: "Operations" });
    await asAdmin.issues.create({ projectKey: "DEV", title: "Checkout rewrite" });
    const planner = await agentContext(db, {
      name: "Planner",
      sponsor: admin.member,
      grants: [dev.id, ops.id],
    });
    const opsOnly = await agentContext(db, {
      name: "Builder",
      sponsor: admin.member,
      grants: [ops.id],
    });
    return {
      db,
      admin,
      asAdmin,
      dev,
      ops,
      planner,
      opsOnly,
      asPlanner: clientFor(planner),
      asOpsOnly: clientFor(opsOnly),
    };
  }

  it("is called by its own name, not by its parent's", async () => {
    const { asPlanner, asAdmin } = await twoProjects();

    const child = await asPlanner.issues.create({
      projectKey: "OPS",
      title: "Give the refund worker a queue",
      parentKey: "DEV-1",
    });

    // The key is built from the Issue's own Project or it is a lie: a link that
    // goes nowhere, an Event sentence about an Issue that does not exist, and
    // an Agent that follows it reading somebody else's work.
    expect(child.key).toBe("OPS-1");
    expect(child.parent?.key).toBe("DEV-1");
    const parent = await asAdmin.issues.get({ key: "DEV-1" });
    expect(parent.children.map((one) => one.key)).toEqual(["OPS-1"]);
  });

  it("follows its own Project's Workflow, because an Issue always has", async () => {
    const { db, ops, asPlanner } = await twoProjects();
    // The two Projects start with the same default Workflow, so landing in
    // "Intent" would prove nothing about which of them was read. Renaming OPS's
    // first State makes the answer say where it came from.
    await db
      .update(workflowStateTable)
      .set({ name: "Todo" })
      .where(and(eq(workflowStateTable.projectId, ops.id), eq(workflowStateTable.position, 0)));

    const child = await asPlanner.issues.create({
      projectKey: "OPS",
      title: "Give the refund worker a queue",
      parentKey: "DEV-1",
    });

    expect(child.state.name).toBe("Todo");
  });

  it("hides a parent whose Project the reader was not granted", async () => {
    const { asPlanner, asOpsOnly } = await twoProjects();
    await asPlanner.issues.create({
      projectKey: "OPS",
      title: "Give the refund worker a queue",
      parentKey: "DEV-1",
    });

    const seen = await asOpsOnly.issues.get({ key: "OPS-1" });

    // An ungranted Project does not exist to an Agent; it is not refused, it is
    // simply not there (docs/plans/m2.md).
    expect(seen.parent).toBeNull();
  });

  it("still refuses to let that reader move it out of the tree", async () => {
    const { asPlanner, asOpsOnly } = await twoProjects();
    await asPlanner.issues.create({
      projectKey: "OPS",
      title: "Give the refund worker a queue",
      parentKey: "DEV-1",
    });
    await asOpsOnly.issues.create({ projectKey: "OPS", title: "Somewhere else to put it" });

    // Hiding the parent and allowing the move would let an Agent lift an Issue
    // out of a tree it was never shown. Knowing some tree is there is the
    // cheaper of the two costs.
    await expect(
      asOpsOnly.issues.update({ key: "OPS-1", parentKey: "OPS-2" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("answers 'No such Issue' to a parent in a Project the caller was not granted", async () => {
    const { asOpsOnly } = await twoProjects();

    await expect(
      asOpsOnly.issues.create({
        projectKey: "OPS",
        title: "Give the refund worker a queue",
        parentKey: "DEV-1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cannot become its own ancestor through a Project boundary", async () => {
    const { asPlanner } = await twoProjects();
    await asPlanner.issues.create({
      projectKey: "OPS",
      title: "Give the refund worker a queue",
      parentKey: "DEV-1",
    });

    await expect(
      asPlanner.issues.update({ key: "DEV-1", parentKey: "OPS-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("a fan-out that has a bottom", () => {
  it("refuses the child past the limit, and says which limit and how many", async () => {
    const { asPlanner } = await workspaceWithTwoAgents({ maxChildrenPerIssue: 2 });

    await asPlanner.issues.create({ projectKey: "DEV", title: "One", parentKey: "DEV-1" });
    await asPlanner.issues.create({ projectKey: "DEV", title: "Two", parentKey: "DEV-1" });

    await expect(
      asPlanner.issues.create({ projectKey: "DEV", title: "Three", parentKey: "DEV-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // And nothing was created behind the refusal.
    const parent = await asPlanner.issues.get({ key: "DEV-1" });
    expect(parent.children).toHaveLength(2);
  });

  it("puts a refusal in the log, so the Sponsor knows a number shaped the work", async () => {
    const { db, asPlanner, planner } = await workspaceWithTwoAgents({ maxChildrenPerIssue: 1 });
    await asPlanner.issues.create({ projectKey: "DEV", title: "One", parentKey: "DEV-1" });

    await expect(
      asPlanner.issues.create({ projectKey: "DEV", title: "Two", parentKey: "DEV-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const refused = await db.query.event.findMany({ where: { kind: "delegation.refused" } });
    expect(refused).toHaveLength(1);
    expect(refused[0]?.actorMemberId).toBe(planner.member.id);
    expect(refused[0]?.payload).toMatchObject({ limit: "children", allowed: 1 });
  });

  it("does not bind a Human, who is not the failure mode this is for", async () => {
    const { asAdmin, asPlanner } = await workspaceWithTwoAgents({ maxChildrenPerIssue: 1 });
    await asPlanner.issues.create({ projectKey: "DEV", title: "One", parentKey: "DEV-1" });

    const mine = await asAdmin.issues.create({
      projectKey: "DEV",
      title: "And one of my own",
      parentKey: "DEV-1",
    });

    expect(mine.parent?.key).toBe("DEV-1");
  });

  it("refuses a tree deeper than the Workspace allows", async () => {
    const { asPlanner } = await workspaceWithTwoAgents({ maxDelegationDepth: 2 });

    // DEV-1 is the root, so DEV-2 is depth 1 and DEV-3 is depth 2.
    await asPlanner.issues.create({ projectKey: "DEV", title: "Child", parentKey: "DEV-1" });
    await asPlanner.issues.create({ projectKey: "DEV", title: "Grandchild", parentKey: "DEV-2" });

    await expect(
      asPlanner.issues.create({ projectKey: "DEV", title: "Too deep", parentKey: "DEV-3" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("counts what is open in the whole tree, and closing one makes room", async () => {
    const { asAdmin, asPlanner } = await workspaceWithTwoAgents({ maxOpenDescendants: 2 });
    await asPlanner.issues.create({ projectKey: "DEV", title: "One", parentKey: "DEV-1" });
    await asPlanner.issues.create({ projectKey: "DEV", title: "Two", parentKey: "DEV-2" });

    await expect(
      asPlanner.issues.create({ projectKey: "DEV", title: "Three", parentKey: "DEV-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // A closed Issue is not work anybody is doing, so it stops counting.
    await closeIssue(asAdmin, "DEV-2");
    const room = await asPlanner.issues.create({
      projectKey: "DEV",
      title: "Three",
      parentKey: "DEV-1",
    });
    expect(room.parent?.key).toBe("DEV-1");
  });

  it("is an admin's to change, and refuses a ceiling of nothing", async () => {
    const { asAdmin } = await workspaceWithTwoAgents();

    const saved = await asAdmin.workspace.update({ maxChildrenPerIssue: 40 });
    expect(saved.maxChildrenPerIssue).toBe(40);

    await expect(asAdmin.workspace.update({ maxDelegationDepth: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
