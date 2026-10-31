import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { appendEvent } from "../src/events.ts";
import { routeIssueTo } from "../src/issues.ts";
import { router } from "../src/operations/index.ts";
import type { InboundEvent } from "../src/sockets/port.ts";
import {
  agentContext,
  fakeSockets,
  memberContext,
  seedProject,
  testDb,
  type MemberContext,
} from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function workspace(db: MemberContext["db"]) {
  const alice = await memberContext(db, { role: "admin", name: "Alice" });
  const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
  const carol = await memberContext(db, { name: "Carol", email: "carol@example.com" });
  const { sockets } = fakeSockets();
  const context = { ...alice, sockets };
  const seeded = await seedProject(db, alice.workspace.id);
  const issue = await seeded.record({ externalId: "1", title: "Ship it" });
  return {
    alice: context,
    bob,
    carol,
    project: seeded.project,
    record: seeded.record,
    deliver: seeded.deliver,
    issue,
    asAlice: createRouterClient(router, { context }),
    asBob: createRouterClient(router, { context: bob }),
    asCarol: createRouterClient(router, { context: carol }),
  };
}

/**
 * Alice saying something on the record in the tracker, as its delivery states
 * it. A tracker comment names a Member through deevy's own account
 * (`@deevy bob`), and deevy hears it only from the tool (ADR-0024).
 */
function aliceSays(issue: { externalId: string; url: string }, body: string): InboundEvent {
  return {
    kind: "comment",
    scopeKey: "acme/deevy",
    issueExternalId: issue.externalId,
    comment: {
      externalId: "c1",
      url: `${issue.url}#c1`,
      body,
      author: { login: "alice", id: "u-alice", isBot: false },
      createdAt: new Date(),
    },
  };
}

/** What a delivery does when its routing label names somebody. */
async function route(
  source: MemberContext,
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

describe("an assignment", () => {
  it("notifies the new Assignee and nobody else", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { alice, asAlice, asBob, asCarol, bob, issue } = await workspace(db);

    await route(alice, issue, bob.member.id);

    const inbox = await asBob.inbox.list({});
    expect(inbox.notifications.filter((n) => n.kind === "assignment")).toHaveLength(1);
    expect(
      (await asCarol.inbox.list({})).notifications.filter((n) => n.kind === "assignment"),
    ).toEqual([]);
    expect(
      (await asAlice.inbox.list({})).notifications.filter((n) => n.kind === "assignment"),
    ).toEqual([]);
  });

  it("says nothing when someone assigns an Issue to themselves", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { alice, asAlice, issue } = await workspace(db);

    await route(alice, issue, alice.member.id);

    expect(
      (await asAlice.inbox.list({})).notifications.filter((n) => n.kind === "assignment"),
    ).toEqual([]);
  });
});

describe("a mention", () => {
  it("notifies the mentioned Member but not the one who wrote it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAlice, asBob, deliver, issue } = await workspace(db);

    await deliver([aliceSays(issue, "over to @deevy bob")]);

    // A delivery names its author by the tool's account, not as a Member, so
    // what keeps Alice out of her own inbox is that the body does not name her.
    expect(
      (await asBob.inbox.list({})).notifications.filter((n) => n.kind === "mention"),
    ).toHaveLength(1);
    expect(
      (await asAlice.inbox.list({})).notifications.filter((n) => n.kind === "mention"),
    ).toEqual([]);
  });
});

describe("the inbox", () => {
  it("counts unread, marks read for the caller only, and pages", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { alice, asBob, asCarol, bob, issue } = await workspace(db);
    await route(alice, issue, bob.member.id);

    const before = await asBob.inbox.unreadCount({});
    expect(before.unread).toBeGreaterThan(0);
    const carolBefore = await asCarol.inbox.unreadCount({});

    const { notifications } = await asBob.inbox.list({});
    await asBob.inbox.markRead({ ids: notifications.map((n) => n.id) });

    expect((await asBob.inbox.unreadCount({})).unread).toBe(0);
    expect((await asCarol.inbox.unreadCount({})).unread).toBe(carolBefore.unread);
    expect((await asBob.inbox.list({ unreadOnly: true })).notifications).toEqual([]);
  });

  it("marks everything read at once", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asBob } = await workspace(db);

    await asBob.inbox.markAllRead({});

    expect((await asBob.inbox.unreadCount({})).unread).toBe(0);
  });

  it("never shows one Member another's Notifications", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { alice, asCarol, bob, issue } = await workspace(db);
    await route(alice, issue, bob.member.id);

    const carol = await asCarol.inbox.list({});
    expect(carol.notifications.every((n) => n.recipientMemberId !== bob.member.id)).toBe(true);
  });
});

