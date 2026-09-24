import { member, project, projectGrant, socket, user, workspace } from "@deevy/db";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Auth } from "../src/auth.ts";
import { buildContext, createApp } from "../src/app.ts";
import { createAuth } from "../src/auth.ts";
import { API_PATH } from "../src/auth.ts";
import { resolvePrincipal } from "../src/principal.ts";
import { testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const secret = "test-secret-that-is-at-least-32-characters";

/** A real Better Auth instance on an in-memory database, the way the server builds it. */
function testAuth() {
  const { db, close } = testDb();
  closers.push(close);
  const auth = createAuth({
    db,
    env: {
      baseURL: "http://localhost:3000",
      secret,
      providers: { github: { clientId: "github-client", clientSecret: "github-secret" } },
    },
  });
  return { db, auth };
}

/**
 * The headers a signed-in browser sends: Better Auth's session cookie is the
 * session token signed with the instance secret (better-call's cookie format).
 */
async function cookieHeaders(auth: Auth, userId: string): Promise<Headers> {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(session.token));
  const value = `${session.token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
  return new Headers({ cookie: `better-auth.session_token=${encodeURIComponent(value)}` });
}

describe("resolvePrincipal", () => {
  it("is anonymous when the request carries no credential", async () => {
    const { auth } = testAuth();
    const resolved = await resolvePrincipal({
      auth,
      headers: new Headers(),
      resourcePath: API_PATH,
    });
    expect(resolved).toEqual({ principal: { kind: "anonymous" }, session: null });
  });

  it("is an api_key principal for an Agent's key on the Authorization header", async () => {
    const { db, auth } = testAuth();
    await db
      .insert(user)
      .values({ id: "a1", name: "Planner", email: "planner@example.com", kind: "agent" });
    const issued = await auth.api.createApiKey({ body: { userId: "a1", name: "laptop" } });
    expect(issued.key.startsWith("deevy_sk_")).toBe(true);

    const headers = new Headers({ authorization: `Bearer ${issued.key}` });
    const resolved = await resolvePrincipal({ auth, headers, resourcePath: API_PATH });
    expect(resolved.principal).toEqual({ kind: "api_key", keyId: issued.id });
    expect(resolved.session?.user.id).toBe("a1");
  });

  it("does not rate limit an agent loop: the eleventh call is as good as the first", async () => {
    const { db, auth } = testAuth();
    await db
      .insert(user)
      .values({ id: "a1", name: "Planner", email: "planner@example.com", kind: "agent" });
    const issued = await auth.api.createApiKey({ body: { userId: "a1", name: "loop" } });
    const headers = new Headers({ authorization: `Bearer ${issued.key}` });

    // The plugin's own default is ten requests a day, which would silently 429
    // a working Agent; deevy rate limits at the edge instead (docs/plans/m2.md).
    for (let call = 0; call < 12; call++) {
      const resolved = await resolvePrincipal({ auth, headers, resourcePath: API_PATH });
      expect(resolved.principal).toEqual({ kind: "api_key", keyId: issued.id });
    }
  });

  it("is a cookie principal for a Human signed in to deevy", async () => {
    const { db, auth } = testAuth();
    await db.insert(user).values({ id: "u1", name: "Ada", email: "ada@example.com" });
    const headers = await cookieHeaders(auth, "u1");

    const resolved = await resolvePrincipal({ auth, headers, resourcePath: API_PATH });
    expect(resolved.principal).toEqual({ kind: "cookie" });
    expect(resolved.session?.user.id).toBe("u1");
  });

  it("never falls through to the cookie when a bearer is present", async () => {
    const { db, auth } = testAuth();
    await db.insert(user).values({ id: "u1", name: "Ada", email: "ada@example.com" });

    // Something offered as an access token, and the Human's own cookie sitting
    // beside it. The cookie must not answer for the bearer, whether or not
    // this instance is an authorization server at all.
    const headers = await cookieHeaders(auth, "u1");
    headers.set("authorization", "Bearer not-a-deevy-key");
    expect(await resolvePrincipal({ auth, headers, resourcePath: API_PATH })).toEqual({
      principal: { kind: "anonymous" },
      session: null,
    });
    expect(
      await resolvePrincipal({
        auth,
        headers,
        baseURL: "http://localhost:3000",
        resourcePath: API_PATH,
      }),
    ).toEqual({
      principal: { kind: "anonymous" },
      session: null,
    });
  });

  it("is anonymous for a key that was never issued, cookie or no cookie", async () => {
    const { db, auth } = testAuth();
    await db.insert(user).values({ id: "u1", name: "Ada", email: "ada@example.com" });
    const headers = await cookieHeaders(auth, "u1");
    headers.set("authorization", `Bearer deevy_sk_${"z".repeat(64)}`);

    expect(await resolvePrincipal({ auth, headers, resourcePath: API_PATH })).toEqual({
      principal: { kind: "anonymous" },
      session: null,
    });
  });
});

/** An Agent Member, its Better Auth user, and a Project it is granted. */
async function agentWithKey(db: ReturnType<typeof testDb>["db"], auth: Auth) {
  await db.insert(workspace).values({ id: "w1", name: "deevy", slug: "deevy" });
  await db
    .insert(user)
    .values({ id: "a1", name: "Planner", email: "planner@example.com", kind: "agent" });
  await db
    .insert(member)
    .values({ id: "m1", workspaceId: "w1", userId: "a1", role: "member", kind: "agent" });
  await db.insert(socket).values({
    id: "sock1",
    workspaceId: "w1",
    provider: "stub",
    capabilities: ["tracker"],
    name: "Example tracker",
    identity: { login: "deevy", id: "bot-1", mentionHandle: "@deevy" },
    config: {},
  });
  const bound = (id: string, slug: string, scopeKey: string) => ({
    id,
    workspaceId: "w1",
    slug,
    name: slug,
    trackerSocketId: "sock1",
    trackerScope: { scopeKey },
    trackerScopeKey: `stub:${scopeKey}`,
  });
  await db.insert(project).values(bound("p1", "deevy", "acme/deevy"));
  await db.insert(project).values(bound("p2", "ops", "acme/ops"));
  await db.insert(projectGrant).values({ memberId: "m1", projectId: "p1" });
  const issued = await auth.api.createApiKey({ body: { userId: "a1", name: "laptop" } });
  return issued.key;
}

describe("createApp with an API key", () => {
  it("answers as the Agent Member the key belongs to", async () => {
    const { db, auth } = testAuth();
    const key = await agentWithKey(db, auth);
    const app = createApp({ db, auth });

    const res = await app.request("/api/me", { headers: { authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { member: { id: string } | null };
    expect(body.member?.id).toBe("m1");
  });
});

describe("buildContext", () => {
  it("carries the principal and scopes an Agent to its granted Projects", async () => {
    const { db, auth } = testAuth();
    const key = await agentWithKey(db, auth);

    const context = await buildContext(
      db,
      auth,
      new Headers({ authorization: `Bearer ${key}` }),
      undefined,
      API_PATH,
    );
    expect(context.principal?.kind).toBe("api_key");
    expect(context.member?.id).toBe("m1");
    expect(context.grantedProjectIds).toEqual(["p1"]);
  });

  it("leaves a Human unscoped and costs them no grant query", async () => {
    const { db, auth } = testAuth();
    await agentWithKey(db, auth);
    await db.insert(user).values({ id: "u1", name: "Ada", email: "ada@example.com" });
    await db
      .insert(member)
      .values({ id: "m2", workspaceId: "w1", userId: "u1", role: "admin", kind: "human" });

    const context = await buildContext(
      db,
      auth,
      await cookieHeaders(auth, "u1"),
      undefined,
      API_PATH,
    );
    expect(context.principal).toEqual({ kind: "cookie" });
    expect(context.member?.id).toBe("m2");
    expect(context.grantedProjectIds).toBeNull();
  });
});
