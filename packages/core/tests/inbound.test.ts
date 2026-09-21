import type { Db, Socket } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { applyInbound } from "../src/sockets/apply.ts";
import type { InboundEvent } from "../src/sockets/port.ts";
import { agentContext, externalIssue, memberContext, seedProject, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * What a tracker saying something does inside deevy (ADR-0024).
 *
 * `applyInbound` is the one place a record from outside becomes an Issue, a
 * routed Agent and a Run, and the poll reuses it, so every rule about
 * projection, ordering, routing and the loop guard is proved here once and
 * against the provider's own fixtures later.
 */
async function workspace(db: Db) {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const seeded = await seedProject(db, ada.workspace.id);
  const planner = await agentContext(db, {
    name: "Planner",
    handle: "planner",
    email: "planner@example.com",
    sponsor: ada.member,
    grants: [seeded.project.id],
  });
  const socket = (await db.query.socket.findFirst({ where: { id: seeded.socketId } })) as Socket;
  return {
    ada,
    planner,
    seeded,
    socket,
    asAda: createRouterClient(router, { context: ada }),
    asPlanner: createRouterClient(router, { context: planner }),
    apply: (events: InboundEvent[]) =>
      applyInbound({ db, workspace: ada.workspace, socket, events }),
  };
}

/** One record, as a tracker states it in a delivery. */
function record(over: Parameters<typeof externalIssue>[0]): InboundEvent {
  return {
    kind: "issue",
    scopeKey: "acme/deevy",
    issue: externalIssue(over),
    actor: { login: "ada-on-github", id: "gh-1", isBot: false },
  };
}

describe("a record arriving from a tracker", () => {
  it("is projected, and the routing label opens exactly one Run for the Agent it names", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { apply, asPlanner, planner, seeded } = await workspace(db);

    const result = await apply([
      record({ externalId: "42", title: "Checkout rewrite", labels: ["bug", "agent:planner"] }),
    ]);

    expect(result.applied).toBe(1);
    const issue = await db.query.issue.findFirst({ where: { externalId: "42" } });
    expect(issue).toMatchObject({
      title: "Checkout rewrite",
      externalKey: "acme/deevy#42",
      projectId: seeded.project.id,
      assigneeMemberId: planner.member.id,
    });

    const runs = await asPlanner.runs.list({});
    expect(runs.runs).toHaveLength(1);
    expect(runs.runs[0]).toMatchObject({ trigger: "assignment", status: "pending" });
    const inbox = await asPlanner.inbox.list({ unreadOnly: true });
    expect(inbox.notifications.map((row) => row.kind)).toEqual(["assignment"]);
  });

  it("gives a record nobody named to the Project's default Agent, and a closed one to nobody", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const seeded = await seedProject(db, ada.workspace.id);
    const planner = await agentContext(db, {
      name: "Planner",
      handle: "planner",
      email: "planner@example.com",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    await seeded.setDefaultAgent(planner.member.id);
    const socket = (await db.query.socket.findFirst({ where: { id: seeded.socketId } })) as Socket;
    const apply = (events: InboundEvent[]) =>
      applyInbound({ db, workspace: ada.workspace, socket, events });

    await apply([record({ externalId: "1", title: "Nobody named me" })]);
    await apply([record({ externalId: "2", title: "Already done", state: "closed" })]);

    const open = await db.query.issue.findFirst({ where: { externalId: "1" } });
    const closed = await db.query.issue.findFirst({ where: { externalId: "2" } });
    expect(open?.assigneeMemberId).toBe(planner.member.id);
    expect(closed?.assigneeMemberId).toBeNull();
  });

  it("never lets an older delivery overwrite what a newer one already said", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { apply } = await workspace(db);

    const newer = new Date("2026-09-21T12:00:00Z");
    const older = new Date("2026-09-21T09:00:00Z");
    await apply([record({ externalId: "7", title: "The newer title", updatedAt: newer })]);
    const result = await apply([
      record({ externalId: "7", title: "The older title", updatedAt: older }),
    ]);

    const issue = await db.query.issue.findFirst({ where: { externalId: "7" } });
    expect(issue?.title).toBe("The newer title");
    expect(result.skipped).toHaveLength(1);
  });

  it("says which container it could not place, rather than failing the delivery", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { apply } = await workspace(db);

    const result = await apply([
      { ...record({ externalId: "1" }), scopeKey: "acme/nothing" } as InboundEvent,
    ]);

    expect(result.applied).toBe(0);
    expect(result.skipped[0]).toContain("acme/nothing");
    expect(await db.query.issue.findFirst({})).toBeUndefined();
  });

  it("appends what changed, and says when the tracker closed it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { apply } = await workspace(db);

    const first = new Date("2026-09-21T09:00:00Z");
    await apply([record({ externalId: "5", title: "First", updatedAt: first })]);
    await apply([
      record({
        externalId: "5",
        title: "Renamed",
        labels: ["needs-design"],
        state: "closed",
        updatedAt: new Date("2026-09-21T10:00:00Z"),
      }),
    ]);

    const events = await db.query.event.findMany({ orderBy: { seq: "asc" } });
    const kinds = events.map((event) => event.kind);
    expect(kinds).toContain("issue.created");
    expect(kinds).toContain("issue.synced");
    expect(kinds).toContain("issue.closed");
    const synced = events.find((event) => event.kind === "issue.synced");
    expect(synced?.payload).toMatchObject({ changed: ["title", "labels", "state"] });
    // Nobody in deevy did this, and the payload says who did it where.
    expect(synced?.actorMemberId).toBeNull();
    expect(synced?.payload).toMatchObject({ externalActor: "ada-on-github" });
  });
});

