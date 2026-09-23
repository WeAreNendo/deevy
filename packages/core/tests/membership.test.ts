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
} from "../src/auth.ts";
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

    await joinWorkspace(db, { userId: "u-bob", email: "bob@example.com", name: "Bob" });

    expect(await db.query.member.findFirst({ where: { userId: "u-bob" } })).toMatchObject({
      workspaceId: admin.workspace.id,
      role: "member",
      kind: "human",
    });
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

    await joinWorkspace(db, { userId: "u-carol", email: "carol@example.org", name: "Carol" });

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
      { userId: "u-bob", email: "bob@example.com", name: "Bob Vance" },
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

    await joinWorkspace(db, { userId: "u-bob", email: "bob@example.com", name: "Bob Vance" });

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

    await joinWorkspace(db, { userId: "u-bob", email: "bob@example.com", name: "Bob Vance" });

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

    await joinWorkspace(db, { userId: "u-bob", email: "bob@example.com", name: "Bob" });

    const bob = await db.query.member.findFirst({ where: { userId: "u-bob" } });
    const client = createRouterClient(router, { context: admin });
    const page = await client.events.list({ subjectType: "member", subjectId: bob?.id });
    expect(page.events).toMatchObject([
      { kind: "member.joined", actorMemberId: null, payload: { role: "member", kind: "human" } },
    ]);
  });
});

describe("a github_org rule", () => {
  it("admits a sign-in whose organizations include the rule's value", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await allow(db, "acme", "github_org");
    await db.insert(user).values({ id: "u-bob", name: "Bob", email: "bob@example.org" });

    await joinWorkspace(
      db,
      { userId: "u-bob", email: "bob@example.org", name: "Bob" },
      { listOrgs: async () => ["Acme", "Acme"] },
    );

    expect(await db.query.member.findFirst({ where: { userId: "u-bob" } })).toMatchObject({
      role: "member",
    });
  });

  it("turns away a sign-in in none of the allowed organizations", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await allow(db, "acme", "github_org");
    await db.insert(user).values({ id: "u-bob", name: "Bob", email: "bob@example.org" });

    await joinWorkspace(
      db,
      { userId: "u-bob", email: "bob@example.org", name: "Bob" },
      { listOrgs: async () => ["Globex"] },
    );

    expect(await db.query.member.findFirst({ where: { userId: "u-bob" } })).toBeUndefined();
  });

  it("never asks for organizations when an email domain already matched", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await allow(db, "example.com");
    await db.insert(user).values({ id: "u-bob", name: "Bob", email: "bob@example.com" });
    let asked = false;

    await joinWorkspace(
      db,
      { userId: "u-bob", email: "bob@example.com", name: "Bob" },
      {
        listOrgs: async () => {
          asked = true;
          return [];
        },
      },
    );

    expect(asked).toBe(false);
  });
});

/**
 * A GitLab group is a rule the way a GitHub organization is
 * (docs/plans/sign-in.md slice 5), decided through the same kind of lazy port
 * and holding a path rather than a single label.
 */
