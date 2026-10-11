import { allowlistRule, user } from "@deevy/db";
import { ORPCError, createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { App } from "../src/app.ts";
import type { AppRouter } from "../src/operations/index.ts";
import { createApp } from "../src/app.ts";
import type { Auth } from "../src/auth.ts";
import { createAuth } from "../src/auth.ts";
import { testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const secret = "test-secret-that-is-at-least-32-characters";
const baseURL = "https://deevy.example.com";
/** Where the SPA is served when it is not the API's own origin (`DEEVY_WEB_ORIGIN`). */
const webOrigin = "https://app.example.org";
const adminEmail = "ada@example.com";

/**
 * The app a deployment builds, with Ada signed in as its admin: her first
 * session bootstraps the Workspace, so a write she makes changes something.
 */
async function signedIn({ configured = true } = {}): Promise<{
  app: App;
  auth: Auth;
  cookie: string;
  db: ReturnType<typeof testDb>["db"];
}> {
  const { db, close } = testDb();
  closers.push(close);
  const auth = createAuth({
    db,
    env: { ...(configured ? { baseURL } : {}), secret, adminEmail },
  });
  const app = configured
    ? createApp({ db, auth, baseURL, origin: [webOrigin, baseURL] })
    : createApp({ db, auth });
  await db
    .insert(user)
    .values({ id: "u-ada", name: "Ada", email: adminEmail, emailVerified: true });
  return { app, auth, cookie: await sessionCookie(auth, "u-ada"), db };
}

/** Better Auth's session cookie for a new session: the token, signed with the secret. */
async function sessionCookie(auth: Auth, userId: string): Promise<string> {
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
  return `${context.authCookies.sessionToken.name}=${encodeURIComponent(value)}`;
}

/** What a page on another site makes the browser send: the cookie rides along. */
const fromAnotherSite = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };
/** What deevy's own page sends. */
const fromDeevy = { origin: baseURL, "sec-fetch-site": "same-origin" };

const addRule = (app: App, headers: Record<string, string>) =>
  app.request("/rpc/allowlist/add", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ json: { kind: "email_domain", value: "example.com" } }),
  });

describe("a change signed in with the session cookie", () => {
  it("is refused from a page on another site, and changes nothing", async () => {
    const { app, cookie, db } = await signedIn();

    const res = await addRule(app, { cookie, ...fromAnotherSite });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { json: { code: string; message: string } };
    expect(body.json.code).toBe("FORBIDDEN");
    expect(await db.select().from(allowlistRule)).toEqual([]);
  });

  it("is taken from deevy's own page", async () => {
    const { app, cookie, db } = await signedIn();

    const res = await addRule(app, { cookie, ...fromDeevy });

    expect(res.status).toBe(200);
    expect(await db.select().from(allowlistRule)).toHaveLength(1);
  });

  it("is taken from the SPA's own origin when it is served from one of its own", async () => {
    const { app, cookie } = await signedIn();

    // A different site altogether, so the browser says cross-site: the
    // configured origin is what vouches for it, as it does for CORS.
    const res = await addRule(app, { cookie, origin: webOrigin, "sec-fetch-site": "cross-site" });

    expect(res.status).toBe(200);
  });

  it("is taken from an older browser that names deevy's origin but not the fetch site", async () => {
    const { app, cookie } = await signedIn();

    expect((await addRule(app, { cookie, origin: baseURL })).status).toBe(200);
  });

  /**
   * An instance told no origin answers on whichever one it was reached on, so
   * that is the one its own page names — over plain http on a LAN, where the
   * browser sends no `Sec-Fetch-Site` at all.
   */
  it("is taken from the origin it arrived on, where no origin was configured", async () => {
    const { app, cookie } = await signedIn({ configured: false });
    const add = (origin: string) =>
      app.request("http://deevy.lan:3000/rpc/allowlist/add", {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin },
        body: JSON.stringify({ json: { kind: "email_domain", value: "example.com" } }),
      });

    expect((await add("http://evil.lan:3000")).status).toBe(403);
    expect((await add("http://deevy.lan:3000")).status).toBe(200);
  });

  it("is refused from a sibling subdomain, which SameSite counts as the same site", async () => {
    const { app, cookie } = await signedIn();

    const res = await addRule(app, {
      cookie,
      origin: "https://other.example.com",
      "sec-fetch-site": "same-site",
    });

    expect(res.status).toBe(403);
  });

  /**
   * The refusal is in the RPC wire format, so a client — the SPA's among them
   * — reads it as the error it is rather than as a response it cannot parse.
   */
  it("is refused in words an oRPC client reads", async () => {
    const { app, cookie } = await signedIn();
    const link = new RPCLink({
      origin: baseURL,
      url: "/rpc",
      headers: { cookie, ...fromAnotherSite },
      fetch: async (url, init) => app.request(url, init),
    });
    const client: RouterClient<AppRouter> = createORPCClient(link);

    const refused = await client.allowlist.add({ kind: "email_domain", value: "example.com" }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refused).toBeInstanceOf(ORPCError);
    const error = refused as ORPCError<string, unknown>;
    expect(error.code).toBe("FORBIDDEN");
    expect(error.message).toContain("its own pages");
  });

  it("is refused when it says nowhere where it came from", async () => {
    const { app, cookie } = await signedIn();

    expect((await addRule(app, { cookie })).status).toBe(403);
  });

  it("is refused on the OpenAPI surface too", async () => {
    const { app, cookie, db } = await signedIn();

    const res = await app.request("/api/allowlist", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, ...fromAnotherSite },
      body: JSON.stringify({ kind: "email_domain", value: "example.com" }),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("FORBIDDEN");
    expect(await db.select().from(allowlistRule)).toEqual([]);
  });

  it("can still be read from anywhere CORS lets read it", async () => {
    const { app, cookie } = await signedIn();

    const res = await app.request("/api/me", { headers: { cookie, ...fromAnotherSite } });

    expect(res.status).toBe(200);
  });
});

describe("a bearer", () => {
  it("is unaffected wherever the request says it came from", async () => {
    const { app, auth, db } = await signedIn();
    await db
      .insert(user)
      .values({ id: "u-planner", name: "Planner", email: "planner@example.com", kind: "agent" });
    const issued = await auth.api.createApiKey({ body: { userId: "u-planner", name: "loop" } });

    const res = await app.request("/rpc/health/ping", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issued.key}`,
        ...fromAnotherSite,
      },
      body: JSON.stringify({ json: {} }),
    });

    expect(res.status).toBe(200);
  });
});

describe("/mcp", () => {
  /**
   * An MCP client holds a bearer. The endpoint answers no CORS question
   * before it acts, so a session cookie there would let any page a signed-in
   * Human opened call the tools as them.
   */
  it("takes no session cookie: a browser's is the challenge, not a caller", async () => {
    const { app, cookie } = await signedIn();

    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        cookie,
        ...fromDeevy,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") ?? "").toContain("resource_metadata=");
  });
});
