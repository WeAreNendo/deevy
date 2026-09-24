import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { routeIssueTo } from "../src/issues.ts";
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
 * An admin, a Socket and a Project bound to a container: the arrangement every
 * Issue test starts from, because an Issue is a projection of a record in one
 * and there is no other way to have an Issue (ADR-0024).
 */
async function withProject(db: MemberContext["db"], options: { scopeKey?: string } = {}) {
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const seeded = await seedProject(db, admin.workspace.id, options);
  const { sockets } = fakeSockets();
  const context = { ...admin, sockets };
  return { admin: context, client: createRouterClient(router, { context }), ...seeded };
}

describe("a projection", () => {
  it("is readable by its URL, by the tracker's key, and by its id", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, record } = await withProject(db);

    const projected = await record({ externalId: "42", title: "Ship the Event log" });

    // The three handles a caller may know it by, and the one row behind them.
    const byUrl = await client.issues.get({ issue: projected.url });
    const byKey = await client.issues.get({ issue: projected.externalKey });
    const byId = await client.issues.get({ issue: projected.id });

    expect(byUrl.id).toBe(projected.id);
    expect(byKey.id).toBe(projected.id);
    expect(byId.id).toBe(projected.id);
    expect(byUrl).toMatchObject({
      externalKey: "acme/deevy#42",
      title: "Ship the Event log",
      state: "open",
      assigneeMemberId: null,
      parentId: null,
      closedAt: null,
    });
  });

  it("says what the tracker last said, and refuses to go backwards on it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, record } = await withProject(db);

    const at = new Date("2026-09-20T10:00:00Z");
    const first = await record({ externalId: "1", title: "First words", updatedAt: at });
    // A delivery that arrives late and says something older. Providers reorder,
    // so the provider's own clock decides rather than the order of arrival.
    await record({
      externalId: "1",
      title: "Stale words",
      updatedAt: new Date(at.getTime() - 60_000),
    });

    expect((await client.issues.get({ issue: first.url })).title).toBe("First words");

    await record({
      externalId: "1",
      title: "Newer words",
      updatedAt: new Date(at.getTime() + 60_000),
    });
    expect((await client.issues.get({ issue: first.url })).title).toBe("Newer words");
  });

  it("closes and reopens with the record, so open stays one question", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, record } = await withProject(db);

    const issue = await record({ externalId: "1", updatedAt: new Date("2026-09-20T10:00:00Z") });
    expect((await client.issues.get({ issue: issue.url })).closedAt).toBeNull();

    await record({
      externalId: "1",
      state: "closed",
      stateName: "Done",
      updatedAt: new Date("2026-09-20T11:00:00Z"),
    });
    const closed = await client.issues.get({ issue: issue.url });
    expect(closed.state).toBe("closed");
    expect(closed.stateName).toBe("Done");
    expect(closed.closedAt).not.toBeNull();
  });

  it("reports a handle nothing here knows as not found", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await withProject(db);

    await expect(client.issues.get({ issue: "acme/deevy#404" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      client.issues.get({ issue: "https://tracker.test/nothing#1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a key two Sockets both know, rather than picking one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const one = await seedProject(db, admin.workspace.id, { slug: "one", scopeKey: "acme/deevy" });
    const two = await seedProject(db, admin.workspace.id, { slug: "two", scopeKey: "acme/deevy" });
    const client = createRouterClient(router, { context: admin });

    // github.com and a GitHub Enterprise with the same organisation name: one
    // key, two records. Picking one silently is how an Agent works somebody
    // else's record, so the refusal names the way out.
    await one.record({
      externalId: "1",
      key: "acme/deevy#1",
      url: "https://one.test/acme/deevy/1",
    });
    await two.record({
      externalId: "1",
      key: "acme/deevy#1",
      url: "https://two.test/acme/deevy/1",
    });

    await expect(client.issues.get({ issue: "acme/deevy#1" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // The URL is canonical, and it is unambiguous by construction.
    const byUrl = await client.issues.get({ issue: "https://two.test/acme/deevy/1" });
    expect(byUrl.externalKey).toBe("acme/deevy#1");
  });
});

describe("issues.create", () => {
  it("opens the record in the tracker and projects what came back", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client, project } = await withProject(db);

    const issue = await client.issues.create({
      projectSlug: project.slug,
      title: "Ship the Event log",
    });

    expect(issue).toMatchObject({
      externalKey: "acme/deevy#new-1",
      title: "Ship the Event log",
      state: "open",
      createdBy: admin.member.id,
      parentId: null,
    });
    expect(issue.url).toBe("https://tracker.test/acme/deevy#new-1");
    expect(issue.projectId).toBe(project.id);
  });

  it("records issue.created against the Project, carrying the tracker's handles", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client, project } = await withProject(db);

    const issue = await client.issues.create({ projectSlug: project.slug, title: "Ship it" });
    const { events } = await client.events.list({});
    const created = events.find((event) => event.kind === "issue.created");

    expect(created).toMatchObject({
      subjectType: "issue",
      subjectId: issue.id,
      projectId: project.id,
      actorMemberId: admin.member.id,
    });
    expect(created?.payload).toMatchObject({ key: issue.externalKey, url: issue.url });
  });

  it("needs a Project when there is no parent to take one from", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await withProject(db);

    await expect(client.issues.create({ title: "Nowhere" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("names the Agent it is for with the Project's routing label", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client, project } = await withProject(db);
    const planner = await agentContext(db, {
      name: "Planner",
      sponsor: admin.member,
      grants: [project.id],
    });

    const issue = await client.issues.create({
      projectSlug: project.slug,
      title: "Cut the work up",
      assignAgent: planner.member.id,
    });

    // The tracker says who the work is for, in the words deevy's own routing
    // reads back: a label, exactly as a Human would write one.
    expect(issue.labels).toContain(`agent:${planner.member.handle ?? ""}`);
    expect(issue.assigneeMemberId).toBe(planner.member.id);
  });

  it("refuses to name a Human with a routing label", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, project } = await withProject(db);
    const grace = await memberContext(db, { name: "Grace" });

    await expect(
      client.issues.create({
        projectSlug: project.slug,
        title: "For a person",
        assignAgent: grace.member.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("issues.list", () => {
  it("reads as a feed, newest change first, and pages by cursor", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, record } = await withProject(db);

    for (const n of [1, 2, 3]) {
      await record({
        externalId: String(n),
        title: `Record ${String(n)}`,
        updatedAt: new Date(`2026-09-2${String(n)}T10:00:00Z`),
      });
    }

    const first = await client.issues.list({ limit: 2 });
    expect(first.issues.map((issue) => issue.externalKey)).toEqual([
      "acme/deevy#3",
      "acme/deevy#2",
    ]);
    expect(first.hasMore).toBe(true);

    const next = await client.issues.list({ limit: 2, cursor: first.nextCursor ?? "" });
    expect(next.issues.map((issue) => issue.externalKey)).toEqual(["acme/deevy#1"]);
    expect(next.hasMore).toBe(false);
  });

  it("finds a record by the tracker's key or by a word of its title", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, record } = await withProject(db);

    await record({ externalId: "1", title: "Cursor-based paging" });
    await record({ externalId: "2", title: "Something else" });

    expect((await client.issues.list({ q: "acme/deevy#1" })).issues).toHaveLength(1);
    expect((await client.issues.list({ q: "paging" })).issues[0]?.externalKey).toBe("acme/deevy#1");
    // A key is matched whole, so #1 does not find #12.
    await record({ externalId: "12", title: "Twelve" });
    expect((await client.issues.list({ q: "acme/deevy#1" })).issues).toHaveLength(1);
  });

  it("takes % and _ in q literally, rather than as LIKE's wildcards", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, record } = await withProject(db);

    await record({ externalId: "1", title: "Cover 100% of the branches" });
    await record({ externalId: "2", title: "Cover 100 of them" });

    const found = await client.issues.list({ q: "100%" });
    expect(found.issues).toHaveLength(1);
    expect(found.issues[0]?.title).toBe("Cover 100% of the branches");
  });

  it("filters by what the tracker says, and by who deevy routed it to", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client, project, record } = await withProject(db);
    const planner = await agentContext(db, {
      name: "Planner",
      sponsor: admin.member,
      grants: [project.id],
    });

    const mine = await record({ externalId: "1", title: "Routed" });
    await record({ externalId: "2", title: "Closed", state: "closed", stateName: "Done" });
    await routeIssueTo(db, mine.id, planner.member.id);

    expect((await client.issues.list({ state: "closed" })).issues).toHaveLength(1);
    expect((await client.issues.list({ open: true })).issues).toHaveLength(1);
    expect((await client.issues.list({ assigneeMemberId: planner.member.id })).issues[0]?.id).toBe(
      mine.id,
    );
    expect((await client.issues.list({ assigneeKind: "agent" })).issues).toHaveLength(1);
    expect((await client.issues.list({ unassigned: true })).issues).toHaveLength(1);
    expect((await client.issues.list({ sponsorMemberId: admin.member.id })).issues).toHaveLength(1);
  });

  it("filters by a label the tracker carries, matching the whole word", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, record } = await withProject(db);

    await record({ externalId: "1", labels: ["bug"] });
    await record({ externalId: "2", labels: ["debug"] });

    const found = await client.issues.list({ label: "bug" });
    expect(found.issues).toHaveLength(1);
    expect(found.issues[0]?.externalKey).toBe("acme/deevy#1");
  });

  it("shows an Agent only the Projects it was granted", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    const granted = await seedProject(db, admin.workspace.id, {
      slug: "granted",
      scopeKey: "acme/granted",
    });
    const hidden = await seedProject(db, admin.workspace.id, {
      slug: "hidden",
      scopeKey: "acme/hidden",
    });
    await granted.record({ externalId: "1", title: "Granted" });
    await hidden.record({ externalId: "1", title: "Hidden" });

    const planner = await agentContext(db, {
      name: "Planner",
      sponsor: admin.member,
      grants: [granted.project.id],
    });
    const asAgent = createRouterClient(router, { context: planner });

    const found = await asAgent.issues.list({});
    expect(found.issues.map((issue) => issue.title)).toEqual(["Granted"]);
    // An ungranted Project does not exist to it, rather than being refused.
    await expect(asAgent.issues.get({ issue: "acme/hidden#1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("what a Project asks of a Run", () => {
  it("is on the record an Agent reads, because that is where it plans the whole Run", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, record } = await withProject(db);
    const issue = await record({ externalId: "42", title: "Ship the Event log" });

    // Before anything is set, nothing is asked: a Project with no Checkpoints
    // is one where an Agent plans, builds and finishes without stopping.
    expect((await client.issues.get({ issue: issue.url })).checkpoints).toEqual([]);

    await client.checkpoints.set({
      projectSlug: "deevy",
      checkpoints: [
        { name: "ship", approvalsRequired: 1 },
        { name: "plan", approvalsRequired: 1 },
      ],
    });

    // The names only, and in a settled order. The arithmetic behind each one is
    // a Human's business; what an Agent needs is which ones exist, so it knows
    // where to stop (apps/agent/src/instructions.md).
    expect((await client.issues.get({ issue: issue.url })).checkpoints).toEqual(["plan", "ship"]);
  });
});

describe("reading the conversation", () => {
  it("is the tracker's to answer, and only when somebody asks for it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const { sockets } = fakeSockets();
    const asAda = createRouterClient(router, { context: { ...ada, sockets } });
    const seeded = await seedProject(db, ada.workspace.id);
    const issue = await seeded.record({ externalId: "42", title: "Checkout rewrite" });

    // deevy stores no comments (ADR-0024), so a read that does not ask for
    // them makes no request to the tracker at all.
    const quiet = await asAda.issues.get({ issue: issue.url });
    expect(quiet.comments).toBeNull();

    const loud = await asAda.issues.get({ issue: issue.url, comments: true });
    expect(loud.comments).toEqual([]);
  });
});
