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

/**
 * Alice, a Human admin, and two Agents she sponsors: an inbox is an Agent's
 * own (docs/plans/simplify.md, slice 8), so these are who has one.
 */
async function workspace(db: MemberContext["db"]) {
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
  const coder = await agentContext(db, {
    name: "Coder",
    email: "coder@example.com",
    sponsor: alice.member,
    grants: [seeded.project.id],
  });
  return {
    alice: context,
    planner,
    coder,
    record: seeded.record,
    deliver: seeded.deliver,
    issue,
    asAlice: createRouterClient(router, { context }),
    asPlanner: createRouterClient(router, { context: planner }),
    asCoder: createRouterClient(router, { context: coder }),
  };
}

/**
 * Alice saying something on the record in the tracker, as its delivery states
 * it. A tracker comment names a Member through deevy's own account
 * (`@deevy planner`), and deevy hears it only from the tool (ADR-0024).
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
  it("tells the Agent it was routed to and nobody else", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { alice, asPlanner, asCoder, planner, issue } = await workspace(db);

    await route(alice, issue, planner.member.id);

    const inbox = await asPlanner.inbox.list({});
    expect(inbox.notifications.filter((n) => n.kind === "assignment")).toHaveLength(1);
    expect((await asCoder.inbox.list({})).notifications).toEqual([]);
  });

  it("tells a Human nothing, even routed to them", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { alice, issue } = await workspace(db);
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });

    await route(alice, issue, bob.member.id);

    expect(await db.query.notification.findMany()).toEqual([]);
  });
});

describe("a mention", () => {
  it("tells the Agent it names", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, asCoder, deliver, issue } = await workspace(db);

    await deliver([aliceSays(issue, "over to @deevy planner")]);

    expect(
      (await asPlanner.inbox.list({})).notifications.filter((n) => n.kind === "mention"),
    ).toHaveLength(1);
    expect((await asCoder.inbox.list({})).notifications).toEqual([]);
  });
});

describe("an Agent's own inbox", () => {
  it("clears the Notifications it has taken up, so the next pass finds new work", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { alice, record, issue, planner, asPlanner } = await workspace(db);
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

  it("cannot read or clear another Agent's by naming their ids", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { alice, record, issue, planner, coder, asPlanner, asCoder } = await workspace(db);
    const second = await record({ externalId: "2", title: "Two" });
    await route(alice, issue, coder.member.id);
    await route(alice, second, planner.member.id);
    const coders = await asCoder.inbox.list({ unreadOnly: true });

    const read = await asPlanner.inbox.markRead({ ids: coders.notifications.map((n) => n.id) });

    expect(read.read).toBe(0);
    expect((await asCoder.inbox.list({ unreadOnly: true })).notifications).toHaveLength(1);
    const planners = (await asPlanner.inbox.list({})).notifications;
    expect(planners.every((n) => n.recipientMemberId === planner.member.id)).toBe(true);
  });

  it("is refused once its Sponsor has suspended it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { alice, asAlice, issue, planner, asPlanner } = await workspace(db);
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
    const { alice, asPlanner, planner, deliver, issue } = await workspace(db);
    await deliver([aliceSays(issue, "Look at this, @deevy planner")]);
    await route(alice, issue, planner.member.id);

    const rows = (await asPlanner.inbox.list({})).notifications;
    const mention = rows.find((row) => row.kind === "mention");
    // Alice wrote this in the tracker and deevy heard it from the tool, so the
    // Event names no Member as its actor; what she wrote is still quoted.
    expect(mention?.actor).toBeNull();
    expect(mention?.comment?.body).toBe("Look at this, @deevy planner");
    const assignment = rows.find((row) => row.kind === "assignment");
    expect(assignment?.actor?.user.name).toBe("Alice");
    expect(assignment?.comment).toBeNull();
  });
});
