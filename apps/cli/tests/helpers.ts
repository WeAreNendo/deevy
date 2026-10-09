/**
 * A real deevy, in this process.
 *
 * The CLI reaches it through `fetch`, and the fetch a test hands over is the
 * app's own handler: the request goes through the same routing, the same
 * middleware and the same audience check a deployed instance uses, with no port
 * to bind. The shape is `apps/agent/tests/helpers.ts`, for the same reasons.
 */
import { createApp } from "@deevy/core/app";
import type { Auth } from "@deevy/core/auth";
import type { ExternalIssue, SocketModule, SocketModules } from "@deevy/core/sockets";
import { API_PATH } from "@deevy/core";
import type { StoredToken } from "../src/credentials.ts";
import type { Reporter } from "../src/identity.ts";
import { authorizeUrl, discover, exchange, listen, pkce, register } from "../src/login.ts";
import { createAuth } from "@deevy/core/auth";
import { openDatabase } from "@deevy/adapters/node";
import { member, user, workspace } from "@deevy/db";
import type { Db } from "@deevy/db";

const migrationsFolder = new URL("../../../packages/db/drizzle", import.meta.url).pathname;

/**
 * Loopback, because Better Auth refuses a plain-http resource identifier that
 * is not — and the whole sign-in dance is built from this origin.
 */
export const baseURL = "http://localhost:3000";
const secret = "test-secret-that-is-at-least-32-characters";

export interface TestDeevy {
  /** Where it lives, path included: `baseURL`, unless the test put it under a path. */
  baseURL: string;
  db: Db;
  auth: Auth;
  /** Drop-in for `fetch`, answering from the app rather than the network. */
  fetch: typeof fetch;
  close: () => void;
}

/**
 * A deevy at `baseURL`, or under a path of the same host when a test names one
 * (`${baseURL}/acme`): its `BETTER_AUTH_URL`, which is all a deployment needs
 * to be told to live there (ADR-0029).
 */
export function testDeevy(options: { version?: string; baseURL?: string } = {}): TestDeevy {
  const at = options.baseURL ?? baseURL;
  const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
  const auth = createAuth({
    db,
    env: {
      baseURL: at,
      secret,
      providers: { github: { clientId: "github-client", clientSecret: "github-secret" } },
    },
  });
  const app = createApp({
    db,
    auth,
    baseURL: at,
    sockets: fakeSockets(),
    ...(options.version ? { version: options.version } : {}),
  });
  const asFetch = ((input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    return Promise.resolve(app.request(request));
  }) as typeof fetch;
  return { baseURL: at, db, auth, fetch: asFetch, close };
}

/**
 * A tracker that is not a tool.
 *
 * An Issue is a projection of a record in a Socket (ADR-0024), so a generated
 * command that opens one needs a provider behind the Socket to open it in. Its
 * own small fake rather than `@deevy/sockets`, for the reason the core's tests
 * give: a test dependency on a package that depends on the core is a cycle
 * nobody needs.
 */
function fakeSockets(): SocketModules {
  const records = new Map<string, ExternalIssue>();
  const module = (): SocketModule => ({
    provider: "stub",
    capabilities: new Set(["tracker"] as const),
    identity: () => Promise.resolve({ login: "deevy", id: "bot-1", mentionHandle: "@deevy" }),
    tracker: {
      verifyInbound: () => Promise.resolve({ ok: true, deliveryId: null, eventName: "" }),
      normalize: () => [],
      getIssue: (_scope, ref) => {
        const found = records.get(ref.externalId);
        if (!found) throw new Error(`no record ${ref.externalId}`);
        return Promise.resolve(found);
      },
      listIssues: () => Promise.resolve({ issues: [...records.values()], nextCursor: null }),
      listComments: () => Promise.resolve([]),
      createIssue: (_scope, draft) => {
        const externalId = String(records.size + 1);
        const key = `acme/deevy#${externalId}`;
        const made: ExternalIssue = {
          externalId,
          key,
          url: `https://tracker.test/acme/deevy/issues/${externalId}`,
          title: draft.title,
          body: draft.body,
          state: "open",
          stateName: "open",
          assignees: [],
          labels: draft.labels,
          parentExternalId: draft.parent?.externalId ?? null,
          updatedAt: new Date(),
        };
        records.set(externalId, made);
        return Promise.resolve({ ...made, parentLinked: draft.parent !== null });
      },
      createComment: (_scope, ref) => Promise.resolve({ externalId: "c1", url: `${ref.url}#c1` }),
      setLabels: () => Promise.resolve(),
      listContainers: () =>
        Promise.resolve([
          { scope: { scopeKey: "acme/deevy" }, scopeKey: "acme/deevy", name: "acme/deevy" },
        ]),
    },
  });
  return { stub: module };
}