describe("a gitlab_group rule", () => {
  it("admits a sign-in whose groups include the rule's value", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await allow(db, "acme/platform", "gitlab_group");
    await db.insert(user).values({ id: "u-bob", name: "Bob", email: "bob@example.org" });

    await joinWorkspace(
      db,
      { userId: "u-bob", email: "bob@example.org", name: "Bob" },
      { listGroups: async () => ["Acme/Platform", "acme"] },
    );

    expect(await db.query.member.findFirst({ where: { userId: "u-bob" } })).toMatchObject({
      role: "member",
    });
  });

  it("turns away a sign-in in none of the allowed groups", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await allow(db, "acme/platform", "gitlab_group");
    await db.insert(user).values({ id: "u-bob", name: "Bob", email: "bob@example.org" });

    await joinWorkspace(
      db,
      { userId: "u-bob", email: "bob@example.org", name: "Bob" },
      // A parent group is not the group the rule names: a rule is a path, and
      // `acme` is not `acme/platform`.
      { listGroups: async () => ["acme", "globex/platform"] },
    );

    expect(await db.query.member.findFirst({ where: { userId: "u-bob" } })).toBeUndefined();
  });

  it("never asks for groups when an email domain already matched", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await allow(db, "example.com");
    await db.insert(user).values({ id: "u-bob", name: "Bob", email: "bob@example.com" });
    let asked = false;

    await joinWorkspace(
      db,
      { userId: "u-bob", email: "bob@example.com", name: "Bob" },
      {
        listGroups: async () => {
          asked = true;
          return [];
        },
      },
    );

    expect(asked).toBe(false);
  });

  it("leaves a sign-in no Member, rather than no sign-in, when GitLab is down", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await allow(db, "acme/platform", "gitlab_group");
    await db.insert(user).values({ id: "u-bob", name: "Bob", email: "bob@example.org" });

    // The join runs inside a Better Auth database hook, so a port that threw
    // would be a sign-in that failed. The Human signs in and asks the admin.
    await joinWorkspace(
      db,
      { userId: "u-bob", email: "bob@example.org", name: "Bob" },
      {
        listGroups: async () => {
          throw new Error("gitlab is down");
        },
      },
    );

    expect(await db.query.member.findFirst({ where: { userId: "u-bob" } })).toBeUndefined();
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
      { userId: "u1", email: "ada@example.com", name: "Ada Lovelace" },
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
    expect(accountLinkingOf({ providers: { github } })).toEqual({
      enabled: true,
      trustedProviders: [],
      // Read only by the link a signed-in session asks for (Settings ›
      // Identities), never by a sign-in: see accountLinkingOf.
      allowDifferentEmails: true,
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
    expect(auth.options.account?.accountLinking).toMatchObject({ allowDifferentEmails: true });
  });

  it("adds no second Member when another account joins a Human who has one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await allow(db, "example.com");
    await db.insert(user).values({ id: "u-bob", name: "Bob Vance", email: "bob@example.com" });
    const bob = { userId: "u-bob", email: "bob@example.com", name: "Bob Vance" };
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
  const signedInWith = async (db: Awaited<ReturnType<typeof testDb>>["db"], providerId: string) => {
    await db.insert(user).values({ id: "u-bob", name: "Bob Vance", email: "bob@example.com" });
    await db.insert(account).values({
      id: authId("account"),
      userId: "u-bob",
      accountId: "bob",
      providerId,
      accessToken: "token",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  };

  /**
   * Both forges page — thirty organizations, twenty groups — so the rule that
   * names the one on the second page matched nothing, which looks exactly like
   * a rule that did not match (docs/plans/sign-in.md).
   */
  it("reads past the first page of the groups a rule may name", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await signedInWith(db, "gitlab");
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      const page = Number(new URL(url).searchParams.get("page"));
      const full = Array.from({ length: 100 }, (_, i) => ({ full_path: `acme/team-${i}` }));
      return Response.json(page === 1 ? full : [{ full_path: "acme/platform" }]);
    });

    const groups = await joinPorts(db, { providers: {} }, "u-bob").listGroups?.();

    expect(groups).toHaveLength(101);
    expect(groups).toContain("acme/platform");
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain("per_page=100&page=1");
    expect(asked[1]).toContain("page=2");
  });

  /**
   * A page the forge refused is not the end of the list: a short list that
   * looks complete makes a rule naming something on the missing page read
   * exactly like a rule that did not match (docs/plans/sign-in.md).
   */
  it("treats a page it could not read as a question with no answer", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await signedInWith(db, "gitlab");
    vi.stubGlobal("fetch", async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page"));
      if (page > 1) return new Response("rate limited", { status: 403 });
      return Response.json(
        Array.from({ length: 100 }, (_, i) => ({ full_path: `acme/team-${i}` })),
      );
    });

    await expect(joinPorts(db, { providers: {} }, "u-bob").listGroups?.()).rejects.toThrow();
  });

  it("stops asking when a page is the last one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await signedInWith(db, "github");
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return Response.json([{ login: "Acme" }]);
    });

    expect(await joinPorts(db, { providers: {} }, "u-bob").listOrgs?.()).toEqual(["Acme"]);
    expect(asked).toHaveLength(1);
  });

  /**
   * The handle a join allocates: slice 5 promised a GitLab username is a
   * handle the way a GitHub login is, and nothing was supplying either
   * (docs/plans/sign-in.md).
   */
  it("hands the join whatever the provider calls this sign-in", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await signedInWith(db, "gitlab");
    vi.stubGlobal("fetch", async (url: string) =>
      new URL(url).pathname === "/api/v4/user"
        ? Response.json({ username: "bvance" })
        : Response.json(null, { status: 404 }),
    );

    expect(await joinPorts(db, { providers: {} }, "u-bob").login?.()).toBe("bvance");
  });

  it("spends no request on a provider this Human never signed in with", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await signedInWith(db, "github");
    let asked = 0;
    vi.stubGlobal("fetch", async () => {
      asked++;
      return Response.json({ login: "bvance" });
    });

    expect(await joinPorts(db, { providers: {} }, "u-bob").login?.()).toBe("bvance");
    // GitHub answered, so GitLab is never asked; a Human with neither account
    // costs no request at all.
    expect(asked).toBe(1);
  });
});
