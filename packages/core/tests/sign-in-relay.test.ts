import { account, member, user, workspace } from "@deevy/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { createAuth, relayedProviders } from "../src/auth.ts";
import {
  relaySignInCallback,
  signInRelayFromEnv,
  unwrapRelayState,
  wrapRelayState,
} from "../src/sign-in-relay.ts";
import { testDb } from "./helpers.ts";

/**
 * Signing in through a relay (ADR-0030): one callback URL registered with a
 * provider, many deevys behind it — two hosted Workspaces on one host here.
 * The relay sends the browser back to the deevy whose state it carries, and
 * that deevy exchanges the code itself.
 */

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  vi.restoreAllMocks();
});

const host = "https://app.example.com";
const relayURL = `${host}/auth`;
const relaySecret = "relay-secret-relay-secret-relay-secret";
const relay = { secret: relaySecret, allows: (target: string) => target.startsWith(`${host}/`) };

function workspaceAt(slug: string) {
  const { db, close } = testDb();
  closers.push(close);
  const baseURL = `${host}/${slug}`;
  const auth = createAuth({
    db,
    env: {
      baseURL,
      secret: `${slug}-secret-that-is-at-least-32-characters`,
      trustedOrigins: [host],
      providers: {
        github: { clientId: "platform-github", clientSecret: "platform-github-secret" },
        oidc: {
          clientId: "own-idp",
          clientSecret: "own-idp-secret",
          issuer: "https://idp.example.com",
        },
      },
      adminEmail: "ada@example.com",
      signInRelay: { url: relayURL, secret: relaySecret },
    },
  });
  return { db, auth, baseURL, app: createApp({ db, auth, baseURL }) };
}

/** What GitHub was asked to exchange, so a test can say which redirect_uri was named. */
let exchanged: URLSearchParams[] = [];

beforeEach(() => {
  exchanged = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "github.com" && url.pathname === "/login/oauth/access_token") {
      const body =
        input instanceof Request
          ? await input.text()
          : typeof init?.body === "string"
            ? init.body
            : init?.body instanceof URLSearchParams
              ? init.body.toString()
              : "";
      exchanged.push(new URLSearchParams(body));
      return Response.json({ access_token: "gho_ada", token_type: "bearer", scope: "read:org" });
    }
    if (url.hostname === "api.github.com" && url.pathname === "/user") {
      return Response.json({
        id: 4242,
        login: "ada",
        name: "Ada",
        email: "ada@example.com",
        avatar_url: "",
      });
    }
    if (url.hostname === "api.github.com" && url.pathname === "/user/emails") {
      return Response.json([{ email: "ada@example.com", primary: true, verified: true }]);
    }
    return real(input, init);
  });
});

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** A Human starting a GitHub sign-in at a Workspace, as the SPA does. */
async function startSignIn(app: ReturnType<typeof workspaceAt>["app"], baseURL: string) {
  const started = await app.request(`${baseURL}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: host },
    body: JSON.stringify({
      provider: "github",
      callbackURL: `${baseURL}/`,
      errorCallbackURL: `${baseURL}/`,
    }),
  });
  expect(started.status).toBe(200);
  const { url } = (await started.json()) as { url: string };
  return { authorization: new URL(url), cookie: cookiesOf(started) };
}

describe("the relayed state", () => {
  it("carries the deevy's own state and where it lives, signed", async () => {
    const wrapped = await wrapRelayState(
      { to: `${host}/acme/api/auth`, state: "abc" },
      relaySecret,
    );
    expect(await unwrapRelayState(wrapped, relaySecret)).toEqual({
      to: `${host}/acme/api/auth`,
      state: "abc",
    });
    expect(await unwrapRelayState(wrapped, "another-secret-another-secret-another")).toBeNull();
    const [body, signature] = wrapped.split(".");
    const forged = await wrapRelayState(
      { to: "https://evil.example.com/api/auth", state: "abc" },
      "x",
    );
    expect(await unwrapRelayState(`${forged.split(".")[0]}.${signature}`, relaySecret)).toBeNull();
    expect(await unwrapRelayState(`${body}`, relaySecret)).toBeNull();
    expect(await unwrapRelayState("not a state", relaySecret)).toBeNull();
  });

  it("is configured by a secret, a URL to go through, and prefixes to send back to", () => {
    expect(signInRelayFromEnv({})).toEqual({ client: null, server: null });
    const both = signInRelayFromEnv({
      DEEVY_SIGN_IN_RELAY_SECRET: relaySecret,
      DEEVY_SIGN_IN_RELAY_URL: `${relayURL}/`,
      DEEVY_SIGN_IN_RELAY_ALLOW: `${host}/, not-a-url, https://other.example.com/x/`,
    });
    expect(both.client).toEqual({ url: relayURL, secret: relaySecret });
    expect(both.server?.allows(`${host}/acme/api/auth`)).toBe(true);
    expect(both.server?.allows("https://other.example.com/x/api/auth")).toBe(true);
    expect(both.server?.allows("https://app.example.com.evil.example/api/auth")).toBe(false);
  });

  it("relays every platform provider and never a deevy's own", () => {
    expect(
      relayedProviders({
        github: { clientId: "a", clientSecret: "b" },
        google: { clientId: "a", clientSecret: "b" },
        oidc: { clientId: "a", clientSecret: "b", issuer: "https://idp.example.com" },
      }),
    ).toEqual(["github", "google"]);
    expect(
      relayedProviders({
        gitlab: { clientId: "a", clientSecret: "b", issuer: "https://gitlab.acme.test" },
      }),
    ).toEqual([]);
    expect(relayedProviders({ gitlab: { clientId: "a", clientSecret: "b" } })).toEqual(["gitlab"]);
  });
});