/** A Human who is already a Member, which is what `me.get` answers about. */
export async function humanMember(db: Db): Promise<void> {
  await db.insert(workspace).values({ id: "w1", name: "deevy", slug: "deevy" });
  await db.insert(user).values({ id: "u1", name: "Ada", email: "ada@example.com" });
  await db.insert(member).values({
    id: "m1",
    workspaceId: "w1",
    userId: "u1",
    handle: "ada",
    role: "admin",
    kind: "human",
  });
}

/**
 * The consent a Human gives in the browser, taken by hand: the CLI's part of
 * the dance ends at the authorize URL, and this is the page it opens.
 */
export async function consent(
  deevy: TestDeevy,
  cookie: Headers,
  location: string,
): Promise<string> {
  const res = await deevy.fetch(`${deevy.baseURL}${API_PATH}/auth/oauth2/consent`, {
    method: "POST",
    headers: { ...Object.fromEntries(cookie), "content-type": "application/json" },
    body: JSON.stringify({ oauth_query: new URL(location, baseURL).search.slice(1), accept: true }),
  });
  if (res.status !== 200) throw new Error(`consent: ${String(res.status)} ${await res.text()}`);
  const body = (await res.json()) as { url: string };
  const code = new URL(body.url).searchParams.get("code");
  if (!code) throw new Error(`consent returned no code: ${body.url}`);
  return code;
}

/**
 * The cookie headers a browser would carry into the consent step.
 *
 * Better Auth signs its session cookie, so a bare token is refused: the value
 * is `<token>.<HMAC of the token>`, which is what the browser would present.
 */
export async function cookieHeaders(auth: Auth, userId: string): Promise<Headers> {
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

/**
 * A token for the API resource, the way `deevy login` gets one — so a test of a
 * generated command spends the credential a person would, through the same
 * audience check (ADR-0023).
 */
export async function apiToken(deevy: TestDeevy, userId: string): Promise<StoredToken> {
  const metadata = await discover(deevy.baseURL, deevy.fetch);
  const loopback = await listen("s");
  try {
    const clientId = await register(metadata, deevy.baseURL, loopback.redirectUri, deevy.fetch);
    const { verifier, challenge } = pkce();
    const resource = `${deevy.baseURL}${API_PATH}`;
    const url = authorizeUrl(metadata, {
      clientId,
      redirectUri: loopback.redirectUri,
      challenge,
      state: "s",
      resource,
    });
    const cookie = await cookieHeaders(deevy.auth, userId);
    const redirected = await deevy.fetch(url, { headers: cookie, redirect: "manual" });
    const code = await consent(deevy, cookie, redirected.headers.get("location") ?? "");
    return await exchange(
      metadata,
      { code, clientId, verifier, redirectUri: loopback.redirectUri, resource },
      deevy.fetch,
    );
  } finally {
    loopback.close();
  }
}

/** Everything the CLI said, so a test reads what a person would see. */
export function collect(): Reporter & { lines: { out: string[]; err: string[] } } {
  const lines = { out: [] as string[], err: [] as string[] };
  return {
    lines,
    out: (line: string) => lines.out.push(line),
    err: (line: string) => lines.err.push(line),
  };
}

/** Polls until the CLI has printed what the Human's browser would have opened. */
export async function waitFor(look: () => string | undefined): Promise<string> {
  for (let i = 0; i < 100; i += 1) {
    const found = look();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the CLI never printed an authorize URL");
}

/**
 * The Human's half of `deevy login`, driven from the URL the CLI printed:
 * arrive at the authorize endpoint signed in, consent, and follow the redirect
 * back to the CLI's listener. Answers with the URL the CLI printed.
 */
export async function approveInBrowser(
  deevy: TestDeevy,
  printed: () => string,
  userId: string,
): Promise<string> {
  const url = await waitFor(() => /https?:\/\/\S+oauth2\/authorize\S*/.exec(printed())?.[0]);
  const cookie = await cookieHeaders(deevy.auth, userId);
  const redirected = await deevy.fetch(url, { headers: cookie, redirect: "manual" });
  const code = await consent(deevy, cookie, redirected.headers.get("location") ?? "");
  const asked = new URL(url).searchParams;
  await fetch(`${asked.get("redirect_uri") ?? ""}?code=${code}&state=${asked.get("state") ?? ""}`);
  return url;
}

/** A fetch that writes down every URL it is asked for, then asks the real one. */
export function recording(inner: typeof fetch): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const asking = ((input: Request | string | URL, init?: RequestInit) => {
    urls.push(input instanceof Request ? input.url : String(input));
    return inner(input, init);
  }) as typeof fetch;
  return { fetch: asking, urls };
}
