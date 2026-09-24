import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { fakeSockets, memberContext, testDb, type MemberContext } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * An admin with a tracker Socket connected. A Project is a binding now: it
 * names the Socket and the container its Issues come from, so there is nothing
 * to create before one exists (ADR-0024).
 */
async function withSocket(db: MemberContext["db"]) {
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const { sockets } = fakeSockets();
  const client = createRouterClient(router, { context: { ...admin, sockets } });
  const socket = await client.sockets.connect({ provider: "stub", name: "Example tracker" });
  const bind = (scopeKey: string) => ({ socketId: socket.id, scope: { scopeKey } });
  return { admin, client, socket, bind, sockets };
}

describe("projects.create", () => {
  it("returns the Project bound to the container it names", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, socket, bind } = await withSocket(db);

    const project = await client.projects.create({
      slug: "deevy",
      name: "deevy",
      tracker: bind("acme/deevy"),
    });

    expect(project).toMatchObject({
      slug: "deevy",
      name: "deevy",
      trackerSocketId: socket.id,
      trackerScope: { scopeKey: "acme/deevy" },
      // Stored beside the scope so an inbound delivery finds its Project in one
      // indexed read, and prefixed by the provider so two never collide.
      trackerScopeKey: "stub:acme/deevy",
      archivedAt: null,
    });
    // Nothing is bound that was not named: an Agent working this Project gets no
    // checkout until a forge is.
    expect(project.forgeSocketId).toBeNull();
    expect(project.docsSocketId).toBeNull();
    expect(project.defaultAgentMemberId).toBeNull();
  });

  it("records project.created with the Project as subject", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client, bind } = await withSocket(db);

    const project = await client.projects.create({
      slug: "deevy",
      name: "deevy",
      tracker: bind("acme/deevy"),
    });

    const page = await client.events.list({ subjectType: "project", subjectId: project.id });
    expect(page.events).toMatchObject([
      {
        kind: "project.created",
        actorMemberId: admin.member.id,
        projectId: project.id,
        payload: { slug: "deevy", name: "deevy", trackerScopeKey: "stub:acme/deevy" },
      },
    ]);
  });

  it("refuses a Member who is not an admin", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { socket, sockets } = await withSocket(db);
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });

    const client = createRouterClient(router, { context: { ...bob, sockets } });
    await expect(
      client.projects.create({
        slug: "deevy",
        name: "deevy",
        tracker: { socketId: socket.id, scope: { scopeKey: "acme/deevy" } },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a Socket this deevy has no module for", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, bind } = await withSocket(db);

    await expect(
      client.projects.create({
        slug: "deevy",
        name: "deevy",
        tracker: { ...bind("acme/deevy"), socketId: "sock_000000000000" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("a Project slug", () => {
  it("is lowercase letters, numbers and hyphens", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, bind } = await withSocket(db);

    for (const slug of ["DEV", "a", "-deevy", "deevy-", "acme deevy", "acme/deevy"]) {
      await expect(
        client.projects.create({ slug, name: "deevy", tracker: bind("acme/deevy") }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("cannot be taken twice", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, bind } = await withSocket(db);
    await client.projects.create({ slug: "deevy", name: "deevy", tracker: bind("acme/deevy") });

    await expect(
      client.projects.create({ slug: "deevy", name: "Other", tracker: bind("acme/other") }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("the container a Project is bound to", () => {
  it("belongs to one Project, so two never project the same record", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, bind } = await withSocket(db);
    await client.projects.create({ slug: "deevy", name: "deevy", tracker: bind("acme/deevy") });

    await expect(
      client.projects.create({ slug: "deevy-again", name: "Again", tracker: bind("acme/deevy") }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("projects.list and projects.get", () => {
  it("lists the Workspace's Projects and finds one by its slug, case-insensitively", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, bind } = await withSocket(db);
    await client.projects.create({ slug: "deevy", name: "deevy", tracker: bind("acme/deevy") });
    await client.projects.create({ slug: "website", name: "Website", tracker: bind("acme/site") });

    const { projects } = await client.projects.list({});
    expect(projects.map((p) => p.slug)).toEqual(["deevy", "website"]);

    expect(await client.projects.get({ slug: "Deevy" })).toMatchObject({
      slug: "deevy",
      name: "deevy",
    });
  });

  it("reports an unknown slug as not found", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await withSocket(db);

    await expect(client.projects.get({ slug: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("is open to any Member, not only an admin", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, bind, sockets } = await withSocket(db);
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    await client.projects.create({ slug: "deevy", name: "deevy", tracker: bind("acme/deevy") });

    const asBob = createRouterClient(router, { context: { ...bob, sockets } });
    expect((await asBob.projects.list({})).projects).toHaveLength(1);
  });
});

describe("projects.update", () => {
  it("renames a Project and records what changed", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, bind } = await withSocket(db);
    const project = await client.projects.create({
      slug: "deevy",
      name: "deevy",
      tracker: bind("acme/deevy"),
    });

    const updated = await client.projects.update({
      slug: "deevy",
      name: "deevy core",
      description: "The product itself",
    });

    expect(updated).toMatchObject({ name: "deevy core", description: "The product itself" });
    const page = await client.events.list({ subjectType: "project", subjectId: project.id });
    expect(page.events.at(-1)).toMatchObject({
      kind: "project.updated",
      projectId: project.id,
      payload: { name: { from: "deevy", to: "deevy core" } },
    });
  });

  it("changes how much deevy says back in the tracker", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, bind } = await withSocket(db);
    const project = await client.projects.create({
      slug: "deevy",
      name: "deevy",
      tracker: bind("acme/deevy"),
    });
    expect(project.mirror).toBe("gates");

    expect(await client.projects.update({ slug: "deevy", mirror: "off" })).toMatchObject({
      mirror: "off",
    });
  });

  /**
   * A binding names a Socket and a container, and pointing a Project at
   * somebody else's repository is not a Project-level decision (ADR-0024).
   */
  it("refuses a Member who is not an admin", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, bind, sockets } = await withSocket(db);
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    await client.projects.create({ slug: "deevy", name: "deevy", tracker: bind("acme/deevy") });

    const asBob = createRouterClient(router, { context: { ...bob, sockets } });
    await expect(asBob.projects.update({ slug: "deevy", name: "Mine" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("projects.archive", () => {
  it("drops the Project from the default list but keeps it findable", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, bind } = await withSocket(db);
    const project = await client.projects.create({
      slug: "deevy",
      name: "deevy",
      tracker: bind("acme/deevy"),
    });

    const archived = await client.projects.archive({ slug: "deevy" });

    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect((await client.projects.list({})).projects).toEqual([]);
    expect((await client.projects.list({ includeArchived: true })).projects).toHaveLength(1);
    expect(await client.projects.get({ slug: "deevy" })).toMatchObject({ slug: "deevy" });

    const page = await client.events.list({ subjectType: "project", subjectId: project.id });
    expect(page.events.map((e) => e.kind)).toEqual(["project.created", "project.archived"]);
  });

  it("refuses a Member who is not an admin", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, bind, sockets } = await withSocket(db);
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    await client.projects.create({ slug: "deevy", name: "deevy", tracker: bind("acme/deevy") });

    const asBob = createRouterClient(router, { context: { ...bob, sockets } });
    await expect(asBob.projects.archive({ slug: "deevy" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("the rest of a Project's binding", () => {
  it("names where its code is, and takes it back off", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, socket, bind } = await withSocket(db);
    await client.projects.create({ slug: "deevy", name: "deevy", tracker: bind("acme/deevy") });

    const bound = await client.projects.update({
      slug: "deevy",
      forge: { socketId: socket.id, scope: { scopeKey: "acme/deevy", baseBranch: "main" } },
    });

    expect(bound.forgeSocketId).toBe(socket.id);
    expect(bound.forgeScope).toMatchObject({ scopeKey: "acme/deevy", baseBranch: "main" });

    // Null, not absent: a Project whose code moved elsewhere is one a Run
    // should stop trying to clone (docs/plans/sockets.md, slice 6).
    const unbound = await client.projects.update({ slug: "deevy", forge: null });
    expect(unbound.forgeSocketId).toBeNull();
    expect(unbound.forgeScope).toBeNull();
  });

  it("says how a record names the Agent it is for", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client, bind } = await withSocket(db);
    await client.projects.create({ slug: "deevy", name: "deevy", tracker: bind("acme/deevy") });

    const routed = await client.projects.update({
      slug: "deevy",
      routing: { labelPrefix: "for:", mention: false },
    });

    expect(routed.routing).toEqual({ labelPrefix: "for:", mention: false });
    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "project.updated")).toHaveLength(1);
  });
});
