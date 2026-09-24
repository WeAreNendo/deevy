import { member, oauthClientResource, oauthResource, user, workspace } from "@deevy/db";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { App } from "../src/app.ts";
import { API_PATH, MCP_PATH } from "../src/auth.ts";
import { buildContext, createApp } from "../src/app.ts";
import type { Auth } from "../src/auth.ts";
import { createAuth } from "../src/auth.ts";
import { fetchClientMetadataResource, isPubliclyRoutable } from "../src/cimd.ts";
import { resolvePrincipal } from "../src/principal.ts";
import { testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const secret = "test-secret-that-is-at-least-32-characters";
const baseURL = "https://deevy.example.com";
const resource = `${baseURL}/mcp`;
/**
 * The other protected resource this server issues for: the operation API, which
 * `/api` and `/rpc` are two transports for. A CLI asks for this one; an MCP
 * client asks for the one above; neither token works where the other is spent.
 */
const apiResource = `${baseURL}/api`;
const redirectUri = "http://127.0.0.1:8765/callback";

/** The instance an MCP client would discover: a real Better Auth authorization server. */
function testApp(options: { metadataDocument?: Record<string, unknown> } = {}) {
  const { db, close } = testDb();
  closers.push(close);
  const auth = createAuth({
    db,
    env: {
      baseURL,
      secret,
      providers: { github: { clientId: "github-client", clientSecret: "github-secret" } },
      // A Client ID Metadata Document is dereferenced over the network; the
      // port that does it is the one thing a test stands in for, so the rest
      // of the CIMD path is the real plugin (auth.ts).
      ...(options.metadataDocument
        ? {
            fetchClientMetadataResource: async () =>
              new Response(JSON.stringify(options.metadataDocument), {
                headers: { "content-type": "application/json" },
              }),
          }
        : {}),
    },
  });
  return { db, auth, app: createApp({ db, auth, baseURL }) };
}

/**
 * The headers a signed-in browser sends. Better Auth names the cookie
 * `__Secure-…` on an https instance, so the name comes from the instance
 * rather than being written out.
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
  const name = context.authCookies.sessionToken.name;
  return new Headers({ cookie: `${name}=${encodeURIComponent(value)}` });
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...view))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** One PKCE pair, S256 as OAuth 2.1 and MCP 2026-07-28 both require. */
async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(digest) };
}

/** An MCP client that registered itself, the way Claude Code does over DCR. */
/**
 * `resources` is the DCR extension a client uses to say which protected
 * resources it wants. Omitting it is what an MCP client does, and such a client
 * is linked to the MCP resource alone — asking for the API is what a CLI does,
 * and is the only way to be linked to it (auth.ts).
 */
async function registerClient(app: App, resources?: string[]): Promise<string> {
  const res = await app.request("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude Code",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
      ...(resources ? { resources } : {}),
    }),
  });
  if (res.status !== 201) throw new Error(`register: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { client_id: string }).client_id;
}

interface AuthorizeOptions {
  clientId: string;
  challenge?: string;
  challengeMethod?: string;
  /** RFC 8707, and every caller in this file names one. */
  resource?: string;
}

/** The `/oauth2/authorize` leg, answered as a redirect the browser would follow. */
async function authorize(app: App, cookie: Headers, options: AuthorizeOptions): Promise<Response> {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: redirectUri,
    scope: "openid profile",
    state: "opaque-state",
    ...(options.challenge
      ? {
          code_challenge: options.challenge,
          code_challenge_method: options.challengeMethod ?? "S256",
        }
      : {}),
    ...(options.resource === undefined ? {} : { resource: options.resource }),
  });
  return app.request(`/api/auth/oauth2/authorize?${query}`, { headers: cookie });
}

/** The Human accepting on the consent page, which posts the signed query back. */
async function consent(app: App, cookie: Headers, location: string): Promise<string> {
  const res = await app.request("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { ...Object.fromEntries(cookie), "content-type": "application/json" },
    body: JSON.stringify({ oauth_query: new URL(location, baseURL).search.slice(1), accept: true }),
  });
  if (res.status !== 200) throw new Error(`consent: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { url: string };
  const code = new URL(body.url).searchParams.get("code");
  if (!code) throw new Error(`consent returned no code: ${body.url}`);
  return code;
}

