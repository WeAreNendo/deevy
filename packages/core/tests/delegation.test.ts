import {
  notification as notificationTable,
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

describe("the parent waking when the last child closes", () => {
  /** DEV-1 with three children, all opened by `planner` and worked by `builder`. */
  async function delegated(children = 3) {
    const set = await workspaceWithTwoAgents();
    for (let one = 1; one <= children; one++) {
      await set.asPlanner.issues.create({
        projectKey: "DEV",
        title: `Part ${String(one)}`,
        parentKey: "DEV-1",
        assigneeMemberId: set.builder.member.id,
      });
    }
    return set;
  }

  const runsOn = async (db: Db, key: string, client: Client) => {
    const issue = await client.issues.get({ key });
    return db.query.run.findMany({ where: { issueId: issue.id } });
  };

  it("does nothing while any of them is still open", async () => {
    const { db, asAdmin } = await delegated();

    await closeIssue(asAdmin, "DEV-2");
    await closeIssue(asAdmin, "DEV-3");

    expect(await runsOn(db, "DEV-1", asAdmin)).toHaveLength(0);
    expect(await db.query.event.findMany({ where: { kind: "issue.children_closed" } })).toEqual([]);
  });

  it("wakes the Agent that opened them, once, when the last one closes", async () => {
    const { db, asAdmin, planner } = await delegated();

    await closeIssue(asAdmin, "DEV-2");
    await closeIssue(asAdmin, "DEV-3");
    await closeIssue(asAdmin, "DEV-4");

    const runs = await runsOn(db, "DEV-1", asAdmin);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      agentMemberId: planner.member.id,
      trigger: "children_done",
      status: "pending",
    });
    const closed = await db.query.event.findMany({ where: { kind: "issue.children_closed" } });
    expect(closed).toHaveLength(1);
  });

  it("does not wake it a second time when a child is reopened and closed again", async () => {
    const { db, asAdmin, project } = await delegated(1);
    await closeIssue(asAdmin, "DEV-2");
    expect(await runsOn(db, "DEV-1", asAdmin)).toHaveLength(1);

    const backlog = await asAdmin.projects.get({ key: "DEV" });
    const open = backlog.states.find((state) => state.category === "active");
    await asAdmin.issues.move({ key: "DEV-2", stateId: open!.id });
    await closeIssue(asAdmin, "DEV-2");

    expect(await runsOn(db, "DEV-1", asAdmin)).toHaveLength(1);
    expect(project.id).toBeTruthy();
  });

  it("leaves a parent that is already finished alone", async () => {
    const { db, asAdmin } = await delegated(1);
    await closeIssue(asAdmin, "DEV-1");

    await closeIssue(asAdmin, "DEV-2");

    expect(await runsOn(db, "DEV-1", asAdmin)).toHaveLength(0);
  });

  it("wakes each level once as a tree closes from the bottom", async () => {
    const { db, asAdmin, asPlanner, builder, planner } = await workspaceWithTwoAgents();
    await asPlanner.issues.create({
      projectKey: "DEV",
      title: "Middle",
      parentKey: "DEV-1",
      assigneeMemberId: builder.member.id,
    });
    await asPlanner.issues.create({
      projectKey: "DEV",
      title: "Bottom",
      parentKey: "DEV-2",
      assigneeMemberId: builder.member.id,
    });

    await closeIssue(asAdmin, "DEV-3");
    expect(await runsOn(db, "DEV-2", asAdmin)).toHaveLength(2); // its own, and the wake-up
    await closeIssue(asAdmin, "DEV-2");

    const top = await runsOn(db, "DEV-1", asAdmin);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ agentMemberId: planner.member.id, trigger: "children_done" });
    const closed = await db.query.event.findMany({ where: { kind: "issue.children_closed" } });
    expect(closed).toHaveLength(2);
  });

  it("says the children are done even when there is no Agent left to wake", async () => {
    const { db, asAdmin, asPlanner, planner } = await workspaceWithTwoAgents();
    await asPlanner.issues.create({ projectKey: "DEV", title: "Only part", parentKey: "DEV-1" });
    await asAdmin.agents.suspend({ memberId: planner.member.id });

    await closeIssue(asAdmin, "DEV-2");

    // Nothing is started on the Agent's behalf, and the parent is visibly a
    // Human's problem rather than silently nobody's.
    expect(await runsOn(db, "DEV-1", asAdmin)).toHaveLength(0);
    expect(
      await db.query.event.findMany({ where: { kind: "issue.children_closed" } }),
    ).toHaveLength(1);
  });

  it("counts a child in another Project, because done is done wherever it is", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const asAdmin = clientFor(admin);
    const dev = await asAdmin.projects.create({ key: "DEV", name: "deevy" });
    const ops = await asAdmin.projects.create({ key: "OPS", name: "Operations" });
    await db.update(workflowStateTable).set({ isGate: false });
    await asAdmin.issues.create({ projectKey: "DEV", title: "Checkout rewrite" });
    const planner = await agentContext(db, {
      name: "Planner",
      sponsor: admin.member,
      grants: [dev.id, ops.id],
    });
    const asPlanner = clientFor(planner);
    await asPlanner.issues.create({ projectKey: "DEV", title: "Here", parentKey: "DEV-1" });
    await asPlanner.issues.create({ projectKey: "OPS", title: "There", parentKey: "DEV-1" });

    await closeIssue(asAdmin, "DEV-2");
    const parent = await asAdmin.issues.get({ key: "DEV-1" });
    expect(await db.query.run.findMany({ where: { issueId: parent.id } })).toHaveLength(0);

    await closeIssue(asAdmin, "OPS-1");

    const runs = await db.query.run.findMany({ where: { issueId: parent.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agentMemberId: planner.member.id, trigger: "children_done" });
  });
});

