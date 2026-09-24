import { issue as issueTable, projectGrant, workspace as workspaceTable } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { appendEvent } from "../src/events.ts";
import type { DelegationLimits } from "../src/issues.ts";
import { router } from "../src/operations/index.ts";
import {
  agentContext,
  fakeSockets,
  memberContext,
  seedProject,
  testDb,
  type MemberContext,
} from "./helpers.ts";

/**
 * An Agent cutting work up and handing the pieces over (ADR-0022).
 *
 * What changed with the Sockets cut is where a sub-issue lives: the record is
 * opened in the tracker and deevy projects it, and "closed" is the tracker's
 * word rather than a State's category. The rules are the same ones — the three
 * ceilings, the wake-up, the rolled-up inbox line — and this is where they are
 * held.
 */

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const clientFor = (context: MemberContext) => createRouterClient(router, { context });

async function workspaceWithTwoAgents(limits: Partial<DelegationLimits> = {}) {
  const { db, close } = testDb();
  closers.push(close);
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  if (Object.keys(limits).length > 0) {
    // Before the Agents' contexts are built: a context holds the Workspace it
    // was made with, so an Agent made earlier would never hear the new numbers.
    await db.update(workspaceTable).set(limits).where(eq(workspaceTable.id, admin.workspace.id));
  }
  const { sockets } = fakeSockets();
  const context = { ...admin, sockets };
  const seeded = await seedProject(db, admin.workspace.id);
  const parent = await seeded.record({ externalId: "1", title: "Checkout rewrite" });
  const planner = await agentContext(db, {
    name: "Planner",
    sponsor: admin.member,
    grants: [seeded.project.id],
  });
  const builder = await agentContext(db, {
    name: "Builder",
    sponsor: admin.member,
    grants: [seeded.project.id],
  });
  return {
    db,
    admin: context,
    asAdmin: clientFor(context),
    project: seeded.project,
    record: seeded.record,
    parent,
    planner,
    builder,
    asPlanner: clientFor({ ...planner, sockets }),
  };
}

/** What the tracker closing a record does, which is what finishes a piece of work. */
async function close(
  source: MemberContext,
  issue: { id: string; projectId: string },
): Promise<void> {
  await source.db.update(issueTable).set({ state: "closed" }).where(eq(issueTable.id, issue.id));
  await appendEvent(source, {
    kind: "issue.closed",
    subjectType: "issue",
    subjectId: issue.id,
    projectId: issue.projectId,
    payload: {},
  });
}

describe("an Agent handing work to another Agent", () => {
  it("opens the record in the tracker and starts the Run of the Agent named, in one call", async () => {
    const { asAdmin, asPlanner, parent, builder } = await workspaceWithTwoAgents();

    const child = await asPlanner.issues.create({
      parent: parent.url,
      title: "Cart totals",
      assignAgent: builder.member.id,
    });

    expect(child.parentId).toBe(parent.id);
    const { runs } = await asAdmin.runs.list({ issue: child.url });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agentMemberId: builder.member.id, trigger: "assignment" });
  });

  it("says in the log what it was opened under, and who it was handed to", async () => {
    const { asAdmin, asPlanner, parent, planner, builder } = await workspaceWithTwoAgents();

    const child = await asPlanner.issues.create({
      parent: parent.url,
      title: "Cart totals",
      assignAgent: builder.member.id,
    });

    const { events } = await asAdmin.events.list({});
    const created = events.find(
      (event) => event.kind === "issue.created" && event.subjectId === child.id,
    );
    // `delegatedTo` is the parent, because a wave of sub-issues is one line
    // about the parent and that is where the line points.
    expect(created?.payload).toMatchObject({
      parentKey: parent.externalKey,
      delegatedTo: parent.id,
      delegatedBy: planner.member.id,
      assignedTo: builder.member.id,
    });
  });

  it("opens no Run at all when the child was handed to nobody", async () => {
    const { asAdmin, asPlanner, parent } = await workspaceWithTwoAgents();

    const child = await asPlanner.issues.create({ parent: parent.url, title: "Nobody's yet" });

    expect((await asAdmin.runs.list({ issue: child.url })).runs).toHaveLength(0);
  });

  it("keeps the tree even where the tracker could not link the two", async () => {
    const { asPlanner, parent } = await workspaceWithTwoAgents();

    const child = await asPlanner.issues.create({ parent: parent.url, title: "Cart totals" });

    // deevy's own parent link is set whatever the provider managed, which is
    // how a tree survives a tracker with no sub-issues of its own.
    expect(child.parentId).toBe(parent.id);
    expect(child.body).toContain(parent.url);
  });
});