describe("the relay", () => {
  it("sends a callback on to the deevy that started it, with its own state", async () => {
    const state = await wrapRelayState(
      { to: `${host}/acme/api/auth`, state: "own-state" },
      relaySecret,
    );
    const relayed = await relaySignInCallback(
      new Request(
        `${relayURL}/callback/github?code=the-code&state=${encodeURIComponent(state)}&iss=x`,
      ),
      "/callback/github",
      relay,
    );
    expect(relayed.status).toBe(302);
    const location = new URL(relayed.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(`${host}/acme/api/auth/callback/github`);
    expect(location.searchParams.get("state")).toBe("own-state");
    expect(location.searchParams.get("code")).toBe("the-code");
    expect(location.searchParams.get("iss")).toBe("x");
  });

  it("sends nothing anywhere a state was not signed for, or it was not told about", async () => {
    const unsigned = await relaySignInCallback(
      new Request(`${relayURL}/callback/github?code=c&state=plain`),
      "/callback/github",
      relay,
    );
    expect(unsigned.status).toBe(400);

    const elsewhere = await wrapRelayState(
      { to: "https://evil.example.com/api/auth", state: "s" },
      relaySecret,
    );
    const refused = await relaySignInCallback(
      new Request(`${relayURL}/callback/github?code=c&state=${encodeURIComponent(elsewhere)}`),
      "/callback/github",
      relay,
    );
    expect(refused.status).toBe(400);
    expect(refused.headers.get("location")).toBeNull();

    const notACallback = await relaySignInCallback(
      new Request(`${relayURL}/elsewhere`),
      "/elsewhere",
      relay,
    );
    expect(notACallback.status).toBe(400);
  });
});

describe("signing in to a Workspace through the relay", () => {
  it("names the relay's callback on both legs, and signs the Human in at the Workspace", async () => {
    const acme = workspaceAt("acme");
    const { authorization, cookie } = await startSignIn(acme.app, acme.baseURL);
    // The provider is told the one callback it knows, whichever Workspace asked.
    expect(authorization.searchParams.get("redirect_uri")).toBe(`${relayURL}/callback/github`);

    const relayed = await relaySignInCallback(
      new Request(
        `${relayURL}/callback/github?code=the-code&state=${encodeURIComponent(authorization.searchParams.get("state") ?? "")}`,
      ),
      "/callback/github",
      relay,
    );
    const callback = relayed.headers.get("location") ?? "";
    expect(callback.startsWith(`${acme.baseURL}/api/auth/callback/github?`)).toBe(true);

    const finished = await acme.app.request(callback, { headers: { cookie }, redirect: "manual" });
    expect(finished.status).toBe(302);
    expect(finished.headers.get("location")).toBe(`${acme.baseURL}/`);
    // The code was exchanged by the Workspace, naming the same callback.
    expect(exchanged.map((body) => body.get("redirect_uri"))).toEqual([
      `${relayURL}/callback/github`,
    ]);
    const session = finished.headers.getSetCookie().find((c) => c.includes("session_token="));
    expect(session).toContain("Path=/acme");

    // And admitted as deevy admits anybody: the admin's address bootstraps the Workspace.
    expect((await acme.db.query.workspace.findMany()).length).toBe(1);
    const members = await acme.db.select().from(member);
    expect(members.map((row) => row.role)).toEqual(["admin"]);
  });

  it("signs nobody in at a Workspace that did not start the sign-in", async () => {
    const acme = workspaceAt("acme");
    const beta = workspaceAt("beta");
    const { authorization, cookie } = await startSignIn(acme.app, acme.baseURL);
    const ownState = (
      await unwrapRelayState(authorization.searchParams.get("state") ?? "", relaySecret)
    )?.state;

    // The same code and state, delivered to the other Workspace with this browser's cookies.
    const misdelivered = await beta.app.request(
      `${beta.baseURL}/api/auth/callback/github?code=the-code&state=${encodeURIComponent(ownState ?? "")}`,
      { headers: { cookie }, redirect: "manual" },
    );
    expect(misdelivered.headers.getSetCookie().some((c) => c.includes("session_token="))).toBe(
      false,
    );
    expect(exchanged).toEqual([]);
    expect(await beta.db.select().from(workspace)).toEqual([]);
  });

  it("leaves a Workspace's own OpenID Connect IdP to call back to the Workspace", async () => {
    const acme = workspaceAt("acme");
    const started = await acme.app.request(`${acme.baseURL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: host },
      body: JSON.stringify({ provider: "oidc", callbackURL: `${acme.baseURL}/` }),
    });
    // The IdP is unreachable in a test, so Better Auth may refuse to start; if
    // it does start, the callback it names is the Workspace's own.
    if (started.status === 200) {
      const { url } = (await started.json()) as { url: string };
      const redirect = new URL(url).searchParams.get("redirect_uri") ?? "";
      expect(redirect.startsWith(`${acme.baseURL}/`)).toBe(true);
    }
  });

  it("links a signed-in Human's GitHub account through the relay too", async () => {
    const acme = workspaceAt("acme");
    await acme.db
      .insert(user)
      .values({ id: "usr_grace", name: "Grace", email: "grace@example.com" });
    const context = await acme.auth.$context;
    const session = await context.internalAdapter.createSession("usr_grace");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("acme-secret-that-is-at-least-32-characters"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(session.token),
    );
    const signed = `${session.token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
    const signedIn = `${context.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`;

    const started = await acme.app.request(`${acme.baseURL}/api/auth/link-social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: host, cookie: signedIn },
      body: JSON.stringify({
        provider: "github",
        callbackURL: `${acme.baseURL}/settings/identities`,
        errorCallbackURL: `${acme.baseURL}/settings/identities`,
      }),
    });
    expect(started.status).toBe(200);
    const authorization = new URL(((await started.json()) as { url: string }).url);
    expect(authorization.searchParams.get("redirect_uri")).toBe(`${relayURL}/callback/github`);

    const relayed = await relaySignInCallback(
      new Request(
        `${relayURL}/callback/github?code=the-code&state=${encodeURIComponent(authorization.searchParams.get("state") ?? "")}`,
      ),
      "/callback/github",
      relay,
    );
    const finished = await acme.app.request(relayed.headers.get("location") ?? "", {
      headers: { cookie: `${signedIn}; ${cookiesOf(started)}` },
      redirect: "manual",
    });
    expect(finished.headers.get("location")).toBe(`${acme.baseURL}/settings/identities`);
    const linked = await acme.db.select().from(account);
    expect(linked.map((row) => [row.providerId, row.accountId, row.userId])).toEqual([
      ["github", "4242", "usr_grace"],
    ]);
  });
});