describe("an inbox that survives a fan-out", () => {
  const inboxOf = async (db: Db, memberId: string) =>
    db.query.notification.findMany({ where: { recipientMemberId: memberId } });

  it("is one line for a wave of sub-issues, not one line each", async () => {
    const { db, admin, asPlanner, builder } = await workspaceWithTwoAgents();

    for (let one = 1; one <= 6; one++) {
      await asPlanner.issues.create({
        projectKey: "DEV",
        title: `Part ${String(one)}`,
        parentKey: "DEV-1",
        assigneeMemberId: builder.member.id,
      });
    }

    const rolled = (await inboxOf(db, admin.member.id)).filter((one) => one.kind === "delegation");
    expect(rolled).toHaveLength(1);
    expect(rolled[0]?.recipientMemberId).toBe(admin.member.id);
  });

  it("still tells a Human about their own work, because a rollup is for the wave", async () => {
    const { db, admin, asPlanner } = await workspaceWithTwoAgents();
    const grace = await memberContext(db, { name: "Grace", email: "grace@example.com" });

    await asPlanner.issues.create({
      projectKey: "DEV",
      title: "One for a Human",
      parentKey: "DEV-1",
      assigneeMemberId: grace.member.id,
    });

    expect((await inboxOf(db, grace.member.id)).some((one) => one.kind === "assignment")).toBe(
      true,
    );
    expect(admin.member.id).toBeTruthy();
  });

  it("says so when every sub-issue is finished", async () => {
    const { db, admin, asAdmin, asPlanner } = await workspaceWithTwoAgents();
    await asPlanner.issues.create({ projectKey: "DEV", title: "Only part", parentKey: "DEV-1" });

    await closeIssue(asAdmin, "DEV-2");

    const rolled = (await inboxOf(db, admin.member.id)).filter((one) => one.kind === "delegation");
    // The wave, and the wave finishing.
    expect(rolled).toHaveLength(2);
  });
});