describe("a child in another Project", () => {
  it("is opened where its Agent was granted, and called by that tracker's name", async () => {
    const { db, admin, parent, planner } = await workspaceWithTwoAgents();
    const other = await seedProject(db, admin.workspace.id, {
      slug: "api",
      scopeKey: "acme/api",
    });
    await db
      .insert(projectGrant)
      .values({ memberId: planner.member.id, projectId: other.project.id });
    const asGranted = clientFor({
      ...planner,
      sockets: fakeSockets().sockets,
      grantedProjectIds: [parent.projectId, other.project.id],
    });

    const child = await asGranted.issues.create({
      parent: parent.url,
      projectSlug: other.project.slug,
      title: "The API half",
    });

    expect(child.projectId).toBe(other.project.id);
    expect(child.externalKey).toBe("acme/api#new-1");
    expect(child.parentId).toBe(parent.id);
  });

  it("answers 'No such Issue' for a parent in a Project the caller was not granted", async () => {
    const { db, admin, planner } = await workspaceWithTwoAgents();
    const hidden = await seedProject(db, admin.workspace.id, {
      slug: "hidden",
      scopeKey: "acme/hidden",
    });
    const unseen = await hidden.record({ externalId: "1", title: "Not yours" });
    const asPlanner = clientFor({ ...planner, sockets: fakeSockets().sockets });

    await expect(
      asPlanner.issues.create({ parent: unseen.url, title: "Under something unseen" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("a fan-out that has a bottom", () => {
  it("refuses the child past the limit, and says which limit and how many", async () => {
    const { asPlanner, parent } = await workspaceWithTwoAgents({ maxChildrenPerIssue: 2 });

    await asPlanner.issues.create({ parent: parent.url, title: "One" });
    await asPlanner.issues.create({ parent: parent.url, title: "Two" });

    await expect(
      asPlanner.issues.create({ parent: parent.url, title: "Three" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /already has 2 sub-issues/ });
  });

  it("puts a refusal in the log, so the Sponsor knows a number shaped the work", async () => {
    const { asAdmin, asPlanner, parent } = await workspaceWithTwoAgents({ maxChildrenPerIssue: 1 });

    await asPlanner.issues.create({ parent: parent.url, title: "One" });
    await expect(asPlanner.issues.create({ parent: parent.url, title: "Two" })).rejects.toThrow();

    const { events } = await asAdmin.events.list({});
    const refused = events.find((event) => event.kind === "delegation.refused");
    expect(refused).toMatchObject({ subjectType: "issue", subjectId: parent.id });
    expect(refused?.payload).toMatchObject({ limit: "children", allowed: 1 });
  });

  it("does not bind a Human, who is not the failure mode this is for", async () => {
    const { asAdmin, asPlanner, parent } = await workspaceWithTwoAgents({ maxChildrenPerIssue: 1 });

    await asPlanner.issues.create({ parent: parent.url, title: "One" });

    const byAHuman = await asAdmin.issues.create({ parent: parent.url, title: "Two" });
    expect(byAHuman.parentId).toBe(parent.id);
  });

  it("refuses a tree deeper than the Workspace allows", async () => {
    const { asPlanner, parent } = await workspaceWithTwoAgents({ maxDelegationDepth: 2 });

    const child = await asPlanner.issues.create({ parent: parent.url, title: "Level one" });
    const grandchild = await asPlanner.issues.create({ parent: child.url, title: "Level two" });

    await expect(
      asPlanner.issues.create({ parent: grandchild.url, title: "Too deep" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /2 deep/ });
  });

  it("counts what is open in the whole tree, and closing one makes room", async () => {
    const { admin, asPlanner, parent } = await workspaceWithTwoAgents({ maxOpenDescendants: 2 });

    const one = await asPlanner.issues.create({ parent: parent.url, title: "One" });
    await asPlanner.issues.create({ parent: parent.url, title: "Two" });
    await expect(
      asPlanner.issues.create({ parent: parent.url, title: "Three" }),
    ).rejects.toMatchObject({ message: /open sub-issues/ });

    await close(admin, one);
    const third = await asPlanner.issues.create({ parent: parent.url, title: "Three" });
    expect(third.parentId).toBe(parent.id);
  });

  it("is an admin's to change, and refuses a ceiling of nothing", async () => {
    const { asAdmin } = await workspaceWithTwoAgents();

    const updated = await asAdmin.workspace.update({ maxChildrenPerIssue: 40 });
    expect(updated.maxChildrenPerIssue).toBe(40);

    await expect(asAdmin.workspace.update({ maxChildrenPerIssue: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("the parent waking when the last child closes", () => {
  it("does nothing while any of them is still open", async () => {
    const { admin, asAdmin, asPlanner, parent } = await workspaceWithTwoAgents();
    const one = await asPlanner.issues.create({ parent: parent.url, title: "One" });
    await asPlanner.issues.create({ parent: parent.url, title: "Two" });

    await close(admin, one);

    expect((await asAdmin.runs.list({ issue: parent.url })).runs).toHaveLength(0);
  });

  it("wakes the Agent that opened them, once, when the last one closes", async () => {
    const { admin, asAdmin, asPlanner, parent, planner } = await workspaceWithTwoAgents();
    const one = await asPlanner.issues.create({ parent: parent.url, title: "One" });
    const two = await asPlanner.issues.create({ parent: parent.url, title: "Two" });

    await close(admin, one);
    await close(admin, two);

    const { runs } = await asAdmin.runs.list({ issue: parent.url });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agentMemberId: planner.member.id, trigger: "children_done" });

    const { events } = await asAdmin.events.list({});
    const closed = events.filter((event) => event.kind === "issue.children_closed");
    expect(closed).toHaveLength(1);
    expect(closed[0]?.payload).toMatchObject({ children: 2, openedBy: planner.member.id });
  });

  it("does not wake it a second time when a child is reopened and closed again", async () => {
    const { db, admin, asAdmin, asPlanner, parent } = await workspaceWithTwoAgents();
    const one = await asPlanner.issues.create({ parent: parent.url, title: "One" });
    await close(admin, one);
    expect((await asAdmin.runs.list({ issue: parent.url })).runs).toHaveLength(1);

    await db.update(issueTable).set({ state: "open" }).where(eq(issueTable.id, one.id));
    await close(admin, one);

    // The open Run the first close started is still the Agent's attempt on
    // this parent, so there is nothing for a second to claim.
    expect((await asAdmin.runs.list({ issue: parent.url })).runs).toHaveLength(1);
  });

  it("leaves a parent that is already finished alone", async () => {
    const { db, admin, asAdmin, asPlanner, parent } = await workspaceWithTwoAgents();
    const one = await asPlanner.issues.create({ parent: parent.url, title: "One" });
    await db.update(issueTable).set({ state: "closed" }).where(eq(issueTable.id, parent.id));

    await close(admin, one);

    expect((await asAdmin.runs.list({ issue: parent.url })).runs).toHaveLength(0);
  });

  it("says the children are done even when there is no Agent left to wake", async () => {
    const { admin, asAdmin, asPlanner, parent, planner } = await workspaceWithTwoAgents();
    const one = await asPlanner.issues.create({ parent: parent.url, title: "One" });
    await asAdmin.agents.suspend({ memberId: planner.member.id });

    await close(admin, one);

    // The Event still goes in, so a parent whose work is finished is visibly a
    // Human's rather than silently nobody's.
    const { events } = await asAdmin.events.list({});
    expect(events.some((event) => event.kind === "issue.children_closed")).toBe(true);
    expect((await asAdmin.runs.list({ issue: parent.url })).runs).toHaveLength(0);
  });
});

describe("an inbox that survives a fan-out", () => {
  it("is one line for a wave of sub-issues, not one line each", async () => {
    const { asAdmin, asPlanner, parent } = await workspaceWithTwoAgents();

    for (const title of ["One", "Two", "Three"]) {
      await asPlanner.issues.create({ parent: parent.url, title });
    }

    // Addressed to the Sponsor of the Agent that split the work, and rolled up
    // while it is unread: three rows about one thing is an inbox nobody uses.
    const { notifications } = await asAdmin.inbox.list({});
    const delegation = notifications.filter((row) => row.kind === "delegation");
    expect(delegation).toHaveLength(1);
  });
});
