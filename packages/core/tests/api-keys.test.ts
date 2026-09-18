import { afterEach, describe, expect, it } from "vite-plus/test";
import { buildContext } from "../src/app.ts";
import { createAuth } from "../src/auth.ts";
import { apiKeysOf, betterAuthKeys } from "../src/keys.ts";
import { API_PATH } from "../src/auth.ts";
import { resolvePrincipal } from "../src/principal.ts";
import { agentContext, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

function testAuth() {
  const { db, close } = testDb();
  closers.push(close);
  const auth = createAuth({
    db,
    env: {
      baseURL: "http://localhost:3000",
      secret: "test-secret-that-is-at-least-32-characters",
      providers: { github: { clientId: "github-client", clientSecret: "github-secret" } },
    },
  });
  return { db, auth };
}

describe("API keys over Better Auth", () => {
  it("issues a key that then authenticates the Agent it was issued for", async () => {
    const { db, auth } = testAuth();
    const agent = await agentContext(db);
    const keys = betterAuthKeys(auth, db);

    const issued = await keys.issue({ userId: agent.member.userId, name: "ci" });
    expect(issued.key).toMatch(/^deevy_sk_/);

    const resolved = await resolvePrincipal({
      auth,
      resourcePath: API_PATH,
      headers: new Headers({ authorization: `Bearer ${issued.key}` }),
    });
    expect(resolved.principal).toMatchObject({ kind: "api_key" });
    expect(resolved.session?.user.id).toBe(agent.member.userId);
  });

  it("lists an Agent's own keys without their plaintext, and stops a revoked one", async () => {
    const { db, auth } = testAuth();
    const agent = await agentContext(db);
    const other = await agentContext(db, { name: "Builder" });
    const keys = betterAuthKeys(auth, db);

    const issued = await keys.issue({ userId: agent.member.userId, name: "ci" });
    await keys.issue({ userId: other.member.userId, name: "theirs" });

    const mine = await keys.list({ userId: agent.member.userId });
    expect(mine.map((k) => k.name)).toEqual(["ci"]);
    expect(JSON.stringify(mine)).not.toContain(issued.key);

    expect(await keys.revoke({ userId: agent.member.userId, keyId: issued.id })).toBe(true);
    const after = await resolvePrincipal({
      auth,
      resourcePath: API_PATH,
      headers: new Headers({ authorization: `Bearer ${issued.key}` }),
    });
    expect(after.principal).toEqual({ kind: "anonymous" });
  });

  it("refuses to revoke a key belonging to another Agent", async () => {
    const { db, auth } = testAuth();
    const agent = await agentContext(db);
    const other = await agentContext(db, { name: "Builder" });
    const keys = betterAuthKeys(auth, db);

    const theirs = await keys.issue({ userId: other.member.userId, name: "theirs" });
    expect(await keys.revoke({ userId: agent.member.userId, keyId: theirs.id })).toBe(false);
  });
});

describe("the request context", () => {
  it("carries a key store when the instance has auth, so a Sponsor can issue", async () => {
    const { db, auth } = testAuth();
    const context = await buildContext(db, auth, new Headers(), undefined, API_PATH);
    expect(context.apiKeys).toBeDefined();
  });

  it("carries none when the instance has no auth, and says so rather than failing oddly", async () => {
    const { db } = testAuth();
    const context = await buildContext(db, undefined, new Headers(), undefined, API_PATH);
    expect(context.apiKeys).toBeUndefined();
    expect(() => apiKeysOf(context)).toThrow(/cannot issue API keys/);
  });
});
