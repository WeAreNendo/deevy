import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { createAuth } from "../src/auth.ts";
import { basePathOf } from "../src/base-path.ts";
import { SCALAR_SCRIPT, docsPolicy } from "../src/headers.ts";
import { agentContext, memberContext, testDb } from "./helpers.ts";

/**
 * A deployment under a path (docs/plans/hosted.md): a hosted Workspace at
 * `app.example.com/acme`, or a self-hosted deevy an operator serves at
 * `company.com/deevy`. Everything it answers is under the path of its URL.
 */

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const secret = "test-secret-that-is-at-least-32-characters";
const host = "https://app.example.com";
const baseURL = `${host}/acme`;

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

describe("the path a deployment lives under", () => {
  it("is the path of its URL, and nothing at the root of a host", () => {
    expect(basePathOf(undefined)).toBe("");
    expect(basePathOf("https://deevy.example.com")).toBe("");
    expect(basePathOf("https://deevy.example.com/")).toBe("");
    expect(basePathOf("https://app.example.com/acme")).toBe("/acme");
    expect(basePathOf("https://company.example.com/tools/deevy/")).toBe("/tools/deevy");
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

  /**
   * The reference page is the one page that runs Scalar from jsDelivr, so it
   * has a policy of its own. Under a path the request's path carries the
   * base, and matching `/api/docs` alone gave it the page policy, which
   * refused Scalar and left the page blank.
   */
  it("serves its API reference with the policy that lets Scalar run", async () => {
    const { app } = testApp();
    const res = await app.request("/acme/api/docs");
    const html = await res.text();

    expect(html).toContain(`<script src="${SCALAR_SCRIPT}">`);
    expect(res.headers.get("content-security-policy")).toBe(await docsPolicy(html));
  });

  it("takes an Agent's key under the path, and challenges for one at its MCP endpoint", async () => {
    const { db, auth, app } = testApp();
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const planner = await agentContext(db, { sponsor: ada.member, name: "Planner" });
    const { key } = await auth.api.createApiKey({
      body: { userId: planner.member.userId, name: "laptop" },
    });

    const me = await app.request("/acme/api/me", { headers: { authorization: `Bearer ${key}` } });
    expect(me.status).toBe(200);

    // No authorization server to name, under a path or not (ADR-0035).
    const challenged = await app.request("/acme/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(challenged.status).toBe(401);
    expect(challenged.headers.get("www-authenticate")).toBe('Bearer realm="deevy"');
    for (const path of [
      "/.well-known/oauth-authorization-server/acme",
      "/acme/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource/acme/mcp",
    ]) {
      expect((await app.request(path)).status, path).toBe(404);
    }
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
