import { account, allowlistRule, allowlistRuleKinds, member, user } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  accountLinkingOf,
  bootstrapWorkspace,
  createAuth,
  joinPorts,
  joinWorkspace,
  plainOAuthToken,
  type ReadOAuthToken,
} from "../src/auth.ts";
import { symmetricEncrypt } from "better-auth/crypto";
import { router } from "../src/operations/index.ts";
import { memberContext, testDb, type MemberContext } from "./helpers.ts";
import { authId, newId } from "../src/ids.ts";

/** An admin plus one allowlist rule: the arrangement every join test starts from. */
async function allow(
  db: Parameters<typeof memberContext>[0],
  value: string,
  kind: (typeof allowlistRuleKinds)[number] = "email_domain",
) {
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  await db.insert(allowlistRule).values({
    id: newId("allowlistRule"),
    workspaceId: admin.workspace.id,
    kind,
    value,
    createdBy: admin.member.id,
  });
  return admin satisfies MemberContext;
}

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  vi.unstubAllGlobals();
});

describe("joinWorkspace", () => {
  it("makes a Member of a sign-in whose email domain a rule allows", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    await db.insert(allowlistRule).values({
      id: newId("allowlistRule"),
      workspaceId: admin.workspace.id,
      kind: "email_domain",
      value: "example.com",
      createdBy: admin.member.id,
    });
    await db.insert(user).values({ id: "u-bob", name: "Bob", email: "bob@example.com" });

    await joinWorkspace(db, {
      userId: "u-bob",
      email: "bob@example.com",
      name: "Bob",
      emailVerified: true,
    });

    expect(await db.query.member.findFirst({ where: { userId: "u-bob" } })).toMatchObject({
      workspaceId: admin.workspace.id,
      role: "member",
      kind: "human",
    });
  });

  it("never admits an address the provider did not verify, whatever its domain", async () => {
    // A provider that does not vouch for an address — Linear, Atlassian, an
    // Entra tenant without verified-email claims — could otherwise hand a
    // stranger a Member by naming an address at an allowed domain ("nOAuth").
    const { db, close } = testDb();
    closers.push(close);
    await allow(db, "example.com");
    await db.insert(user).values({ id: "u-mallory", name: "Mallory", email: "cto@example.com" });

    await joinWorkspace(db, {
      userId: "u-mallory",
      email: "cto@example.com",
      name: "Mallory",
      emailVerified: false,
    });

    expect(await db.query.member.findFirst({ where: { userId: "u-mallory" } })).toBeUndefined();
  });

  it("leaves a sign-in no Member when no rule matches", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await memberContext(db, { role: "admin", name: "Ada" });
    await db.insert(allowlistRule).values({
      id: newId("allowlistRule"),
      workspaceId: admin.workspace.id,
      kind: "email_domain",
      value: "example.com",
      createdBy: admin.member.id,
    });
    await db.insert(user).values({ id: "u-carol", name: "Carol", email: "carol@example.org" });

    await joinWorkspace(db, {
      userId: "u-carol",
      email: "carol@example.org",
      name: "Carol",
      emailVerified: true,
    });

    expect(await db.query.member.findFirst({ where: { userId: "u-carol" } })).toBeUndefined();
  });
});

describe("the handle a Member joins with", () => {
  it("takes the login the provider gave, whichever provider it was", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await allow(db, "example.com");
    await db.insert(user).values({ id: "u-bob", name: "Bob Vance", email: "bob@example.com" });

    await joinWorkspace(
      db,
      { userId: "u-bob", email: "bob@example.com", name: "Bob Vance", emailVerified: true },
      { login: async () => "bvance" },
    );

    expect(await db.query.member.findFirst({ where: { userId: "u-bob" } })).toMatchObject({
      handle: "bvance",
    });
  });

  it("falls back to a slug of the name", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await allow(db, "example.com");
    await db.insert(user).values({ id: "u-bob", name: "Bob Vance", email: "bob@example.com" });

    await joinWorkspace(db, {
      userId: "u-bob",
      email: "bob@example.com",
      name: "Bob Vance",
      emailVerified: true,
    });

    expect(await db.query.member.findFirst({ where: { userId: "u-bob" } })).toMatchObject({
      handle: "bob-vance",
    });
  });

  it("suffixes a handle another Member already holds", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await allow(db, "example.com");
    await db.update(member).set({ handle: "bob-vance" }).where(eq(member.id, admin.member.id));
    await db.insert(user).values({ id: "u-bob", name: "Bob Vance", email: "bob@example.com" });

    await joinWorkspace(db, {
      userId: "u-bob",
      email: "bob@example.com",
      name: "Bob Vance",
      emailVerified: true,
    });

    expect(await db.query.member.findFirst({ where: { userId: "u-bob" } })).toMatchObject({
      handle: "bob-vance-2",
    });
  });
});

