import { issue as issueTable } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { appendEvent } from "../src/events.ts";
import { routeIssueTo } from "../src/issues.ts";
import { router } from "../src/operations/index.ts";
import {
  agentContext,
  externalIssue,
  fakeSockets,
  memberContext,
  seedProject,
  testDb,
  type MemberContext,
} from "./helpers.ts";

/**
 * An Agent cutting work up (ADR-0022).
 *
 * The Agent opens the sub-issues in the tracker itself, with its own access,
 * and deevy projects them as it projects any record (docs/plans/simplify.md,
 * slice 4): a child is linked to its parent by the tracker's own parent field.
 * What deevy still does is notice when the last of a parent's children closes
 * and wake the Agent the parent is routed to, so the work comes back to it.
 */

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const clientFor = (context: MemberContext) => createRouterClient(router, { context });

async function workspaceWithTwoAgents() {
  const { db, close } = testDb();
  closers.push(close);
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
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
  // The Planner holds the parent, which is what makes it the Agent the
  // finished children wake.
  await routeIssueTo(db, parent.id, planner.member.id);
  let opened = 1;
  return {
    db,
    admin: context,
    asAdmin: clientFor(context),
    parent,
    planner,
    builder,
    /** The tracker saying something about a record, as a delivery does. */
    deliver: (over: Parameters<typeof externalIssue>[0]) =>
      seeded.deliver([
        {
          kind: "issue",
          scopeKey: "acme/deevy",
          issue: externalIssue(over),
          actor: { login: "planner", id: "u-planner", isBot: false },
        },
      ]),
    /** A sub-issue the Agent opened in the tracker, as deevy projects it. */
    child: (title: string) => {
      opened += 1;
      return seeded.record({ externalId: String(opened), title, parentExternalId: "1" });
    },
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

describe("a sub-issue from the tracker", () => {
  it("is linked to its parent by the tracker's own parent field", async () => {
    const { parent, child } = await workspaceWithTwoAgents();

    const one = await child("One");

    expect(one.parentId).toBe(parent.id);
    expect(one.parentExternalId).toBe("1");
  });

  it("is linked by a later delivery that names the parent, and stays linked by one that names none", async () => {
    const { db, parent, deliver } = await workspaceWithTwoAgents();
    const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    const child = () => db.query.issue.findFirst({ where: { externalId: "2" } });

    // GitHub opens the record first and makes it a sub-issue after, so the
    // delivery that names the parent is not the record's first.
    await deliver({ externalId: "2", title: "Part one", updatedAt: at(1) });
    expect((await child())?.parentId).toBeNull();
    await deliver({ externalId: "2", title: "Part one", parentExternalId: "1", updatedAt: at(2) });
    expect((await child())?.parentId).toBe(parent.id);

    // And most of GitHub's deliveries never say what the parent is.
    await deliver({ externalId: "2", title: "Part one", labels: ["bug"], updatedAt: at(3) });
    expect((await child())?.parentId).toBe(parent.id);
  });

  it("takes the parent even from a delivery that arrived after a newer one", async () => {
    const { db, parent, deliver } = await workspaceWithTwoAgents();
    const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);

    await deliver({ externalId: "2", title: "Part one", labels: ["bug"], updatedAt: at(3) });
    await deliver({ externalId: "2", title: "Part one", parentExternalId: "1", updatedAt: at(2) });

    // The snapshot stays the newer one; the link is a fact of its own.
    const child = await db.query.issue.findFirst({ where: { externalId: "2" } });
    expect(child?.parentId).toBe(parent.id);
    expect(child?.labels).toEqual(["bug"]);
  });
});

describe("the parent waking when the last child closes", () => {
  it("does nothing while any of them is still open", async () => {
    const { admin, asAdmin, parent, child } = await workspaceWithTwoAgents();
    const one = await child("One");
    await child("Two");

    await close(admin, one);

    expect((await asAdmin.runs.list({ issue: parent.url })).runs).toHaveLength(0);
  });

  it("wakes the Agent the parent is routed to, once, when the last one closes", async () => {
    const { admin, asAdmin, parent, planner, child } = await workspaceWithTwoAgents();
    const one = await child("One");
    const two = await child("Two");

    await close(admin, one);
    await close(admin, two);

    const { runs } = await asAdmin.runs.list({ issue: parent.url });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agentMemberId: planner.member.id, trigger: "children_done" });

    const { events } = await asAdmin.events.list({});
    const closed = events.filter((event) => event.kind === "issue.children_closed");
    expect(closed).toHaveLength(1);
    expect(closed[0]?.payload).toMatchObject({ children: 2, routedTo: planner.member.id });
  });

  it("does not wake it a second time when a child is reopened and closed again", async () => {
    const { db, admin, asAdmin, parent, child } = await workspaceWithTwoAgents();
    const one = await child("One");
    await close(admin, one);
    expect((await asAdmin.runs.list({ issue: parent.url })).runs).toHaveLength(1);

    await db.update(issueTable).set({ state: "open" }).where(eq(issueTable.id, one.id));
    await close(admin, one);

    // The open Run the first close started is still the Agent's attempt on
    // this parent, so there is nothing for a second to claim.
    expect((await asAdmin.runs.list({ issue: parent.url })).runs).toHaveLength(1);
  });

  it("leaves a parent that is already finished alone", async () => {
    const { db, admin, asAdmin, parent, child } = await workspaceWithTwoAgents();
    const one = await child("One");
    await db.update(issueTable).set({ state: "closed" }).where(eq(issueTable.id, parent.id));

    await close(admin, one);

    expect((await asAdmin.runs.list({ issue: parent.url })).runs).toHaveLength(0);
  });

  it("says the children are done even when there is no Agent left to wake", async () => {
    const { admin, asAdmin, parent, planner, child } = await workspaceWithTwoAgents();
    const one = await child("One");
    await asAdmin.agents.suspend({ memberId: planner.member.id });

    await close(admin, one);

    // The Event still goes in, so a parent whose work is finished is visibly a
    // Human's rather than silently nobody's.
    const { events } = await asAdmin.events.list({});
    expect(events.some((event) => event.kind === "issue.children_closed")).toBe(true);
    expect((await asAdmin.runs.list({ issue: parent.url })).runs).toHaveLength(0);
  });

  it("wakes nobody where the parent is routed to no Agent", async () => {
    const { db, admin, asAdmin, parent, child } = await workspaceWithTwoAgents();
    await routeIssueTo(db, parent.id, null);
    const one = await child("One");

    await close(admin, one);

    const { events } = await asAdmin.events.list({});
    const closed = events.find((event) => event.kind === "issue.children_closed");
    expect(closed?.payload).not.toHaveProperty("routedTo");
    expect((await asAdmin.runs.list({ issue: parent.url })).runs).toHaveLength(0);
  });
});

describe("the delegation ceilings", () => {
  it("are an admin's to change, and refuse a ceiling of nothing", async () => {
    const { asAdmin } = await workspaceWithTwoAgents();

    const updated = await asAdmin.workspace.update({ maxChildrenPerIssue: 40 });
    expect(updated.maxChildrenPerIssue).toBe(40);

    await expect(asAdmin.workspace.update({ maxChildrenPerIssue: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
