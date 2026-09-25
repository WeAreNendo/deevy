import type { Db, Socket } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { applyInbound } from "../src/sockets/apply.ts";
import type { InboundEvent } from "../src/sockets/port.ts";
import {
  agentContext,
  externalIssue,
  fakeSockets,
  memberContext,
  seedProject,
  testDb,
} from "./helpers.ts";

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

  it("hands a record delegated to deevy itself to the default Agent, even one routed elsewhere", async () => {
    // Linear's "assign to an app" makes the app the record's delegate and
    // leaves the Human its assignee: saying "deevy, take this" in the tracker's
    // own words, which is the default Agent's to answer (ADR-0024).
    const { db, close } = testDb();
    closers.push(close);
    const { ada, apply, planner, seeded } = await workspace(db);
    const builder = await agentContext(db, {
      name: "Builder",
      handle: "builder",
      email: "builder@example.com",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    await seeded.setDefaultAgent(planner.member.id);
    const first = new Date("2026-09-24T09:00:00Z");
    const later = new Date("2026-09-24T10:00:00Z");
    await apply([record({ externalId: "9", labels: ["agent:builder"], updatedAt: first })]);

    // Delegated to somebody else's app, it stays where the label put it.
    await apply([record({ externalId: "9", delegateId: "another-app", updatedAt: first })]);
    const kept = await db.query.issue.findFirst({ where: { externalId: "9" } });
    expect(kept?.assigneeMemberId).toBe(builder.member.id);

    // The Socket's own identity is `bot-1` (helpers.ts).
    await apply([record({ externalId: "9", delegateId: "bot-1", updatedAt: later })]);
    const moved = await db.query.issue.findFirst({ where: { externalId: "9" } });
    expect(moved?.assigneeMemberId).toBe(planner.member.id);
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

  it("takes nothing more for a Project an admin archived, and says so", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { apply, asAda, asPlanner, seeded } = await workspace(db);
    await asAda.projects.archive({ slug: seeded.project.slug });

    // Polling already passes an archived Project by; a delivery went on
    // projecting and routing its records, so an archived Project kept
    // starting Runs.
    const result = await apply([record({ externalId: "42", labels: ["agent:planner"] })]);

    expect(result.applied).toBe(0);
    expect(result.skipped[0]).toMatch(/archived/);
    expect(await db.query.issue.findFirst({})).toBeUndefined();
    expect((await asPlanner.runs.list({})).runs).toEqual([]);
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

/**
 * A tracker whose deliveries say only what changed — Notion's name a page or a
 * comment and carry none of it — is read back through the Project's binding,
 * and what it answers is applied exactly as a delivery that said it would be.
 */
describe("a delivery that names what changed and says nothing else", () => {
  async function reading(db: Parameters<typeof workspace>[0]) {
    const ready = await workspace(db);
    const fake = fakeSockets();
    const module = fake.sockets.stub?.({
      config: {},
      credentials: {},
      fetch: globalThis.fetch,
      now: () => new Date(),
    });
    if (!module?.tracker) throw new Error("the fake is a tracker");
    const tracker = module.tracker;
    return {
      ...ready,
      fake,
      read: (events: InboundEvent[]) =>
        applyInbound({ db, workspace: ready.ada.workspace, socket: ready.socket, events, tracker }),
    };
  }

  it("is read back, projected and routed as though the tracker had said it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { read, fake, planner } = await reading(db);
    fake.records.set("77", externalIssue({ externalId: "77", labels: ["agent:planner"] }));

    const result = await read([
      { kind: "changed", scopeKey: "acme/deevy", issueExternalId: "77", actor: null },
    ]);

    expect(result.applied).toBe(1);
    expect(await db.query.issue.findFirst({ where: { externalId: "77" } })).toMatchObject({
      assigneeMemberId: planner.member.id,
    });
  });

  it("reads a comment back, and treats it as the comment it is", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { apply, read, fake, asPlanner } = await reading(db);
    await apply([record({ externalId: "42", title: "Checkout rewrite" })]);
    fake.remarks.set("c9", {
      externalId: "c9",
      url: "https://tracker.test/acme/deevy#42",
      body: "Over to you @planner",
      author: { login: "Ada", id: "person-1", isBot: false },
      createdAt: new Date(),
    });

    const result = await read([
      { kind: "commented", issueExternalId: "42", commentExternalId: "c9" },
    ]);

    expect(result.applied).toBe(1);
    expect((await asPlanner.runs.list({})).runs[0]?.trigger).toBe("mention");
  });

  it("says why when it cannot read one back", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { apply, read } = await reading(db);
    await apply([record({ externalId: "42" })]);

    const gone = await read([
      { kind: "commented", issueExternalId: "42", commentExternalId: "nowhere" },
    ]);
    const unbound = await read([
      { kind: "changed", scopeKey: "acme/nothing", issueExternalId: "77", actor: null },
    ]);
    // And with nothing to read it with, it says so rather than guessing.
    const blind = await apply([
      { kind: "changed", scopeKey: "acme/deevy", issueExternalId: "42", actor: null },
    ]);

    expect(gone.skipped[0]).toContain("nowhere");
    expect(unbound.skipped[0]).toContain("acme/nothing");
    expect(blind.skipped[0]).toContain("read");
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
