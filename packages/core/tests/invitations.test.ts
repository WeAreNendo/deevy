import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { invitation as invitationTable, user, type Db } from "@deevy/db";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { joinWorkspace, type Session } from "../src/auth.ts";
import { newId } from "../src/ids.ts";
import { router } from "../src/operations/index.ts";
import type { AppContext } from "../src/operations/registry.ts";
import { memberContext, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * A Human who is signed in and nobody yet: the state the invited person is in
 * when they land on the link, and the one `accept` has to work from. Their
 * context carries a session and no Member, exactly as buildContext hands one
 * over (app.ts).
 */
async function signedIn(db: Db, email: string, name = "Grace"): Promise<AppContext> {
  const userId = newId("user");
  await db.insert(user).values({ id: userId, name, email });
  const session = {
    session: { id: newId("session"), userId, token: "test", expiresAt: new Date() },
    user: { id: userId, name, email, image: null, kind: "human" },
  } as unknown as Session;
  return {
    db,
    session,
    member: null,
    workspace: null,
    baseURL: "https://deevy.test",
  };
}

/** An admin of a Workspace, and the client their operations go through. */
async function workspaceWithAdmin(db: Db) {
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  return { admin, client: createRouterClient(router, { context: admin }) };
}

describe("invitations.create", () => {
  it("hands back a link to send, and stores only a hash of the token", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await workspaceWithAdmin(db);

    const created = await client.invitations.create({ email: "Grace@Example.com" });

    expect(created).toMatchObject({
      email: "grace@example.com",
      role: "member",
      createdBy: admin.member.id,
      acceptedAt: null,
      revokedAt: null,
    });
    expect(created.id).toMatch(/^inv_/);
    const token = created.url.replace("https://deevy.test/invite/", "");
    // The absolute URL is this instance's own origin, which serves the SPA in
    // the image and on Workers; the site-relative one is for everywhere else,
    // where the browser knows the origin and the server does not
    // (docs/plans/sign-in.md).
    expect(created.path).toBe(`/invite/${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Seven days, give or take the second this test took.
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(created.expiresAt.getTime() - Date.now()).toBeGreaterThan(week - 60_000);
    expect(created.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(week);

    const [row] = await db.select().from(invitationTable);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.tokenHash).not.toBe(token);
  });

  it("appends the Event that created it, carrying no token", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await workspaceWithAdmin(db);

    const created = await client.invitations.create({ email: "grace@example.com", role: "admin" });

    const page = await client.events.list({ subjectType: "invitation", subjectId: created.id });
    expect(page.events).toMatchObject([
      {
        kind: "invitation.created",
        actorMemberId: admin.member.id,
        payload: { email: "grace@example.com", role: "admin" },
      },
    ]);
    const token = created.url.split("/").at(-1) as string;
    expect(JSON.stringify(page.events)).not.toContain(token);
  });

  it("refuses a second live invitation for the same address", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await workspaceWithAdmin(db);
    await client.invitations.create({ email: "grace@example.com" });

    await expect(client.invitations.create({ email: "grace@example.com" })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    // Revoking frees the address again.
    const [live] = (await client.invitations.list({})).invitations;
    await client.invitations.revoke({ invitationId: live?.id as string });
    await expect(client.invitations.create({ email: "grace@example.com" })).resolves.toMatchObject({
      email: "grace@example.com",
    });
  });

  it("refuses something that is not an address, and a Member who is not an admin", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await workspaceWithAdmin(db);
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });

    const admins = createRouterClient(router, {
      context: await memberContext(db, {
        role: "admin",
        name: "Alice",
        email: "alice@example.com",
      }),
    });
    await expect(admins.invitations.create({ email: "not-an-address" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    const client = createRouterClient(router, { context: bob });
    await expect(client.invitations.create({ email: "grace@example.com" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("builds that link on the SPA's origin when this deployment gives it one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin } = await workspaceWithAdmin(db);
    // The `dev` loop and a split-origin deployment: the API answers on one
    // port and the page a Human has open is on another
    // (docs/plans/sign-in.md).
    const split = createRouterClient(router, {
      context: { ...admin, webURL: "https://app.deevy.test" },
    });

    const created = await split.invitations.create({ email: "grace@example.com" });

    expect(created.url).toBe(`https://app.deevy.test${created.path}`);
  });
});

describe("invitations.list", () => {
  it("shows every invitation and none of their tokens", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await workspaceWithAdmin(db);
    const first = await client.invitations.create({ email: "grace@example.com" });
    const second = await client.invitations.create({ email: "hopper@example.com" });

    const { invitations } = await client.invitations.list({});

    // Newest first; both were created in the same millisecond here, so what
    // this asserts is that both are there and neither carries its token.
    expect(invitations.map((row) => row.email).sort()).toEqual([
      "grace@example.com",
      "hopper@example.com",
    ]);
    expect(invitations[0]).not.toHaveProperty("tokenHash");
    expect(invitations[0]).not.toHaveProperty("url");
    const body = JSON.stringify(invitations);
    for (const created of [first, second]) {
      expect(body).not.toContain(created.url.split("/").at(-1) as string);
    }
  });

  it("is refused to a Member who is not an admin", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await workspaceWithAdmin(db);
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });

    const client = createRouterClient(router, { context: bob });
    await expect(client.invitations.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("invitations.revoke", () => {
  it("keeps the row, appends the Event, and is a no-op the second time", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await workspaceWithAdmin(db);
    const created = await client.invitations.create({ email: "grace@example.com" });

    const revoked = await client.invitations.revoke({ invitationId: created.id });
    expect(revoked.revokedAt).toBeInstanceOf(Date);

    const again = await client.invitations.revoke({ invitationId: created.id });
    expect(again.revokedAt?.getTime()).toBe(revoked.revokedAt?.getTime());

    const page = await client.events.list({ subjectType: "invitation", subjectId: created.id });
    expect(page.events.map((event) => event.kind)).toEqual([
      "invitation.created",
      "invitation.revoked",
    ]);
    expect(page.events.at(-1)).toMatchObject({ actorMemberId: admin.member.id });
    expect((await client.invitations.list({})).invitations).toHaveLength(1);
  });

  it("refuses an invitation this Workspace never issued", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await workspaceWithAdmin(db);

    await expect(
      client.invitations.revoke({ invitationId: newId("invitation") }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is refused to a Member who is not an admin", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await workspaceWithAdmin(db);
    const created = await client.invitations.create({ email: "grace@example.com" });
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });

    await expect(
      createRouterClient(router, { context: bob }).invitations.revoke({
        invitationId: created.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("invitations.accept", () => {
  it("makes the invited address a Member with the invited role", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await workspaceWithAdmin(db);
    const created = await client.invitations.create({ email: "grace@example.com", role: "admin" });
    const token = created.url.split("/").at(-1) as string;

    const grace = await signedIn(db, "grace@example.com", "Grace Hopper");
    const member = await createRouterClient(router, { context: grace }).invitations.accept({
      token,
    });

    expect(member).toMatchObject({ role: "admin", kind: "human", handle: "grace-hopper" });
    const row = await db.query.invitation.findFirst({ where: { id: created.id } });
    expect(row?.acceptedAt).toBeInstanceOf(Date);
    expect(row?.acceptedMemberId).toBe(member.id);

    // The Workspace's history reads the same however somebody got in.
    const page = await client.events.list({});
    const joined = page.events.filter((event) => event.kind === "member.joined");
    expect(joined.at(0)).toMatchObject({
      subjectId: member.id,
      actorMemberId: member.id,
      payload: { role: "admin", kind: "human" },
    });
    const accepted = page.events.find((event) => event.kind === "invitation.accepted");
    expect(accepted).toMatchObject({
      subjectId: created.id,
      payload: { email: "grace@example.com", role: "admin" },
    });
  });

  it("gives a Member who accepts twice their Member row back", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await workspaceWithAdmin(db);
    const created = await client.invitations.create({ email: "grace@example.com" });
    const token = created.url.split("/").at(-1) as string;
    const grace = await signedIn(db, "grace@example.com");
    const first = await createRouterClient(router, { context: grace }).invitations.accept({
      token,
    });

    // The second call arrives with the Member row the first one created.
    const again = await createRouterClient(router, {
      context: {
        ...grace,
        member: first,
        workspace: (await db.query.workspace.findFirst()) ?? null,
      },
    }).invitations.accept({ token });

    expect(again.id).toBe(first.id);
    expect(await db.$count(invitationTable, eq(invitationTable.acceptedMemberId, first.id))).toBe(
      1,
    );
  });

  it("refuses an address the invitation was not sent to, naming the one it was", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await workspaceWithAdmin(db);
    const created = await client.invitations.create({ email: "grace@example.com" });
    const token = created.url.split("/").at(-1) as string;

    const bob = await signedIn(db, "bob@example.com", "Bob");
    await expect(
      createRouterClient(router, { context: bob }).invitations.accept({ token }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: /grace@example\.com/ });
    expect(await db.$count(invitationTable, eq(invitationTable.id, created.id))).toBe(1);
    expect((await db.query.invitation.findFirst())?.acceptedAt).toBeNull();
  });

  it("refuses a token nobody was given", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await workspaceWithAdmin(db);
    const grace = await signedIn(db, "grace@example.com");

    await expect(
      createRouterClient(router, { context: grace }).invitations.accept({ token: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses an expired invitation and a revoked one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await workspaceWithAdmin(db);
    const stale = await client.invitations.create({ email: "grace@example.com" });
    await db
      .update(invitationTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitationTable.id, stale.id));
    const gone = await client.invitations.create({ email: "hopper@example.com" });
    await client.invitations.revoke({ invitationId: gone.id });

    const grace = await signedIn(db, "grace@example.com");
    await expect(
      createRouterClient(router, { context: grace }).invitations.accept({
        token: stale.url.split("/").at(-1) as string,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /expired/ });

    const hopper = await signedIn(db, "hopper@example.com", "Hopper");
    await expect(
      createRouterClient(router, { context: hopper }).invitations.accept({
        token: gone.url.split("/").at(-1) as string,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /revoked/ });

    expect(await db.$count(invitationTable, eq(invitationTable.acceptedAt, new Date(0)))).toBe(0);
  });

  it("refuses an invitation somebody else already accepted", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await workspaceWithAdmin(db);
    const created = await client.invitations.create({ email: "grace@example.com" });
    const token = created.url.split("/").at(-1) as string;
    await createRouterClient(router, {
      context: await signedIn(db, "grace@example.com"),
    }).invitations.accept({ token });

    // A spent link in somebody else's hands: what it is, before who is
    // holding it. There is no second Human on the invited address to try it
    // with — one address is one user row.
    const bob = await signedIn(db, "bob@example.com", "Bob");
    await expect(
      createRouterClient(router, { context: bob }).invitations.accept({ token }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /already accepted/ });
  });

  it("is refused to a caller who is signed out", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await workspaceWithAdmin(db);
    const created = await client.invitations.create({ email: "grace@example.com" });

    const anonymous = { db, session: null, member: null, workspace: null };
    await expect(
      createRouterClient(router, { context: anonymous }).invitations.accept({
        token: created.url.split("/").at(-1) as string,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("an invitation somebody else's route already spent", () => {
  /**
   * The link has done its work, but the row had not: an address that became a
   * Member some other way kept a live invitation nobody could accept and no
   * admin could replace, because one live invitation per address refuses the
   * next (docs/plans/sign-in.md).
   */
  it("is spent when the caller turns out to be a Member already", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await workspaceWithAdmin(db);
    const created = await client.invitations.create({ email: "grace@example.com" });
    const token = created.url.split("/").at(-1) as string;
    const grace = await memberContext(db, { name: "Grace", email: "grace@example.com" });

    // Grace joined by a rule in the meantime, so she is a Member before she
    // ever spends the link.
    await createRouterClient(router, { context: grace }).invitations.accept({ token });

    const [row] = (await client.invitations.list({})).invitations;
    expect(row?.acceptedAt).not.toBeNull();
    // And the address can be invited again, rather than being refused for a
    // link that will never be used.
    await expect(client.invitations.create({ email: "grace@example.com" })).resolves.toMatchObject({
      email: "grace@example.com",
    });
  });

  it("is spent when a rule admits the same address", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await workspaceWithAdmin(db);
    await client.allowlist.add({ kind: "email_domain", value: "example.com" });
    await client.invitations.create({ email: "grace@example.com" });

    await db
      .insert(user)
      .values({ id: "usr_grace000001", name: "Grace", email: "grace@example.com" });
    await joinWorkspace(db, {
      userId: "usr_grace000001",
      email: "grace@example.com",
      name: "Grace",
      emailVerified: true,
    });

    const [row] = (await client.invitations.list({})).invitations;
    expect(row?.acceptedAt).not.toBeNull();
  });
});

describe("who may read an invitation Event", () => {
  /**
   * `invitations.list` is an admin's, and the Event log is every Member's, so
   * the payload naming the address and the role would have been the way around
   * it (docs/plans/sign-in.md).
   */
  it("keeps the address out of a Member's Event log, and in an admin's", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await workspaceWithAdmin(db);
    await client.invitations.create({ email: "grace@example.com", role: "admin" });
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });

    const asMember = await createRouterClient(router, { context: bob }).events.list({});
    expect(asMember.events.map((row) => row.kind)).not.toContain("invitation.created");

    const asAdmin = await client.events.list({});
    expect(asAdmin.events.map((row) => row.kind)).toContain("invitation.created");
  });
});