/** The token leg. Returns the raw response so a test can assert on a refusal. */
async function exchange(
  app: App,
  params: { code: string; clientId: string; verifier?: string; resource?: string },
): Promise<Response> {
  return app.request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: redirectUri,
      client_id: params.clientId,
      ...(params.verifier ? { code_verifier: params.verifier } : {}),
      ...(params.resource === undefined ? {} : { resource: params.resource }),
    }).toString(),
  });
}

/** The whole dance, for the tests that only care about what a good token does. */
async function mintToken(
  app: App,
  auth: Auth,
  userId: string,
  options: { resource?: string } = {},
): Promise<{ token: string; clientId: string }> {
  const wanted = options.resource ?? resource;
  // A client is registered for the resource it is about to ask for, which is
  // what a real one does: the API resource is allowed at registration, not
  // handed out by default, so a client that never names it cannot hold a token
  // for it (auth.ts).
  const clientId = await registerClient(app, wanted === resource ? undefined : [wanted]);
  const cookie = await cookieHeaders(auth, userId);
  const { verifier, challenge } = await pkce();
  const redirected = await authorize(app, cookie, { clientId, challenge, resource: wanted });
  const code = await consent(app, cookie, redirected.headers.get("location") ?? "");
  const res = await exchange(app, { code, clientId, verifier, resource: wanted });
  if (res.status !== 200) throw new Error(`token: ${res.status} ${await res.text()}`);
  return { token: ((await res.json()) as { access_token: string }).access_token, clientId };
}

/** The claims of an access token, read the way a resource server would. */
function claimsOf(token: string): { sub: string; aud: string[]; iss: string; client_id: string } {
  const payload = (token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(payload)) as never;
}

/** A Human who is a Member of the Workspace, which is who an MCP client acts as. */
async function humanMember(db: ReturnType<typeof testDb>["db"]) {
  await db.insert(workspace).values({ id: "w1", name: "deevy", slug: "deevy" });
  await db.insert(user).values({ id: "u1", name: "Ada", email: "ada@example.com" });
  await db
    .insert(member)
    .values({ id: "m1", workspaceId: "w1", userId: "u1", role: "admin", kind: "human" });
}

describe("RFC 8414 authorization server metadata", () => {
  it("is served at /.well-known/oauth-authorization-server", async () => {
    const { app } = testApp();
    const res = await app.request("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.issuer).toBe(baseURL);
    expect(body.authorization_endpoint).toBe(`${baseURL}/api/auth/oauth2/authorize`);
    expect(body.token_endpoint).toBe(`${baseURL}/api/auth/oauth2/token`);
    expect(body.jwks_uri).toBe(`${baseURL}/api/auth/jwks`);
    // OAuth 2.1 and the MCP 2026-07-28 revision both make PKCE S256 mandatory.
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(body.client_id_metadata_document_supported).toBe(true);
    // DCR is deprecated in the 2026-07-28 revision but still the only way in
    // for the clients that do not speak CIMD (docs/OPERATIONS.md).
    expect(body.registration_endpoint).toBe(`${baseURL}/api/auth/oauth2/register`);
  });
});

describe("RFC 9728 protected resource metadata", () => {
  it("is served at the root form as well as the path-inserting one", async () => {
    const { app } = testApp();
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.resource).toBe(resource);
      expect(body.authorization_servers).toEqual([baseURL]);
    }
  });
});

describe("the authorization code flow", () => {
  it("mints a token bound to the MCP resource for the Human who consented", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const { token, clientId } = await mintToken(app, auth, "u1");

    const payload = claimsOf(token);
    expect(payload.sub).toBe("u1");
    expect(payload.iss).toBe(baseURL);
    expect(payload.aud).toContain(resource);
    expect(payload.client_id).toBe(clientId);
  });

  it("refuses a code flow that carries no PKCE challenge", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const clientId = await registerClient(app);
    const cookie = await cookieHeaders(auth, "u1");

    const res = await authorize(app, cookie, { clientId, resource });

    // The refusal is the redirect back to the client carrying an OAuth error,
    // which is where RFC 6749 §4.1.2.1 puts it once the redirect_uri is known.
    const location = new URL(res.headers.get("location") ?? "", baseURL);
    expect(location.searchParams.get("error")).toBe("invalid_request");
    expect(location.searchParams.get("error_description")).toMatch(/pkce is required/i);
  });
});

