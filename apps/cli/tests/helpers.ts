/**
 * A real deevy, in this process.
 *
 * The CLI reaches it through `fetch`, and the fetch a test hands over is the
 * app's own handler: the request goes through the same routing, the same
 * middleware and the same audience check a deployed instance uses, with no port
 * to bind.
 */
import { basePathOf, type AppRouter } from "@deevy/core";
import { createApp } from "@deevy/core/app";
import type { Auth } from "@deevy/core/auth";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { InboundEvent, SocketModule, SocketModules } from "@deevy/core/sockets";
import type { Reporter } from "../src/identity.ts";
import { createAuth } from "@deevy/core/auth";
import { openDatabase } from "@deevy/adapters/node";
import { agent, member, user, workspace } from "@deevy/db";
import type { Db } from "@deevy/db";

const migrationsFolder = new URL("../../../packages/db/drizzle", import.meta.url).pathname;

/** Loopback and plain http, the way deevy's own dev instance is. */
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
    // What a Socket's webhook secret is sealed under, so one can be connected.
    socketSecret: "cli-test-sealing-secret-cli-test-sealing",
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
 * command that reads one needs a provider behind the Socket to have delivered
 * it. It takes every delivery and reads the events straight off the body. Its
 * own small fake rather than `@deevy/sockets`, for the reason the core's tests
 * give: a test dependency on a package that depends on the core is a cycle
 * nobody needs.
 */
function fakeSockets(): SocketModules {
  const module = (): SocketModule => ({
    provider: "stub",
    capabilities: new Set(["tracker"] as const),
    webhookSecretFrom: "either",
    identity: () => Promise.resolve({ login: "deevy", id: "bot-1", mentionHandle: "@deevy" }),
    tracker: {
      verifyInbound: () => Promise.resolve({ ok: true, deliveryId: null, eventName: "events" }),
      normalize: (_eventName, payload) =>
        ((payload as { events?: InboundEvent[] }).events ?? []).map((event) =>
          event.kind === "issue"
            ? { ...event, issue: { ...event.issue, updatedAt: new Date(event.issue.updatedAt) } }
            : event,
        ),
      createComment: (_scope, ref) => Promise.resolve({ externalId: "c1", url: `${ref.url}#c1` }),
      listContainers: () =>
        Promise.resolve([
          { scope: { scopeKey: "acme/deevy" }, scopeKey: "acme/deevy", name: "acme/deevy" },
        ]),
    },
  });
  return { stub: module };
}

/**
 * An Agent, sponsored by an admin, and the key its Sponsor would have issued it:
 * what the CLI holds in `DEEVY_API_KEY`, minted by the same plugin deevy's own
 * `agents.keys.issue` calls (ADR-0035).
 */
export async function agentKey(deevy: TestDeevy): Promise<string> {
  await deevy.db.insert(workspace).values({ id: "w1", name: "deevy", slug: "deevy" });
  await deevy.db.insert(user).values([
    { id: "u1", name: "Ada", email: "ada@example.com" },
    { id: "u2", name: "Planner", email: "planner@agents.example.com", kind: "agent" },
  ]);
  await deevy.db.insert(member).values([
    { id: "m1", workspaceId: "w1", userId: "u1", handle: "ada", role: "admin", kind: "human" },
    {
      id: "m2",
      workspaceId: "w1",
      userId: "u2",
      handle: "planner",
      role: "member",
      kind: "agent",
      sponsorId: "m1",
    },
  ]);
  await deevy.db.insert(agent).values({ memberId: "m2" });
  const { key } = await deevy.auth.api.createApiKey({ body: { userId: "u2", name: "cli" } });
  return key;
}

/**
 * Ada, the admin `agentKey` sponsored the Agent from, in deevy's own pages: a
 * signed session cookie and the same-origin word a browser adds, so a test can
 * connect a Socket and bind a Project the way a Human does, before the CLI
 * reads them as the Agent.
 */
export async function asAdmin(deevy: TestDeevy): Promise<RouterClient<AppRouter>> {
  const context = await deevy.auth.$context;
  const session = await context.internalAdapter.createSession("u1");
  // Better Auth signs its session cookie: `<token>.<HMAC of the token>`.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(session.token));
  const value = `${session.token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
  const link = new RPCLink({
    // Split the way the CLI's own client splits it (client.ts).
    origin: new URL(deevy.baseURL).origin,
    url: `${basePathOf(deevy.baseURL)}/rpc`,
    headers: {
      cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(value)}`,
      "sec-fetch-site": "same-origin",
    },
    fetch: (url, init) => deevy.fetch(url, init),
  });
  return createORPCClient(link);
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

/** A fetch that writes down every URL it is asked for, then asks the real one. */
export function recording(inner: typeof fetch): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const asking = ((input: Request | string | URL, init?: RequestInit) => {
    urls.push(input instanceof Request ? input.url : String(input));
    return inner(input, init);
  }) as typeof fetch;
  return { fetch: asking, urls };
}
