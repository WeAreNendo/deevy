import { member, user, workspace } from "@deevy/db";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import type { App } from "../src/app.ts";
import { createAuth } from "../src/auth.ts";
import type { Auth } from "../src/auth.ts";
import { basePathOf, wellKnownURL } from "../src/base-path.ts";
import { testDb } from "./helpers.ts";

/**
 * A deployment under a path (docs/plans/hosted.md): a hosted Workspace at
 * `app.example.com/acme`, or a self-hosted deevy an operator serves at
 * `company.com/deevy`. Everything it answers is under the path of its URL, and
 * the documents RFC 8414 and RFC 9728 put at the root of the host name it.
 */

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const secret = "test-secret-that-is-at-least-32-characters";
const host = "https://app.example.com";
const baseURL = `${host}/acme`;
const redirectUri = "http://127.0.0.1:8765/callback";

function testApp(url = baseURL) {
  const { db, close } = testDb();
  closers.push(close);
  const auth = createAuth({
    db,
    env: {
      baseURL: url,
      secret,
      providers: { github: { clientId: "github-client", clientSecret: "github-secret" } },
    },
  });
  return { db, auth, app: createApp({ db, auth, baseURL: url, version: "1.2.3" }) };
}

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
  return new Headers({
    cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(value)}`,
  });
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...view))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function humanMember(db: ReturnType<typeof testDb>["db"]) {
  await db.insert(workspace).values({ id: "w1", name: "Acme", slug: "acme" });
  await db.insert(user).values({ id: "u1", name: "Ada", email: "ada@example.com" });
  await db
    .insert(member)
    .values({ id: "m1", workspaceId: "w1", userId: "u1", role: "admin", kind: "human" });
}

/** The whole authorization code flow, every leg under the path. */
async function mintToken(app: App, auth: Auth, resource: string): Promise<string> {
  const registered = await app.request("/acme/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude Code",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
      ...(resource.endsWith("/api") ? { resources: [resource] } : {}),
    }),
  });
  expect(registered.status).toBe(201);
  const clientId = ((await registered.json()) as { client_id: string }).client_id;

  const cookie = await cookieHeaders(auth, "u1");
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const authorized = await app.request(
    `/acme/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "openid profile",
      state: "opaque-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
    })}`,
    { headers: cookie },
  );
  const location = authorized.headers.get("location") ?? "";
  // The consent page is the SPA's, under the path the deployment lives under.
  expect(new URL(location, host).pathname).toBe("/acme/consent");

  const consented = await app.request("/acme/api/auth/oauth2/consent", {
    method: "POST",
    headers: { ...Object.fromEntries(cookie), "content-type": "application/json" },
    body: JSON.stringify({ oauth_query: new URL(location, host).search.slice(1), accept: true }),
  });
  expect(consented.status).toBe(200);
  const code = new URL(((await consented.json()) as { url: string }).url).searchParams.get("code");

  const exchanged = await app.request("/acme/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code ?? "",
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    }).toString(),
  });
  expect(exchanged.status).toBe(200);
  return ((await exchanged.json()) as { access_token: string }).access_token;
}

describe("the path a deployment lives under", () => {
  it("is the path of its URL, and nothing at the root of a host", () => {
    expect(basePathOf(undefined)).toBe("");
    expect(basePathOf("https://deevy.example.com")).toBe("");
    expect(basePathOf("https://deevy.example.com/")).toBe("");
    expect(basePathOf("https://app.example.com/acme")).toBe("/acme");
    expect(basePathOf("https://company.example.com/tools/deevy/")).toBe("/tools/deevy");
  });

  it("puts the well-known segment between the host and the path", () => {
    expect(wellKnownURL("https://app.example.com/acme", "oauth-authorization-server")).toBe(
      "https://app.example.com/.well-known/oauth-authorization-server/acme",
    );
    expect(wellKnownURL("https://deevy.example.com", "oauth-protected-resource")).toBe(
      "https://deevy.example.com/.well-known/oauth-protected-resource",
    );
  });
});

describe("a deployment under a path", () => {
  it("answers under the path, and nowhere else but its health check", async () => {
    const { app } = testApp();
    expect((await app.request("/acme/healthz")).status).toBe(200);
    // A container's health check need not know what a proxy serves it under.
    expect((await app.request("/healthz")).status).toBe(200);

    const ping = await app.request("/acme/rpc/health/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: undefined }),
    });
    expect(ping.status).toBe(200);
    expect((await app.request("/acme/api/health/ping")).status).toBe(200);

    expect((await app.request("/api/health/ping")).status).toBe(404);
    expect(
      (
        await app.request("/rpc/health/ping", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: undefined }),
        })
      ).status,
    ).toBe(404);
  });

  it("describes its API as living under the path", async () => {
    const { app } = testApp();
    const spec = (await (await app.request("/acme/api/spec.json")).json()) as {
      servers: Array<{ url: string }>;
    };
    expect(spec.servers).toEqual([{ url: "/acme/api" }]);
  });

  it("is its own OAuth issuer, discovered with the path inserted after the host", async () => {
    const { app } = testApp();
    for (const path of [
      "/.well-known/oauth-authorization-server/acme",
      "/acme/.well-known/oauth-authorization-server",
    ]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.issuer).toBe(baseURL);
      expect(body.authorization_endpoint).toBe(`${baseURL}/api/auth/oauth2/authorize`);
      expect(body.token_endpoint).toBe(`${baseURL}/api/auth/oauth2/token`);
      expect(body.jwks_uri).toBe(`${baseURL}/api/auth/jwks`);
      expect(body.registration_endpoint).toBe(`${baseURL}/api/auth/oauth2/register`);
    }
  });

  it("describes its MCP resource at the path-inserted URL its challenge names", async () => {
    const { app } = testApp();
    const metadata = await app.request("/.well-known/oauth-protected-resource/acme/mcp");
    expect(metadata.status).toBe(200);
    const body = (await metadata.json()) as Record<string, unknown>;
    expect(body.resource).toBe(`${baseURL}/mcp`);
    expect(body.authorization_servers).toEqual([baseURL]);

    const challenged = await app.request("/acme/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(challenged.status).toBe(401);
    expect(challenged.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${host}/.well-known/oauth-protected-resource/acme/mcp"`,
    );
  });

  it("mints tokens for its own issuer and audience, and spends them under the path", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const token = await mintToken(app, auth, `${baseURL}/api`);
    const claims = JSON.parse(
      atob((token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/")),
    ) as { iss: string; aud: string[] };
    expect(claims.iss).toBe(baseURL);
    expect(claims.aud).toContain(`${baseURL}/api`);

    const me = await app.request("/acme/api/me", { headers: { authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
  });

  it("keeps its session cookie to its own path", async () => {
    const { auth } = testApp();
    const context = await auth.$context;
    expect(context.authCookies.sessionToken.attributes.path).toBe("/acme");

    const { auth: atTheRoot } = testApp("https://deevy.example.com");
    expect((await atTheRoot.$context).authCookies.sessionToken.attributes.path).toBe("/");
  });

  it("starts a sign-in whose callback is under the path", async () => {
    const { app } = testApp();
    const started = await app.request(`${baseURL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", callbackURL: "/acme/" }),
    });
    expect(started.status).toBe(200);
    const { url } = (await started.json()) as { url: string };
    expect(new URL(url).searchParams.get("redirect_uri")).toBe(
      `${baseURL}/api/auth/callback/github`,
    );
  });
});