describe("the Event a join appends", () => {
  it("records member.joined with the new Member as subject and no actor", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await allow(db, "example.com");
    await db.insert(user).values({ id: "u-bob", name: "Bob", email: "bob@example.com" });

    await joinWorkspace(db, {
      userId: "u-bob",
      email: "bob@example.com",
      name: "Bob",
      emailVerified: true,
    });

    const bob = await db.query.member.findFirst({ where: { userId: "u-bob" } });
    const client = createRouterClient(router, { context: admin });
    const page = await client.events.list({ subjectType: "member", subjectId: bob?.id });
    expect(page.events).toMatchObject([
      { kind: "member.joined", actorMemberId: null, payload: { role: "member", kind: "human" } },
    ]);
  });
});

describe("a suspended Member", () => {
  it("is turned away from Workspace operations", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db);
    await db
      .update(member)
      .set({ suspendedAt: new Date() })
      .where(eq(member.id, context.member.id));
    const suspended = await db.query.member.findFirst({ where: { id: context.member.id } });

    const client = createRouterClient(router, {
      context: { ...context, member: suspended ?? context.member },
    });
    await expect(client.workspace.get()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the admin the bootstrap creates", () => {
  it("carries a handle, so slice 10 can mention them", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await db.insert(user).values({ id: "u1", name: "Ada Lovelace", email: "ada@example.com" });

    await bootstrapWorkspace(
      db,
      { userId: "u1", email: "ada@example.com", name: "Ada Lovelace", emailVerified: true },
      { adminEmail: "ada@example.com" },
    );

    expect(await db.query.member.findFirst({ where: { userId: "u1" } })).toMatchObject({
      handle: "ada-lovelace",
    });
  });
});

/**
 * One Human, one Member (docs/plans/sign-in.md slice 3). Two halves: what
 * Better Auth is told about linking, and what deevy does when a second account
 * arrives for a Member it already has. The dance itself — a second provider
 * signing in on an address a first one already registered — is driven end to
 * end against the stub in `apps/server/tests/stub-oauth.test.ts`, which is
 * where a real provider and a real callback are.
 */
describe("one Human, one Member", () => {
  /**
   * Trusting a provider by name is not "this deployment offers it"; it is
   * "link it without reading whether it says the address is verified". Every
   * provider deevy ships reports a verified address when it has one, so the
   * list buys no working case and costs the refusal that stops an IdP with
   * open self-registration linking a stranger onto a Member.
   */
  it("trusts no provider by name, whatever the deployment configured", () => {
    const github = { clientId: "id", clientSecret: "secret" };
    // And no account on another address is linked to anybody: an account on a
    // tool vouches for nobody (ADR-0036), so Better Auth's default holds.
    expect(accountLinkingOf({ providers: { github } })).toEqual({
      enabled: true,
      trustedProviders: [],
    });
    expect(accountLinkingOf({})).toMatchObject({ trustedProviders: [] });
  });

  it("carries that decision into the instance, where the linking rule reads it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const auth = createAuth({
      db,
      env: {
        baseURL: "https://deevy.example.com",
        secret: "test-secret-that-is-at-least-32-characters",
        providers: { github: { clientId: "id", clientSecret: "secret" } },
      },
    });

    // `context.trustedProviders` is what handleOAuthUserInfo consults; the
    // option alone would be a value nothing had resolved.
    expect((await auth.$context).trustedProviders).toEqual([]);
    expect(auth.options.account?.accountLinking).not.toHaveProperty("allowDifferentEmails");
  });

  it("adds no second Member when another account joins a Human who has one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await allow(db, "example.com");
    await db.insert(user).values({ id: "u-bob", name: "Bob Vance", email: "bob@example.com" });
    const bob = {
      userId: "u-bob",
      email: "bob@example.com",
      name: "Bob Vance",
      emailVerified: true,
    };
    await joinWorkspace(db, bob, { login: async () => "bvance" });

    // What a linked account looks like on the way back in: the same user, a
    // second provider, and the join running again from Better Auth's hooks.
    await db.insert(account).values({
      id: authId("account"),
      accountId: "bob@example.com",
      providerId: "google",
      userId: "u-bob",
      updatedAt: new Date(),
    });
    await joinWorkspace(db, bob);
    await bootstrapWorkspace(db, bob, { adminEmail: "bob@example.com" });

    const members = await db.query.member.findMany({ where: { userId: "u-bob" } });
    expect(members).toMatchObject([{ role: "member", handle: "bvance" }]);
    const client = createRouterClient(router, { context: admin });
    const page = await client.events.list({ subjectType: "member", subjectId: members[0]?.id });
    expect(page.events).toMatchObject([{ kind: "member.joined" }]);
  });
});

