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
  db: Db;
  auth: Auth;
  /** Drop-in for `fetch`, answering from the app rather than the network. */
  fetch: typeof fetch;
  close: () => void;
}

export function testDeevy(): TestDeevy {
  const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
  const auth = createAuth({
    db,
    env: {
      baseURL,
      secret,
      providers: { github: { clientId: "github-client", clientSecret: "github-secret" } },
    },
  });
  const app = createApp({ db, auth, baseURL });
  const asFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    return Promise.resolve(app.request(request));
  }) as typeof fetch;
  return { db, auth, fetch: asFetch, close };
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
  const res = await deevy.fetch(`${baseURL}/api/auth/oauth2/consent`, {
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
