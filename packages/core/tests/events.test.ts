import { user, workspace } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { bootstrapWorkspace } from "../src/auth.ts";
import { appendEvent } from "../src/events.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, contextFor, fakeSockets, memberContext, testDb } from "./helpers.ts";
import { newId } from "../src/ids.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("appendEvent", () => {
  it("records the Event with the caller as actor, and a seq that rises", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db);

    const created = await appendEvent(context, {
      kind: "workspace.created",
      subjectType: "workspace",
      subjectId: context.workspace.id,
    });
    const joined = await appendEvent(context, {
      kind: "member.joined",
      subjectType: "member",
      subjectId: context.member.id,
      payload: { role: "admin" },
    });

    expect(created).toMatchObject({
      workspaceId: context.workspace.id,
      actorMemberId: context.member.id,
      kind: "workspace.created",
      subjectType: "workspace",
      subjectId: context.workspace.id,
      projectId: null,
    });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(joined.payload).toEqual({ role: "admin" });
    expect(joined.seq).toBeGreaterThan(created.seq);
  });
});

describe("events.list", () => {
  it("returns the Workspace's Events in seq order, with the last seq as the cursor", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db);
    await appendEvent(context, {
      kind: "workspace.created",
      subjectType: "workspace",
      subjectId: context.workspace.id,
    });
    const joined = await appendEvent(context, {
      kind: "member.joined",
      subjectType: "member",
      subjectId: context.member.id,
    });

    const client = createRouterClient(router, { context });
    const page = await client.events.list({});

    expect(page.events.map((e) => e.kind)).toEqual(["workspace.created", "member.joined"]);
    expect(page.events[1]).toMatchObject({ actorMemberId: context.member.id });
    expect(page.nextCursor).toBe(joined.seq);
  });
});

describe("events.list from a cursor", () => {
  it("returns only the Events after the given seq", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db);
    const created = await appendEvent(context, {
      kind: "workspace.created",
      subjectType: "workspace",
      subjectId: context.workspace.id,
    });
    await appendEvent(context, {
      kind: "member.joined",
      subjectType: "member",
      subjectId: context.member.id,
    });

    const client = createRouterClient(router, { context });
    const page = await client.events.list({ after: created.seq });

    expect(page.events.map((e) => e.kind)).toEqual(["member.joined"]);
    expect(await client.events.list({ after: page.nextCursor ?? 0 })).toMatchObject({
      events: [],
      nextCursor: null,
    });
  });
});

describe("events.list newest first", () => {
  it("orders by seq descending on request and pages back with before", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db, { role: "admin" });
    const client = createRouterClient(router, { context });
    for (const kind of ["workspace.created", "member.joined", "issue.created"] as const) {
      await appendEvent(context, {
        kind,
        subjectType: "workspace",
        subjectId: context.workspace.id,
      });
    }

    const newest = await client.events.list({ order: "desc", limit: 2 });
    expect(newest.events.map((event) => event.kind)).toEqual(["issue.created", "member.joined"]);
    const older = await client.events.list({ order: "desc", before: newest.nextCursor ?? 0 });
    expect(older.events.map((event) => event.kind)).toEqual(["workspace.created"]);
    expect(older.nextCursor).toBe(older.events[0]?.seq ?? null);
  });
});

describe("events.list before a seq", () => {
  it("pages toward the start when no order is given, with a cursor that falls", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db, { role: "admin" });
    const client = createRouterClient(router, { context });
    const kinds = [
      "workspace.created",
      "member.joined",
      "project.created",
      "issue.created",
    ] as const;
    for (const kind of kinds) {
      await appendEvent(context, {
        kind,
        subjectType: "workspace",
        subjectId: context.workspace.id,
      });
    }
    const newest = await client.events.list({ order: "desc", limit: 1 });
    const top = newest.nextCursor ?? 0;

    // `before` alone reads as a page turned back: without this, the default
    // `asc` handed back the oldest Events with a cursor pointing forward, and
    // everything between was unreachable.
    const back = await client.events.list({ before: top, limit: 2 });
    expect(back.events.map((event) => event.kind)).toEqual(["project.created", "member.joined"]);
    expect(back.nextCursor).toBeLessThan(top);
    const further = await client.events.list({ before: back.nextCursor ?? 0, limit: 2 });
    expect(further.events.map((event) => event.kind)).toEqual(["workspace.created"]);
    expect(further.nextCursor).toBeLessThan(back.nextCursor ?? 0);
    // Said outright, `asc` still wins: a window read between two seqs.
    const window = await client.events.list({ after: 0, before: top, order: "asc", limit: 2 });
    expect(window.events.map((event) => event.kind)).toEqual([
      "workspace.created",
      "member.joined",
    ]);
  });
});

describe("events.list by kind family", () => {
  it("returns only the kinds under the prefix", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const alice = await memberContext(db, { role: "admin", name: "Alice" });
    const { sockets } = fakeSockets();
    const client = createRouterClient(router, { context: { ...alice, sockets } });
    const socket = await client.sockets.connect({ provider: "stub", name: "Example tracker" });
    await client.projects.create({
      slug: "deevy",
      name: "deevy",
      tracker: { socketId: socket.id, scope: { scopeKey: "acme/deevy" } },
    });
    await client.issues.create({ projectSlug: "deevy", title: "Ship it" });

    const connected = await client.events.list({ kindPrefix: "socket" });
    expect(connected.events.map((event) => event.kind)).toEqual(["socket.connected"]);
    const issues = await client.events.list({ kindPrefix: "issue" });
    expect(issues.events.length).toBeGreaterThan(0);
    expect(issues.events.every((event) => event.kind.startsWith("issue."))).toBe(true);
    // A family, not a free-text prefix: `socket.conn` would need escaping and
    // is refused.
    await expect(client.events.list({ kindPrefix: "socket.conn" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await client.events.list({ kindPrefix: "nothing" })).events).toEqual([]);
  });
});