describe("joinPorts", () => {
  /** A signed-in Human with one provider account, and the token the ports read. */
  const signedInWith = async (
    db: Awaited<ReturnType<typeof testDb>>["db"],
    providerId: string,
    accessToken = "token",
  ) => {
    await db.insert(user).values({ id: "u-bob", name: "Bob Vance", email: "bob@example.com" });
    await db.insert(account).values({
      id: authId("account"),
      userId: "u-bob",
      accountId: "bob",
      providerId,
      accessToken,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  };

  /**
   * The context Better Auth seals a token with, and the reader a join gets
   * from it: the pair `createAuth` wires into its hooks, so a test reads a row
   * exactly as a sign-in does.
   */
  const sealing = async (db: Awaited<ReturnType<typeof testDb>>["db"]) => {
    const auth = createAuth({
      db,
      env: {
        baseURL: "https://deevy.example.com",
        secret: "test-secret-that-is-at-least-32-chars",
      },
    });
    const context = await auth.$context;
    const read: ReadOAuthToken = (stored) => plainOAuthToken(stored, context.secretConfig);
    return { context, read };
  };
  const portsFor = async (db: Awaited<ReturnType<typeof testDb>>["db"]) =>
    joinPorts(db, "u-bob", (await sealing(db)).read);

  /**
   * What GitHub was asked with. Tokens are sealed at rest
   * (`encryptOAuthTokens`), and GitHub wants the one it issued.
   */
  const bearersSent = () => {
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      sent.push(new Headers(init?.headers).get("authorization") ?? "");
      return Response.json({ login: "bvance" });
    });
    return sent;
  };

  it("asks GitHub with the token Better Auth sealed, opened", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { context } = await sealing(db);
    // What Better Auth's `setTokenUtil` writes when the option is on, which
    // `createAuth` turns on (a sign-in through the stub writes one for real in
    // apps/server/tests/stub-oauth.test.ts).
    expect(context.options.account?.encryptOAuthTokens).toBe(true);
    const sealed = await symmetricEncrypt({
      key: context.secretConfig,
      data: "gho_the-token-github-issued",
    });
    expect(sealed).not.toContain("gho_");
    await signedInWith(db, "github", sealed);
    const sent = bearersSent();

    expect(await (await portsFor(db)).login?.()).toBe("bvance");
    expect(sent).toEqual(["Bearer gho_the-token-github-issued"]);
  });

  it("still asks with a token written in the clear before sealing was on", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await signedInWith(db, "github", "gho_written-before-sealing");
    const sent = bearersSent();

    expect(await (await portsFor(db)).login?.()).toBe("bvance");
    expect(sent).toEqual(["Bearer gho_written-before-sealing"]);
  });

  it("answers no login, rather than failing the sign-in, when GitHub refuses or cannot be reached", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await signedInWith(db, "github");
    vi.stubGlobal("fetch", async () => new Response("unavailable", { status: 503 }));

    expect(await (await portsFor(db)).login?.()).toBeNull();
    vi.stubGlobal("fetch", async () => {
      throw new Error("connection reset");
    });
    expect(await (await portsFor(db)).login?.()).toBeNull();
  });

  it("spends no request on a Human who never signed in with GitHub", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await signedInWith(db, "google");
    let asked = 0;
    vi.stubGlobal("fetch", async () => {
      asked++;
      return Response.json({ login: "bvance" });
    });

    expect(await (await portsFor(db)).login?.()).toBeNull();
    expect(asked).toBe(0);
  });
});