describe("an Agent's own inbox", () => {
  async function agentWorkspace(db: MemberContext["db"]) {
    const alice = await memberContext(db, { role: "admin", name: "Alice" });
    const { sockets } = fakeSockets();
    const context = { ...alice, sockets };
    const seeded = await seedProject(db, alice.workspace.id);
    const issue = await seeded.record({ externalId: "1", title: "Ship it" });
    const planner = await agentContext(db, {
      name: "Planner",
      email: "planner@example.com",
      sponsor: alice.member,
      grants: [seeded.project.id],
    });
    return {
      alice: context,
      asAlice: createRouterClient(router, { context }),
      record: seeded.record,
      issue,
      planner,
      asPlanner: createRouterClient(router, { context: planner }),
    };
  }

  it("clears the Notifications it has taken up, so the next pass finds new work", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { alice, record, issue, planner, asPlanner } = await agentWorkspace(db);
    const second = await record({ externalId: "2", title: "Two" });
    await route(alice, issue, planner.member.id);
    await route(alice, second, planner.member.id);

    const waiting = await asPlanner.inbox.list({ unreadOnly: true });
    expect(waiting.notifications.map((n) => n.kind)).toEqual(["assignment", "assignment"]);
    const read = await asPlanner.inbox.markRead({ ids: waiting.notifications.map((n) => n.id) });

    expect(read.read).toBe(2);
    expect((await asPlanner.inbox.list({ unreadOnly: true })).notifications).toEqual([]);
    expect((await asPlanner.inbox.list({})).notifications).toHaveLength(2);
  });

  it("cannot read another Member's inbox by naming their ids", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { alice, record, issue, planner, asPlanner } = await agentWorkspace(db);
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    const asBob = createRouterClient(router, { context: bob });
    const second = await record({ externalId: "2", title: "Two" });
    await route(alice, issue, bob.member.id);
    await route(alice, second, planner.member.id);
    const bobs = await asBob.inbox.list({ unreadOnly: true });

    const read = await asPlanner.inbox.markRead({ ids: bobs.notifications.map((n) => n.id) });

    expect(read.read).toBe(0);
    expect((await asBob.inbox.list({ unreadOnly: true })).notifications).toHaveLength(
      bobs.notifications.length,
    );
    expect((await asPlanner.inbox.list({ unreadOnly: true })).notifications).toHaveLength(1);
  });

  it("is refused once its Sponsor has suspended it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { alice, asAlice, issue, planner, asPlanner } = await agentWorkspace(db);
    await route(alice, issue, planner.member.id);
    const waiting = await asPlanner.inbox.list({ unreadOnly: true });

    await asAlice.agents.suspend({ memberId: planner.member.id });
    const suspended = (await db.query.member.findFirst({
      where: { id: planner.member.id },
    })) as MemberContext["member"];

    await expect(
      createRouterClient(router, { context: { ...planner, member: suspended } }).inbox.markRead({
        ids: waiting.notifications.map((n) => n.id),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await asPlanner.inbox.list({ unreadOnly: true })).notifications).toHaveLength(1);
  });
});

describe("what a Notification carries", () => {
  it("names who did it and quotes the comment a mention came from", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { alice, asBob, bob, deliver, issue } = await workspace(db);
    await deliver([aliceSays(issue, "Look at this, @deevy bob")]);
    await route(alice, issue, bob.member.id);

    const rows = (await asBob.inbox.list({})).notifications;
    const mention = rows.find((row) => row.kind === "mention");
    // Alice wrote this in the tracker and deevy heard it from the tool, so the
    // Event names no Member as its actor; what she wrote is still quoted.
    expect(mention?.actor).toBeNull();
    expect(mention?.comment?.body).toBe("Look at this, @deevy bob");
    const assignment = rows.find((row) => row.kind === "assignment");
    expect(assignment?.actor?.user.name).toBe("Alice");
    expect(assignment?.comment).toBeNull();
  });
});