describe("a comment arriving from a tracker", () => {
  function comment(body: string, author: { login: string; id: string; isBot: boolean }) {
    return {
      kind: "comment" as const,
      scopeKey: "acme/deevy",
      issueExternalId: "42",
      comment: {
        externalId: "c1",
        url: "https://tracker.test/acme/deevy#42-c1",
        body,
        author,
        createdAt: new Date(),
      },
    };
  }

  it("drops deevy's own, and opens a Run for the Agent another Human mentions", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { apply, asPlanner, socket } = await workspace(db);
    await apply([record({ externalId: "42", title: "Checkout rewrite" })]);

    const own = await apply([
      comment("Asking @planner about this", { ...socket.identity, isBot: true }),
    ]);
    expect(own.applied).toBe(0);
    expect((await asPlanner.runs.list({})).runs).toEqual([]);

    const theirs = await apply([
      comment("Over to you @planner", { login: "ada-on-github", id: "gh-1", isBot: false }),
    ]);

    expect(theirs.applied).toBe(1);
    const runs = await asPlanner.runs.list({});
    expect(runs.runs).toHaveLength(1);
    expect(runs.runs[0]?.trigger).toBe("mention");
  });

  it("reads the Socket's own handle as a way to name an Agent", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { apply, asPlanner } = await workspace(db);
    await apply([record({ externalId: "42", title: "Checkout rewrite" })]);

    // A tracker where deevy is one account: "@deevy planner" is how a Human
    // names which Agent, because the App itself is the only mentionable one.
    await apply([
      comment("@deevy planner take this one", {
        login: "ada-on-github",
        id: "gh-1",
        isBot: false,
      }),
    ]);

    expect((await asPlanner.runs.list({})).runs).toHaveLength(1);
  });

  it("says nothing about a record it has never seen", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { apply } = await workspace(db);

    const result = await apply([
      comment("Anyone?", { login: "ada-on-github", id: "gh-1", isBot: false }),
    ]);

    expect(result.applied).toBe(0);
    expect(result.skipped[0]).toContain("42");
  });
});

describe("what else a delivery can carry", () => {
  it("keeps an installation on the Socket and says so in the log", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { apply, socket } = await workspace(db);

    const result = await apply([
      { kind: "installation", installations: [{ id: "i-1", account: "acme" }] },
    ]);

    expect(result.applied).toBe(1);
    const row = await db.query.socket.findFirst({ where: { id: socket.id } });
    expect(row?.config).toMatchObject({ installations: [{ id: "i-1", account: "acme" }] });
    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds).toContain("socket.installation_added");
  });

  it("carries the provider's own reason for a delivery that means nothing", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { apply } = await workspace(db);

    const result = await apply([{ kind: "ignored", why: "a ping" }]);

    expect(result).toMatchObject({ applied: 0, skipped: ["a ping"] });
  });
});