describe("events.list actors", () => {
  it("carries who did each Event, and null for what deevy did itself", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db, { name: "Ada" });
    await appendEvent(
      { db, workspace: context.workspace, member: null },
      { kind: "workspace.created", subjectType: "workspace", subjectId: context.workspace.id },
    );
    await appendEvent(context, {
      kind: "member.joined",
      subjectType: "member",
      subjectId: context.member.id,
    });

    const client = createRouterClient(router, { context });
    const page = await client.events.list({});

    expect(page.events.map((e) => [e.kind, e.actor?.user.name ?? null])).toEqual([
      ["workspace.created", null],
      ["member.joined", "Ada"],
    ]);
    expect(page.events[1]?.actor).toMatchObject({ id: context.member.id, kind: "human" });
  });
});

describe("events.list scoping", () => {
  it("never returns Events belonging to another Workspace", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db);
    const other = newId("workspace");
    await db.insert(workspace).values({ id: other, name: "other", slug: "other" });
    await appendEvent(
      { db, workspace: { id: other }, member: null },
      {
        kind: "workspace.created",
        subjectType: "workspace",
        subjectId: other,
      },
    );
    await appendEvent(context, {
      kind: "member.joined",
      subjectType: "member",
      subjectId: context.member.id,
    });

    const client = createRouterClient(router, { context });
    const page = await client.events.list({});

    expect(page.events.map((e) => e.kind)).toEqual(["member.joined"]);
  });

  it("filters by subject", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db);
    await appendEvent(context, {
      kind: "workspace.created",
      subjectType: "workspace",
      subjectId: context.workspace.id,
    });
    await appendEvent(context, {
      kind: "member.joined",
      subjectType: "member",
      subjectId: context.member.id,
    });

    const client = createRouterClient(router, { context });
    const page = await client.events.list({
      subjectType: "member",
      subjectId: context.member.id,
    });

    expect(page.events.map((e) => e.kind)).toEqual(["member.joined"]);
  });
});

describe("the Event log after bootstrap", () => {
  it("records workspace.created then member.joined, with no actor", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await db.insert(user).values({ id: "u1", name: "Ada", email: "ada@example.com" });
    await bootstrapWorkspace(
      db,
      { userId: "u1", email: "ada@example.com" },
      {
        adminEmail: "ada@example.com",
        workspaceName: "Acme Team",
      },
    );

    const ws = await db.query.workspace.findFirst({ with: { members: true } });
    const admin = ws?.members[0];
    if (!ws || !admin) throw new Error("bootstrap left no Workspace or Member");

    const client = createRouterClient(router, { context: contextFor(db, admin, ws) });
    const page = await client.events.list({});

    expect(page.events.map((e) => e.kind)).toEqual(["workspace.created", "member.joined"]);
    expect(page.events.map((e) => e.actorMemberId)).toEqual([null, null]);
    expect(page.events.map((e) => e.subjectId)).toEqual([ws.id, admin.id]);
  });

  it("records only member.joined when the Workspace already exists", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await db.insert(user).values({ id: "u1", name: "Ada", email: "ada@example.com" });
    await db.insert(workspace).values({ id: "w1", name: "deevy", slug: "deevy" });
    await bootstrapWorkspace(
      db,
      { userId: "u1", email: "ada@example.com" },
      {
        adminEmail: "ada@example.com",
      },
    );

    const ws = await db.query.workspace.findFirst({ with: { members: true } });
    const admin = ws?.members[0];
    if (!ws || !admin) throw new Error("bootstrap left no Member");

    const client = createRouterClient(router, { context: contextFor(db, admin, ws) });
    expect((await client.events.list({})).events.map((e) => e.kind)).toEqual(["member.joined"]);
  });
});

describe("events.list access", () => {
  it("refuses an anonymous caller", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const client = createRouterClient(router, {
      context: { db, session: null, member: null, workspace: null },
    });
    await expect(client.events.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("self-describing payloads", () => {
  it("carries names and keys beside ids for the Agent routed to and the parent", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const alice = await memberContext(db, { role: "admin", name: "Alice" });
    const { sockets } = fakeSockets();
    const asAlice = createRouterClient(router, { context: { ...alice, sockets } });
    const socket = await asAlice.sockets.connect({ provider: "stub", name: "Example tracker" });
    const project = await asAlice.projects.create({
      slug: "deevy",
      name: "deevy",
      tracker: { socketId: socket.id, scope: { scopeKey: "acme/deevy" } },
    });
    const planner = await agentContext(db, {
      sponsor: alice.member,
      name: "Planner",
      grants: [project.id],
    });
    const parent = await asAlice.issues.create({ projectSlug: "deevy", title: "Parent" });
    const child = await asAlice.issues.create({
      parent: parent.externalKey,
      title: "Child",
      assignAgent: planner.member.id,
    });

    const { events } = await asAlice.events.list({ subjectType: "issue", subjectId: child.id });
    const payloads = events.map((event) => [event.kind, event.payload] as const);
    // A reader of the log should not have to resolve an id to know what
    // happened, so the key and the name travel with them.
    expect(payloads).toContainEqual([
      "issue.created",
      expect.objectContaining({ key: child.externalKey, parentKey: parent.externalKey }),
    ]);
    expect(payloads).toContainEqual([
      "issue.assigned",
      expect.objectContaining({ from: null, toName: "Planner" }),
    ]);
  });
});
