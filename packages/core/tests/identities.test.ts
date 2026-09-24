import { account, memberIdentity, socket as socketTable } from "@deevy/db";
import { eq } from "drizzle-orm";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { finishAccountLink } from "../src/account-links.ts";
import { newId } from "../src/ids.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * A Human's accounts on the tools, as they see them (Settings › Identities).
 *
 * The one screen that says which accounts can rule as you from outside deevy,
 * how deevy came to believe each one is yours, and lets you take one back.
 */
async function withIdentities() {
  const { db, close } = testDb();
  closers.push(close);
  const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
  const carol = await memberContext(db, { name: "Carol", email: "carol@example.com" });
  await db.insert(account).values({
    id: newId("account"),
    accountId: "1002",
    providerId: "github",
    userId: bob.member.userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const mine = newId("memberIdentity");
  await db.insert(memberIdentity).values([
    {
      id: mine,
      workspaceId: bob.workspace.id,
      memberId: bob.member.id,
      provider: "github",
      instance: "github.com",
      externalUserId: "1002",
      externalLogin: "bob",
      verifiedBy: "sign_in",
    },
    {
      id: newId("memberIdentity"),
      workspaceId: carol.workspace.id,
      memberId: carol.member.id,
      provider: "github",
      instance: "github.com",
      externalUserId: "2003",
      externalLogin: "carol-gh",
      verifiedBy: "sign_in",
    },
  ]);
  return {
    db,
    bob,
    carol,
    mine,
    asBob: createRouterClient(router, { context: bob }),
    asCarol: createRouterClient(router, { context: carol }),
  };
}

describe("a Human's Identities", () => {
  it("are their own, with how each was verified, and the accounts they sign in with", async () => {
    const { asBob } = await withIdentities();

    const listed = await asBob.identities.list({});

    expect(listed.identities).toEqual([
      expect.objectContaining({
        provider: "github",
        instance: "github.com",
        externalLogin: "bob",
        verifiedBy: "sign_in",
        revokedAt: null,
      }),
    ]);
    // What they could rule with from a tool deevy has not heard them on yet:
    // an account they sign in with vouches for them the first time they do.
    expect(listed.signIns).toEqual(["github"]);
    // And which sign-in providers a connected tool takes accounts from: none
    // here, because nothing is connected, so there is nothing worth linking.
    expect(listed.linkable).toEqual([]);
  });

  it("offers to link only what a connected tool would take", async () => {
    const { db, bob } = await withIdentities();
    const seeded = await seedProject(db, bob.workspace.id);
    await db
      .update(socketTable)
      .set({ config: { signInProvider: "github" } })
      .where(eq(socketTable.id, seeded.socketId));
    const { sockets } = fakeSockets();

    const listed = await createRouterClient(router, {
      context: { ...bob, sockets },
    }).identities.list({});

    expect(listed.linkable).toEqual(["github"]);
  });

  it("can be taken back, and stay taken back", async () => {
    const { db, asBob, mine } = await withIdentities();

    const revoked = await asBob.identities.revoke({ identityId: mine });

    expect(revoked.revokedAt).toBeInstanceOf(Date);
    const events = await db.query.event.findMany({});
    expect(events.map((event) => event.kind)).toContain("identity.revoked");
    // Twice is once: the second is not a second Event.
    await asBob.identities.revoke({ identityId: mine });
    const again = await db.query.event.findMany({});
    expect(again.filter((event) => event.kind === "identity.revoked")).toHaveLength(1);
  });

  it("can be allowed again by the Human who took it back, and by nobody else", async () => {
    const { db, asBob, asCarol, mine } = await withIdentities();
    await asBob.identities.revoke({ identityId: mine });

    // Nothing links a revoked account automatically — that is the point of
    // revoking it — so this is the only way back, and it is theirs.
    await expect(asCarol.identities.restore({ identityId: mine })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const restored = await asBob.identities.restore({ identityId: mine });

    expect(restored.revokedAt).toBeNull();
    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "identity.linked")).toHaveLength(1);
  });

  it("are nobody else's to take back", async () => {
    const { asCarol, mine } = await withIdentities();

    await expect(asCarol.identities.revoke({ identityId: mine })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("are a Human's: an Agent has none", async () => {
    const { db, bob } = await withIdentities();
    const planner = await agentContext(db, {
      name: "Planner",
      handle: "planner",
      email: "planner@example.com",
      sponsor: bob.member,
    });

    await expect(
      createRouterClient(router, { context: planner }).identities.list({}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

/**
 * Linking an account on a tool deevy does not sign people in with — Linear —
 * through that tool's own consent page (ADR-0025).
 *
 * The Human starts it signed in, the tool asks them, and the tool sends their
 * browser back with a code. What the code answers is the proof; the state is
 * what proves the round trip is the one this Human started.
 */
describe("linking an account through the tool's own consent", () => {
  async function withTool() {
    const { db, close } = testDb();
    closers.push(close);
    const bob = await memberContext(db, { name: "Bob", email: "bob@example.com" });
    const carol = await memberContext(db, { name: "Carol", email: "carol@example.com" });
    const seeded = await seedProject(db, bob.workspace.id);
    const { sockets } = fakeSockets();
    const extra = {
      sockets,
      secret: "an-instance-secret-of-at-least-32-chars",
      webURL: "https://app.deevy.test",
    };
    const asBob = createRouterClient(router, { context: { ...bob, ...extra } });
    const started = async () => {
      const { url } = await asBob.identities.begin({ socketId: seeded.socketId });
      return new URL(url).searchParams.get("state") ?? "";
    };
    return { db, seeded, bob: { ...bob, ...extra }, carol: { ...carol, ...extra }, asBob, started };
  }

  it("is offered for each connected tool that has one", async () => {
    const { seeded, asBob } = await withTool();

    const listed = await asBob.identities.list({});

    expect(listed.tools).toEqual([
      { socketId: seeded.socketId, provider: "stub", name: "Example tracker" },
    ]);
  });

  it("starts on the tool's own page, coming back to deevy's callback", async () => {
    const { seeded, asBob } = await withTool();

    const { url } = await asBob.identities.begin({ socketId: seeded.socketId });

    const search = new URL(url).searchParams;
    expect(search.get("redirect_uri")).toBe("https://deevy.test/api/identities/stub/callback");
    expect(search.get("state")?.startsWith(`${seeded.socketId}.`)).toBe(true);
  });

  it("links the account the tool says consented, to the Human who started it", async () => {
    const { db, bob, started } = await withTool();
    const state = await started();

    const done = await finishAccountLink(bob, { provider: "stub", code: "u-77", state });

    expect(done.location).toBe("https://app.deevy.test/settings/identities?linked=stub");
    const rows = await db.query.memberIdentity.findMany({});
    expect(rows).toEqual([
      expect.objectContaining({
        memberId: bob.member.id,
        provider: "stub",
        instance: "stub:test",
        externalUserId: "u-77",
        externalLogin: "user-u-77",
        verifiedBy: "oauth",
        revokedAt: null,
      }),
    ]);
    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds).toContain("identity.linked");
  });

  it("will not finish for anybody but the Human who started it", async () => {
    const { db, carol, started } = await withTool();
    const state = await started();

    const done = await finishAccountLink(carol, { provider: "stub", code: "u-77", state });

    expect(new URL(done.location).searchParams.get("linkError")).toMatch(/did not start here/);
    expect(await db.query.memberIdentity.findMany({})).toEqual([]);
  });

  it("will not link an account in another place than the one the tool reads", async () => {
    const { db, bob, started } = await withTool();
    const state = await started();

    const done = await finishAccountLink(bob, {
      provider: "stub",
      code: "u-77@stub:elsewhere",
      state,
    });

    expect(new URL(done.location).searchParams.get("linkError")).toMatch(/another workspace/);
    expect(await db.query.memberIdentity.findMany({})).toEqual([]);
  });

  it("will not take an account that already rules as somebody else", async () => {
    const { db, bob, carol, started } = await withTool();
    await db.insert(memberIdentity).values({
      id: newId("memberIdentity"),
      workspaceId: carol.workspace.id,
      memberId: carol.member.id,
      provider: "stub",
      instance: "stub:test",
      externalUserId: "u-77",
      externalLogin: "user-u-77",
      verifiedBy: "oauth",
    });
    const state = await started();

    const done = await finishAccountLink(bob, { provider: "stub", code: "u-77", state });

    expect(new URL(done.location).searchParams.get("linkError")).toMatch(/somebody else/);
    const rows = await db.query.memberIdentity.findMany({});
    expect(rows.map((row) => row.memberId)).toEqual([carol.member.id]);
  });

  it("says so when the Human said no on the tool's page", async () => {
    const { db, bob, started } = await withTool();
    const state = await started();

    const done = await finishAccountLink(bob, { provider: "stub", error: "access_denied", state });

    expect(new URL(done.location).searchParams.get("linkError")).toMatch(/access_denied/);
    expect(await db.query.memberIdentity.findMany({})).toEqual([]);
  });

  it("is a Human's: an Agent starts none", async () => {
    const { db, seeded, bob } = await withTool();
    const planner = await agentContext(db, { name: "Planner", sponsor: bob.member });

    await expect(
      createRouterClient(router, {
        context: { ...planner, sockets: bob.sockets },
      }).identities.begin({ socketId: seeded.socketId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
