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
    /** A Human's comment on a record, as a delivery does. */
    comment: (externalId: string, body: string) =>
      seeded.deliver([
        {
          kind: "comment",
          scopeKey: "acme/deevy",
          issueExternalId: externalId,
          comment: {
            externalId: `c-${externalId}`,
            url: `https://tracker.test/acme/deevy#${externalId}-c`,
            body,
            author: { login: "ada", id: "u-ada", isBot: false },
            createdAt: new Date(),
          },
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

describe("a sub-issue the Agent labels for another Agent", () => {
  it("opens a Run for the Agent the label names, as any routed record does", async () => {
    const { asAdmin, builder, deliver } = await workspaceWithTwoAgents();

    await deliver({
      externalId: "2",
      title: "The payment form",
      parentExternalId: "1",
      labels: ["agent:builder"],
    });

    const { runs } = await asAdmin.runs.list({ issue: "acme/deevy#2" });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agentMemberId: builder.member.id, trigger: "assignment" });
  });
});

/**
 * One ceiling is left (docs/plans/simplify.md, slice 6): how deep a tree of
 * sub-issues may go before deevy stops handing its records to Agents. The
 * Agent opens the sub-issues in the tracker, where deevy cannot refuse one,
 * so what it refuses is the Run: a record past the ceiling is routed to
 * nobody, whatever names an Agent on it, and the log says why.
 */
describe("the depth ceiling", () => {
  /** Records 2 and 3: a child of record 1, and a child of that, at depth 1 and 2. */
  async function twoLevels(ceiling: number) {
    const setup = await workspaceWithTwoAgents();
    await setup.asAdmin.workspace.update({ maxDelegationDepth: ceiling });
    await setup.deliver({ externalId: "2", title: "Payments", parentExternalId: "1" });
    return setup;
  }

  it("routes a child at the ceiling, and refuses one past it with the reason, opening nothing", async () => {
    const { db, asAdmin, builder, deliver } = await twoLevels(1);

    await deliver({
      externalId: "3",
      title: "The card form",
      parentExternalId: "2",
      labels: ["agent:builder"],
    });

    expect((await asAdmin.runs.list({ issue: "acme/deevy#3" })).runs).toEqual([]);
    const refused = await db.query.event.findMany({ where: { kind: "delegation.refused" } });
    expect(refused).toHaveLength(1);
    expect(refused[0]?.payload).toMatchObject({
      limit: "depth",
      allowed: 1,
      to: builder.member.id,
    });
    // Routed to nobody: an assignment would be work the Agent may not start.
    expect(await db.query.event.findMany({ where: { kind: "issue.assigned" } })).toEqual([]);
    const told = await db.query.notification.findMany({
      where: { recipientMemberId: builder.member.id },
    });
    expect(told).toEqual([]);

    // One level up is within it.
    await deliver({ externalId: "2", title: "Payments", labels: ["agent:builder"] });
    expect((await asAdmin.runs.list({ issue: "acme/deevy#2" })).runs).toHaveLength(1);
  });

  it("refuses a mention on a record past it the same way, since a mention routes too", async () => {
    const { db, asAdmin, builder, deliver, comment } = await twoLevels(1);
    await deliver({ externalId: "3", title: "The card form", parentExternalId: "2" });

    await comment("3", "@builder take this one");

    expect((await asAdmin.runs.list({ issue: "acme/deevy#3" })).runs).toEqual([]);
    const refused = await db.query.event.findMany({ where: { kind: "delegation.refused" } });
    expect(refused.map((event) => event.payload)).toEqual([
      expect.objectContaining({ limit: "depth", allowed: 1, to: builder.member.id }),
    ]);
    // The comment still names the Builder, so it hears it was named.
    const told = await db.query.notification.findMany({
      where: { recipientMemberId: builder.member.id },
    });
    expect(told.map((row) => row.kind)).toEqual(["mention"]);
  });

  it("takes back a record the tracker links too deep after routing it, failing a Run not yet begun", async () => {
    // GitHub opens a record first and makes it a sub-issue after, so the Run
    // opens before deevy knows how deep the record is.
    const { db, asAdmin, builder, deliver } = await twoLevels(1);
    await deliver({ externalId: "3", title: "The card form", labels: ["agent:builder"] });
    const [opened] = (await asAdmin.runs.list({ issue: "acme/deevy#3" })).runs;
    expect(opened?.status).toBe("pending");

    await deliver({
      externalId: "3",
      title: "The card form",
      parentExternalId: "2",
      labels: ["agent:builder"],
    });
    await deliver({
      externalId: "3",
      title: "The card form, again",
      parentExternalId: "2",
      labels: ["agent:builder"],
    });

    const run = await db.query.run.findFirst({ where: { id: opened!.id } });
    expect(run?.status).toBe("failed");
    expect(run?.summary).toMatch(/1 level deep/);
    const record = await db.query.issue.findFirst({ where: { externalId: "3" } });
    expect(record?.assigneeMemberId).toBeNull();
    const assigned = await db.query.event.findMany({
      where: { kind: "issue.assigned", subjectId: record!.id },
    });
    expect(assigned.map((event) => (event.payload as { to: unknown }).to)).toEqual([
      builder.member.id,
      null,
    ]);
    // Said once, however many deliveries of it follow.
    const refused = await db.query.event.findMany({ where: { kind: "delegation.refused" } });
    expect(refused.map((event) => event.payload)).toEqual([
      expect.objectContaining({ limit: "depth", allowed: 1, to: builder.member.id }),
    ]);
  });

  it("takes back the record but leaves a Run its Agent already began", async () => {
    const { db, asAdmin, builder, deliver } = await twoLevels(1);
    await deliver({ externalId: "3", title: "The card form", labels: ["agent:builder"] });
    const [opened] = (await asAdmin.runs.list({ issue: "acme/deevy#3" })).runs;
    await clientFor(builder).runs.postActivity({
      runId: opened!.id,
      kind: "thought",
      body: "Reading the form",
    });

    await deliver({
      externalId: "3",
      title: "The card form",
      parentExternalId: "2",
      labels: ["agent:builder"],
    });

    expect((await db.query.run.findFirst({ where: { id: opened!.id } }))?.status).toBe("active");
    const record = await db.query.issue.findFirst({ where: { externalId: "3" } });
    expect(record?.assigneeMemberId).toBeNull();
    expect(await db.query.event.findMany({ where: { kind: "delegation.refused" } })).toHaveLength(
      1,
    );
  });

  it("reads the parent a delivery names, even where deevy had none for the record", async () => {
    // Linear: one update makes a record a sub-issue and labels it at once.
    const { db, asAdmin, deliver } = await twoLevels(1);
    await deliver({ externalId: "3", title: "The card form" });

    await deliver({
      externalId: "3",
      title: "The card form",
      parentExternalId: "2",
      labels: ["agent:builder"],
    });

    expect((await asAdmin.runs.list({ issue: "acme/deevy#3" })).runs).toEqual([]);
    expect(await db.query.event.findMany({ where: { kind: "delegation.refused" } })).toHaveLength(
      1,
    );
  });

  it("refuses an Agent starting a Run itself on a record past it, saying how deep is allowed", async () => {
    const { builder, deliver } = await twoLevels(1);
    await deliver({ externalId: "3", title: "The card form", parentExternalId: "2" });

    await expect(clientFor(builder).runs.start({ issue: "acme/deevy#3" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/1 level deep/),
    });
    await expect(clientFor(builder).runs.start({ issue: "acme/deevy#2" })).resolves.toMatchObject({
      trigger: "manual",
    });
  });

  it("wakes no Agent on a parent past it, when the ceiling came down after it was routed", async () => {
    const { db, admin, asAdmin, builder, deliver } = await workspaceWithTwoAgents();
    await deliver({ externalId: "2", title: "Payments", parentExternalId: "1" });
    await deliver({
      externalId: "3",
      title: "The card form",
      parentExternalId: "2",
      labels: ["agent:builder"],
    });
    await deliver({ externalId: "4", title: "The expiry field", parentExternalId: "3" });
    // The Builder did its part and split off the rest, so it has no Run open.
    const asBuilder = clientFor(builder);
    const [assigned] = (await asAdmin.runs.list({ issue: "acme/deevy#3" })).runs;
    await asBuilder.runs.postActivity({ runId: assigned!.id, kind: "thought", body: "Split it" });
    await asBuilder.runs.finish({
      runId: assigned!.id,
      status: "completed",
      summary: "Split off #4",
    });
    await asAdmin.workspace.update({ maxDelegationDepth: 1 });

    const four = await db.query.issue.findFirst({ where: { externalId: "4" } });
    await close(admin, four!);

    const runs = (await asAdmin.runs.list({ issue: "acme/deevy#3" })).runs;
    expect(runs.map((one) => one.trigger)).toEqual(["assignment"]);
    // The parts finishing is still said; who it would have woken is refused.
    expect(
      await db.query.event.findMany({ where: { kind: "issue.children_closed" } }),
    ).toHaveLength(1);
    const refused = await db.query.event.findMany({ where: { kind: "delegation.refused" } });
    expect(refused.map((event) => event.payload)).toEqual([
      expect.objectContaining({ limit: "depth", allowed: 1, to: builder.member.id }),
    ]);
  });

  it("is the one ceiling left, an admin's to change, and never nothing", async () => {
    const { asAdmin } = await workspaceWithTwoAgents();

    const updated = await asAdmin.workspace.update({ maxDelegationDepth: 5 });
    expect(updated.maxDelegationDepth).toBe(5);
    expect(updated).not.toHaveProperty("maxChildrenPerIssue");
    expect(updated).not.toHaveProperty("maxOpenDescendants");
    expect(await asAdmin.workspace.get({})).not.toHaveProperty("maxChildrenPerIssue");

    await expect(asAdmin.workspace.update({ maxDelegationDepth: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("the sub-issues finishing", () => {
  it("puts nothing in anybody's inbox, since the Run the parent wakes is the news", async () => {
    const { db, admin, child } = await workspaceWithTwoAgents();
    const one = await child("One");

    await close(admin, one);

    // The Run the parent wakes is the news.
    const told = await db.query.notification.findMany({
      where: { recipientMemberId: admin.member.id },
    });
    expect(told).toEqual([]);
  });
});