describe("the two resources this server issues for", () => {
  /**
   * The separation the second resource exists to draw. A Human who consents to
   * an MCP client is consenting to the tools deevy projects, not to the
   * ninety-four operations behind them — and a CLI's token is the other way
   * round. Both are signed by deevy, for the same Human, by the same flow;
   * only the audience tells them apart, so both directions are asserted.
   */
  it("refuses an MCP token at the API", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const { token } = await mintToken(app, auth, "u1");
    expect(claimsOf(token).aud).toContain(resource);

    const context = await buildContext(
      db,
      auth,
      new Headers({ authorization: `Bearer ${token}` }),
      baseURL,
      API_PATH,
    );
    expect(context.principal).toEqual({ kind: "anonymous" });
    expect(context.session).toBeNull();
  });

  /**
   * The finding that made this slice worth reviewing. Linking the API resource
   * to every client at registration — which is what
   * `clientRegistrationDefaultResources` does — would have let any MCP client
   * mint a token for the whole operation API without ever asking for one, which
   * is the opposite of what a second resource is for. It is allowed at
   * registration instead, so this is the test that says a client gets the API
   * only by naming it.
   */
  it("refuses the API to a client that registered without asking for it", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    // No `resources`: an MCP client, registering the way Claude Code does.
    const clientId = await registerClient(app);
    const cookie = await cookieHeaders(auth, "u1");
    const { challenge } = await pkce();

    const redirected = await authorize(app, cookie, {
      clientId,
      challenge,
      resource: apiResource,
    });
    // The provider refuses the target rather than issuing a code for it.
    // RFC 8707's own error for "you may not have that resource", rather than
    // any refusal: a redirect carrying a code would mean the link was made.
    const location = redirected.headers.get("location") ?? "";
    expect(location).toContain("invalid_target");
    expect(location).not.toContain("code=");
  });

  it("refuses an API token at MCP", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const { token } = await mintToken(app, auth, "u1", { resource: apiResource });
    expect(claimsOf(token).aud).toContain(apiResource);

    const context = await buildContext(
      db,
      auth,
      new Headers({ authorization: `Bearer ${token}` }),
      baseURL,
      MCP_PATH,
    );
    expect(context.principal).toEqual({ kind: "anonymous" });
  });

  it("still lets an MCP token reach MCP, which is what everything before the CLI did", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const { token } = await mintToken(app, auth, "u1");

    const context = await buildContext(
      db,
      auth,
      new Headers({ authorization: `Bearer ${token}` }),
      baseURL,
      MCP_PATH,
    );
    expect(context.principal).toMatchObject({ kind: "oauth" });
  });

  /**
   * The wiring, not the check. Everything above drives `buildContext` directly
   * and so proves only that `resolvePrincipal` honours the argument it is
   * handed. These go through the routes, which is where the argument is chosen
   * — without them, deleting `MCP_PATH` from mcp/server.ts or `API_PATH` from
   * app.ts leaves every test in the repository passing while the surfaces start
   * accepting each other's tokens.
   */
  it("spends an API token at /rpc, which is the transport a CLI uses", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const { token } = await mintToken(app, auth, "u1", { resource: apiResource });

    const res = await app.request(`${baseURL}/rpc/me/get`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ json: undefined }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { json: { member: { kind: string } | null } };
    expect(body.json.member?.kind).toBe("human");
  });

  it("refuses an MCP token at /rpc", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const { token } = await mintToken(app, auth, "u1");

    const res = await app.request(`${baseURL}/rpc/me/get`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ json: undefined }),
    });
    // me.get wants a session, and this token is nobody here.
    expect(res.status).toBe(401);
  });

  it("refuses an API token at /mcp, which answers with the challenge", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const { token } = await mintToken(app, auth, "u1", { resource: apiResource });

    const res = await app.request(`${baseURL}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(401);
    // RFC 9728: the challenge names where the metadata is, which is what makes
    // a client start the dance rather than simply fail.
    expect(res.headers.get("www-authenticate") ?? "").toContain("resource_metadata");
  });

  /**
   * Better Auth's `mcp()` plugin is the resource server for its own resource
   * and serves RFC 9728 metadata for that one alone; the API resource is
   * configured on the same provider and issued for, but not advertised.
   *
   * That costs the CLI nothing — RFC 9728 exists so a client holding a 401 can
   * find the authorization server, and a CLI is told the instance URL, so it
   * reads `/.well-known/oauth-authorization-server` directly and asks for the
   * API resource by name. This is written down as a test rather than left
   * implicit, so the day the plugin advertises both, somebody notices.
   */
  it("advertises MCP's metadata, and the API resource is reached through the issuer", async () => {
    const { app } = testApp();
    const mcpMetadata = await app.request(`${baseURL}/.well-known/oauth-protected-resource/mcp`);
    expect(mcpMetadata.status).toBe(200);
    expect((await mcpMetadata.json()) as { resource: string }).toMatchObject({ resource });

    const apiMetadata = await app.request(`${baseURL}/.well-known/oauth-protected-resource/api`);
    expect(apiMetadata.status).toBe(404);

    // What the CLI uses instead, and it is enough: the issuer names the
    // endpoints, and the resource is asked for by name at the authorize step.
    const server = await app.request(`${baseURL}/.well-known/oauth-authorization-server`);
    expect(server.status).toBe(200);
    expect((await server.json()) as { issuer: string }).toMatchObject({ issuer: baseURL });
  });
});

describe("RFC 8707 audience validation", () => {
  it("refuses a token this authorization server minted for another resource", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    // A second protected resource on the same issuer, so the token below is
    // genuinely signed by deevy and genuinely not for /mcp: only the audience
    // check stands between it and the MCP surface.
    const other = `${baseURL}/reports`;
    await db
      .insert(oauthResource)
      .values({ id: "r-other", identifier: other, name: "Reports", createdAt: new Date() });
    const clientId = await registerClient(app);
    await db
      .insert(oauthClientResource)
      .values({ id: "cr-other", clientId, resourceId: other, createdAt: new Date() });

    const cookie = await cookieHeaders(auth, "u1");
    const { verifier, challenge } = await pkce();
    const redirected = await authorize(app, cookie, { clientId, challenge, resource: other });
    const code = await consent(app, cookie, redirected.headers.get("location") ?? "");
    const minted = await exchange(app, { code, clientId, verifier, resource: other });
    expect(minted.status).toBe(200);
    const token = ((await minted.json()) as { access_token: string }).access_token;
    // Signed by deevy, for the wrong audience: nothing but the RFC 8707 check
    // separates it from the token the test above resolves.
    expect(claimsOf(token).aud).toContain(other);
    expect(claimsOf(token).aud).not.toContain(resource);

    const resolved = await resolvePrincipal({
      auth,
      headers: new Headers({ authorization: `Bearer ${token}` }),
      baseURL,
      resourcePath: MCP_PATH,
    });
    expect(resolved).toEqual({ principal: { kind: "anonymous" }, session: null });
  });
});

describe("a real token and the sessionOnly rule", () => {
  it("carries the Human everywhere but the consents that delegated it", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const { token } = await mintToken(app, auth, "u1", { resource: apiResource });
    const bearer = { authorization: `Bearer ${token}` };

    // The token is a working credential for that Human: this is not a test of
    // a token that fails to authenticate.
    const who = await app.request("/api/me", { headers: bearer });
    expect(who.status).toBe(200);
    expect(((await who.json()) as { member: { id: string } }).member.id).toBe("m1");

    /*
     * And it still cannot enumerate the consents that delegated it. A
     * delegated credential listing or revoking its own siblings is the other
     * shape `sessionOnly` refuses (ADR-0010's consequences), and it is the one
     * that carries the rule while a Gate is being re-made as a request on a
     * Run (docs/plans/sockets.md, slice 2). The check is in the middleware, so
     * what is refused is the credential rather than the request.
     */
    const consents = await app.request("/api/oauth-clients", { headers: bearer });
    expect(consents.status).toBe(403);
    expect((await consents.json()) as { message: string }).toMatchObject({
      message: "Only a Human signed in to deevy can do that",
    });
  });
});

describe("resolvePrincipal with an access token", () => {
  it("resolves a valid token to that Human's Member as an oauth principal", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const { token, clientId } = await mintToken(app, auth, "u1", { resource: apiResource });

    const context = await buildContext(
      db,
      auth,
      new Headers({ authorization: `Bearer ${token}` }),
      baseURL,
      API_PATH,
    );
    expect(context.principal).toEqual({
      kind: "oauth",
      clientId,
      scopes: ["openid", "profile"],
    });
    expect(context.member?.id).toBe("m1");
    expect(context.session?.user.id).toBe("u1");
  });
});

describe("Client ID Metadata Documents", () => {
  it("lets a client identify itself by URL, with no registration step at all", async () => {
    // MCP 2026-07-28 prefers this over DCR: the client_id *is* an HTTPS URL,
    // and the document at it is the registration (docs/research/mcp-spec-2026-07-28.md).
    const clientId = "https://claude.ai/mcp/client";
    const { db, auth, app } = testApp({
      metadataDocument: {
        client_id: clientId,
        client_name: "Claude Code",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "native",
      },
    });
    await humanMember(db);

    const cookie = await cookieHeaders(auth, "u1");
    const { verifier, challenge } = await pkce();
    const redirected = await authorize(app, cookie, { clientId, challenge, resource });
    const code = await consent(app, cookie, redirected.headers.get("location") ?? "");
    const minted = await exchange(app, { code, clientId, verifier, resource });
    expect(minted.status).toBe(200);
    const token = ((await minted.json()) as { access_token: string }).access_token;

    const resolved = await resolvePrincipal({
      auth,
      headers: new Headers({ authorization: `Bearer ${token}` }),
      baseURL,
      resourcePath: MCP_PATH,
    });
    expect(resolved.principal).toEqual({ kind: "oauth", clientId, scopes: ["openid", "profile"] });
  });
});

describe("oauthClients", () => {
  it("lists the Human's own consents and revokes one", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const { token, clientId } = await mintToken(app, auth, "u1", { resource: apiResource });
    // Consents are managed in the browser. A client that could list and revoke
    // them would be able to cut off the Human's other clients, so the token
    // this very flow minted is refused here (ADR-0010).
    const viaToken = await app.request("/api/oauth-clients", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(viaToken.status).toBe(403);

    const cookie = Object.fromEntries(await cookieHeaders(auth, "u1"));
    const bearer = cookie;

    const listed = await app.request("/api/oauth-clients", { headers: bearer });
    expect(listed.status).toBe(200);
    const { clients } = (await listed.json()) as {
      clients: Array<{ clientId: string; name: string; scopes: string[] }>;
    };
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ clientId, name: "Claude Code" });
    expect(clients[0]?.scopes).toEqual(["openid", "profile"]);

    const revoked = await app.request(`/api/oauth-clients/${clientId}`, {
      method: "DELETE",
      headers: bearer,
    });
    expect(revoked.status).toBe(200);

    const again = await app.request("/api/oauth-clients", { headers: bearer });
    expect((await again.json()) as { clients: unknown[] }).toEqual({ clients: [] });
  });

  it("does not let one Human revoke another's consent", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const { clientId } = await mintToken(app, auth, "u1");
    await db.insert(user).values({ id: "u2", name: "Bo", email: "bo@example.com" });
    await db
      .insert(member)
      .values({ id: "m2", workspaceId: "w1", userId: "u2", role: "member", kind: "human" });

    const res = await app.request(`/api/oauth-clients/${clientId}`, {
      method: "DELETE",
      headers: await cookieHeaders(auth, "u2"),
    });
    expect(res.status).toBe(404);
  });
});

describe("me.get", () => {
  it("says how the caller arrived", async () => {
    const { db, auth, app } = testApp();
    await humanMember(db);
    const { token } = await mintToken(app, auth, "u1", { resource: apiResource });

    const viaToken = await app.request("/api/me", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(((await viaToken.json()) as { principal: string }).principal).toBe("oauth");

    const viaBrowser = await app.request("/api/me", { headers: await cookieHeaders(auth, "u1") });
    expect(((await viaBrowser.json()) as { principal: string }).principal).toBe("cookie");
  });
});

describe("the client metadata transport", () => {
  it("refuses everything a metadata document must never be fetched from", async () => {
    for (const host of [
      "localhost",
      "deevy.local",
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.5",
      "172.16.4.2",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "internal",
    ]) {
      expect(isPubliclyRoutable(host), host).toBe(false);
    }
    for (const host of ["claude.ai", "example.com", "8.8.8.8", "2606:4700::1111"]) {
      expect(isPubliclyRoutable(host), host).toBe(true);
    }
  });

  it("refuses a metadata URL that is not https, whatever the host", async () => {
    await expect(fetchClientMetadataResource("http://claude.ai/mcp")).rejects.toThrow(/https/);
    await expect(fetchClientMetadataResource("https://127.0.0.1/mcp")).rejects.toThrow(
      /Refusing to fetch/,
    );
  });
});
