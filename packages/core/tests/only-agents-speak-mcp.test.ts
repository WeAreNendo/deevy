import { afterEach, describe, expect, it } from "vite-plus/test";
import type { App } from "../src/app.ts";
import { createApp } from "../src/app.ts";
import { createAuth, type Auth } from "../src/auth.ts";
import { agentContext, memberContext, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * Only an Agent speaks MCP (docs/plans/simplify.md, slice 9; ADR-0035). deevy
 * is no OAuth authorization server: it mints no access token, registers no
 * client and asks nobody to consent, so a Human's surface is the browser, the
 * tracker and the chat channel, and `/mcp` takes an Agent's key and nothing
 * else. A key stands only for an Agent, so no Human holds a credential that
 * could rule for them without them (ADR-0010).
 */

const secret = "test-secret-that-is-at-least-32-characters";
const baseURL = "https://deevy.example.com";

async function workspace() {
  const { db, close } = testDb();
  closers.push(close);
  const auth = createAuth({
    db,
    env: {
      baseURL,
      secret,
      providers: { github: { clientId: "github-client", clientSecret: "github-secret" } },
    },
  });
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const planner = await agentContext(db, { sponsor: ada.member, name: "Planner" });
  const agentKey = (
    await auth.api.createApiKey({ body: { userId: planner.member.userId, name: "laptop" } })
  ).key;
  // Better Auth would mint a key for anybody it is asked to; this is the one a
  // Human could have had before, standing in for any that comes back.
  const humanKey = (
    await auth.api.createApiKey({ body: { userId: ada.member.userId, name: "mine" } })
  ).key;
  const app = createApp({ db, auth, baseURL });
  return { db, auth, app, ada, planner, agentKey, humanKey };
}

/** The headers a signed-in browser sends, cookie named as this instance names it. */
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
  const name = context.authCookies.sessionToken.name;
  return new Headers({ cookie: `${name}=${encodeURIComponent(value)}`, origin: baseURL });
}

/** One 2026-07-28 `tools/list`, with whatever credential the headers carry. */
async function listTools(app: App, headers: Headers): Promise<Response> {
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json, text/event-stream");
  headers.set("mcp-protocol-version", "2026-07-28");
  headers.set("mcp-method", "tools/list");
  return await app.request("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "0" },
        },
      },
    }),
  });
}

const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` });

describe("/mcp", () => {
  it("answers an Agent's key with the fourteen tools", async () => {
    const { app, agentKey } = await workspace();

    const answered = await listTools(app, bearer(agentKey));

    expect(answered.status).toBe(200);
    const { result } = (await answered.json()) as { result: { tools: Array<{ name: string }> } };
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "gates_get",
      "gates_request",
      "inbox_list",
      "issues_get",
      "issues_list",
      "links_add",
      "links_list",
      "links_remove",
      "projects_get",
      "runs_finish",
      "runs_get",
      "runs_list",
      "runs_post_activity",
      "runs_start",
    ]);
  });

  it("is 401 to a Human's session cookie, and starts no OAuth", async () => {
    const { app, auth, ada } = await workspace();

    const answered = await listTools(app, await cookieHeaders(auth, ada.member.userId));

    expect(answered.status).toBe(401);
    // No Protected Resource Metadata to go and read: there is no
    // authorization server behind it, so a client is told what to bring.
    expect(answered.headers.get("www-authenticate")).toBe('Bearer realm="deevy"');
    expect(await answered.json()).toMatchObject({
      error_description: "This MCP endpoint takes an Agent's API key",
    });
  });

  it("is 401 to a bearer that is not an Agent's key, a Human's own key included", async () => {
    const { app, humanKey } = await workspace();

    for (const token of [humanKey, "eyJhbGciOiJFUzI1NiJ9.e30.c2lnbmF0dXJl", "deevy_sk_nope"]) {
      expect((await listTools(app, bearer(token))).status, token.slice(0, 12)).toBe(401);
    }
  });
});

describe("a key", () => {
  it("stands only for an Agent: a Human's is nobody on the API too", async () => {
    const { app, agentKey, humanKey } = await workspace();

    expect((await app.request("/api/me", { headers: bearer(agentKey) })).status).toBe(200);
    expect((await app.request("/api/me", { headers: bearer(humanKey) })).status).toBe(401);
  });

  it("is never minted by a signed-in Human through Better Auth's own routes", async () => {
    const { app, auth, ada } = await workspace();
    const headers = await cookieHeaders(auth, ada.member.userId);
    headers.set("content-type", "application/json");

    const minted = await app.request("/api/auth/api-key/create", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "mine" }),
    });

    expect(minted.status).toBe(404);
  });
});

describe("the OAuth authorization server", () => {
  it("is gone: no discovery, no registration, no keys and no clients to list", async () => {
    const { app, auth, ada } = await workspace();
    const cookie = await cookieHeaders(auth, ada.member.userId);

    for (const path of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/openid-configuration",
      "/api/auth/jwks",
      "/api/auth/oauth2/authorize",
    ]) {
      expect((await app.request(path)).status, path).toBe(404);
    }
    const registered = await app.request("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude Code", redirect_uris: ["http://127.0.0.1/cb"] }),
    });
    expect(registered.status).toBe(404);
    expect((await app.request("/api/oauth-clients", { headers: cookie })).status).toBe(404);
  });
});