describe("what the review found", () => {
  const inboxOf = async (db: Db, memberId: string) =>
    db.query.notification.findMany({ where: { recipientMemberId: memberId } });

  it("still tells the Humans who rule a Gate that a sub-issue arrived in one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    const asAdmin = clientFor(admin);
    const project = await asAdmin.projects.create({ key: "DEV", name: "deevy" });
    await asAdmin.issues.create({ projectKey: "DEV", title: "Checkout rewrite" });
    const planner = await agentContext(db, {
      name: "Planner",
      sponsor: admin.member,
      grants: [project.id],
    });

    // The default Workflow's first State is a Gate, so every sub-issue lands in
    // one. Rolling the wave up must not take the Gate's own recipients with it.
    await clientFor(planner).issues.create({
      projectKey: "DEV",
      title: "A part",
      parentKey: "DEV-1",
    });

    expect((await inboxOf(db, bob.member.id)).map((one) => one.kind)).toContain("gate_awaiting");
    expect((await inboxOf(db, admin.member.id)).map((one) => one.kind)).toContain("delegation");
  });

  it("announces a second wave, which the first wave's ending used to swallow", async () => {
    const { db, admin, asAdmin, asPlanner } = await workspaceWithTwoAgents();
    await asPlanner.issues.create({ projectKey: "DEV", title: "Wave one", parentKey: "DEV-1" });
    // Read, which is what makes the next wave a new line rather than a repeat
    // of one still sitting there unread.
    await db.update(notificationTable).set({ readAt: new Date() });
    await closeIssue(asAdmin, "DEV-2");

    await asPlanner.issues.create({ projectKey: "DEV", title: "Wave two", parentKey: "DEV-1" });

    const waves = (await inboxOf(db, admin.member.id)).filter(
      (one) => one.kind === "delegation",
    ).length;
    // The wave, its ending, and the next wave. The ending is unread when the
    // next wave arrives, and used to swallow it.
    expect(waves).toBe(3);
  });

  it("credits the woken Run to the Agent that split the work, not to whoever closed the last part", async () => {
    const { db, asAdmin, asPlanner, planner } = await workspaceWithTwoAgents();
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    await asPlanner.issues.create({ projectKey: "DEV", title: "Only part", parentKey: "DEV-1" });

    await closeIssue(clientFor(bob), "DEV-2");

    const parent = await asAdmin.issues.get({ key: "DEV-1" });
    const [run] = await db.query.run.findMany({ where: { issueId: parent.id } });
    // `triggeredByMemberId` decides who hears the Run finished, so a passing
    // Human must not inherit the delegating Agent's Sponsor's mail.
    expect(run?.triggeredByMemberId).toBe(planner.member.id);
  });

  it("files a refusal against the parent's own Project, wherever the child was going", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const asAdmin = clientFor(admin);
    const dev = await asAdmin.projects.create({ key: "DEV", name: "deevy" });
    const ops = await asAdmin.projects.create({ key: "OPS", name: "Operations" });
    await db.update(workspaceTable).set({ maxChildrenPerIssue: 1 });
    await asAdmin.issues.create({ projectKey: "DEV", title: "Checkout rewrite" });
    const planner = await agentContext(db, {
      name: "Planner",
      sponsor: admin.member,
      grants: [dev.id, ops.id],
    });
    const asPlanner = clientFor(planner);
    await asPlanner.issues.create({ projectKey: "OPS", title: "One", parentKey: "DEV-1" });

    await expect(
      asPlanner.issues.create({ projectKey: "OPS", title: "Two", parentKey: "DEV-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const [refused] = await db.query.event.findMany({ where: { kind: "delegation.refused" } });
    // The Event is about the parent, so it belongs to the parent's Project: a
    // Project-scoped read of the log has to find it.
    expect(refused?.projectId).toBe(dev.id);
    expect(ops.id).toBeTruthy();
  });
});
