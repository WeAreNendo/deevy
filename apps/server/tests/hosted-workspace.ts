/**
 * A hosted Workspace as `apps/hosted` runs one (ADR-0028): deevy on the
 * durable driver, under a path of a shared host, with the two secrets the
 * platform derives for it — written through the doors a person and an Agent
 * use, for the trip home (docs/OPERATIONS.md, "Taking a hosted Workspace home")
 * to start from. Shared by tests/import.test.ts and scripts/check-d1-import.ts.
 *
 * Humans sign in through the OAuth stub (apps/web/scripts/stub-oauth.js), which
 * replaces `fetch` for the whole process, so the caller installs it: a test
 * file of its own, or a script.
 */
import {
  createDurableDb,
  dumpDatabase,
  migrateDurable,
  type DurableDb,
} from "@deevy/adapters/durable";
import { createNodeDurableStorage, type NodeDurableStorage } from "@deevy/adapters/testing";
import {
  API_PATH,
  basePathOf,
  createApp,
  createAuth,
  discardingJobQueue,
  signInProviders,
  type AuthEnv,
} from "@deevy/core";
import { buildContext } from "@deevy/core/app";
import { router } from "@deevy/core/router";
import type { Db } from "@deevy/db";
import { migrations as everyMigration } from "@deevy/db/durable-migrations";
import { addContainer, openStubStore, socketModules } from "@deevy/sockets";
import { createRouterClient } from "@orpc/server";

/** The host every hosted Workspace lives on, and this one's place on it. */
export const hostedOrigin = "https://app.example.com";
export const hostedURL = `${hostedOrigin}/acme`;

/**
 * What `Platform.secrets` hands over with the dump: the Workspace's Better
 * Auth secret and the one its Sockets' credentials are sealed under.
 */
export const hostedSecrets = {
  betterAuthSecret: "hosted-better-auth-secret-of-32-chars-or-more",
  deevySecret: "hosted-deevy-secret-of-at-least-32-characters",
};

/** A sign-in provider the stub answers for, on either side of the trip. */
export const stubGithub = { github: { clientId: "stub-client", clientSecret: "stub-secret" } };

type Auth = ReturnType<typeof createAuth>;
type Fetchable = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** One Human through the stub's whole dance, under the path `baseURL` has (seed.ts does the same). */
export async function signIn(app: Fetchable, baseURL: string, email: string): Promise<string> {
  const base = basePathOf(baseURL);
  const started = await app.request(`${base}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL: `${base}/` }),
  });
  const { url } = (await started.json()) as { url?: string };
  const state = url ? (new URL(url).searchParams.get("state") ?? "") : "";
  if (!state) throw new Error(`no authorization URL for ${email}: ${String(started.status)}`);
  const finished = await app.request(
    `${base}/api/auth/callback/github?state=${encodeURIComponent(state)}&code=${encodeURIComponent(email)}`,
    { headers: { cookie: cookiesOf(started) }, redirect: "manual" },
  );
  const cookie = cookiesOf(finished);
  if (!cookie.includes("session_token")) throw new Error(`sign-in refused for ${email}`);
  return cookie;
}

/** The operation API as one credential sees it, the way seed.ts calls it. */
export async function callerFor(
  {
    db,
    auth,
    baseURL,
    socketSecret,
  }: { db: Db; auth: Auth; baseURL: string; socketSecret: string },
  headers: HeadersInit,
) {
  const context = await buildContext(db, auth, new Headers(headers), baseURL, API_PATH);
  if (!context.member) throw new Error("that credential is not a Member");
  return {
    member: context.member,
    api: createRouterClient(router, {
      context: {
        ...context,
        jobs: discardingJobQueue(),
        sockets: socketModules({ devStub: true }),
        socketSecret,
      },
    }),
  };
}

export interface HostedWorkspace {
  storage: NodeDurableStorage;
  db: DurableDb;
  members: { ada: string; grace: string; planner: string };
  socketId: string;
  /** The Agent's API key, which outlives the move. */
  agentKey: string;
  /** Where the Event counter stood when the dump was taken. */
  eventSeq: number;
  /** What `Platform.dump` hands over. */
  dump: () => string;
}

/**
 * Two Humans, an Agent with a key, a Socket whose credential and webhook
 * secret are sealed under the Workspace's `DEEVY_SECRET`, a Project bound to
 * it, the OAuth resources the Workspace's authorization server registered at
 * its hosted address, and an MCP client's token bound to them.
 */
export async function hostedWorkspace(): Promise<HostedWorkspace> {
  const storage = createNodeDurableStorage();
  const db = createDurableDb(storage);
  const migrated = migrateDurable(db, everyMigration);
  if (migrated.error) throw new Error(`migration failed: ${JSON.stringify(migrated.error)}`);

  // What WorkspaceObject builds (apps/hosted/src/workspace.ts), less the relay.
  const identity: AuthEnv = {
    baseURL: hostedURL,
    secret: hostedSecrets.betterAuthSecret,
    trustedOrigins: [hostedOrigin],
    providers: stubGithub,
    adminEmail: "ada@example.com",
    workspaceName: "Acme",
  };
  // Awaited as the object awaits it: this is where the OAuth provider registers
  // the Workspace's two resources, at its hosted address.
  const auth = createAuth({ db, env: identity });
  await auth.$context;
  const app = createApp({
    db,
    auth,
    origin: [hostedOrigin],
    baseURL: hostedURL,
    secret: hostedSecrets.betterAuthSecret,
    signInProviders: signInProviders(identity),
    sockets: socketModules({ devStub: true }),
    devSockets: true,
    socketSecret: hostedSecrets.deevySecret,
  });
  const as = (headers: HeadersInit) =>
    callerFor({ db, auth, baseURL: hostedURL, socketSecret: hostedSecrets.deevySecret }, headers);

  const ada = await as({ cookie: await signIn(app, hostedURL, "ada@example.com") });
  await ada.api.allowlist.add({ kind: "email_domain", value: "example.com" });
  const grace = await as({ cookie: await signIn(app, hostedURL, "grace@example.com") });

  const store = openStubStore({ id: "hosted-acme", login: "deevy" });
  addContainer(store, { scopeKey: "acme/web", name: "acme/web" });
  const socket = await ada.api.sockets.connect({
    provider: "stub",
    name: "Acme tracker",
    config: { storeId: store.id, signInProvider: "github" },
    // Sealed on the way in, by the operation, under the hosted DEEVY_SECRET.
    credentials: { token: "tok_hosted" },
    webhookSecret: "whsec_hosted",
  });
  await ada.api.projects.create({
    slug: "web",
    name: "Web",
    tracker: { socketId: socket.id, scope: { scopeKey: "acme/web" } },
  });
  const planner = await ada.api.agents.create({ name: "Planner" });
  if (!planner.key) throw new Error("this instance cannot mint API keys");

  // An MCP client a Human signed in through, at the hosted address. Rows rather
  // than the whole authorization-code dance: what matters to the trip is what
  // they name, which is the address the Workspace is leaving.
  storage.sql.exec(
    `INSERT INTO oauth_client (id, client_id, redirect_uris) VALUES ('occ_1', 'mcp-client', '["http://127.0.0.1:7777/cb"]')`,
  );
  storage.sql.exec(
    `INSERT INTO oauth_client_resource (id, client_id, resource_id) VALUES ('ocr_1', 'mcp-client', ?)`,
    `${hostedURL}/mcp`,
  );
  storage.sql.exec(
    `INSERT INTO oauth_access_token (id, token, client_id, user_id, resources, scopes)
     VALUES ('oat_1', 'opaque', 'mcp-client', ?, ?, '["openid"]')`,
    ada.member.userId,
    JSON.stringify([`${hostedURL}/mcp`]),
  );
  // The counter above the highest Event, as it stands once the newest are
  // gone: only `sqlite_sequence` remembers it, so only a dump that carries the
  // counter keeps a `seq` from being handed out twice.
  storage.sql.exec(`UPDATE sqlite_sequence SET seq = seq + 5 WHERE name = 'event'`);
  const { seq } = storage.sql
    .exec<{ seq: number }>(`SELECT seq FROM sqlite_sequence WHERE name = 'event'`)
    .one();

  return {
    storage,
    db,
    members: { ada: ada.member.id, grace: grace.member.id, planner: planner.id },
    socketId: socket.id,
    agentKey: planner.key.key,
    eventSeq: seq,
    dump: () => [...dumpDatabase(storage)].join(""),
  };
}

/**
 * A Workspace at an earlier release, with only `applied` of the migrations
 * applied: a row in `workspace` and nothing else, since the core writes at
 * this release's schema.
 */
export function workspaceAt(applied: Record<string, string>, name = "Acme"): string {
  const storage = createNodeDurableStorage();
  const migrated = migrateDurable(createDurableDb(storage), applied);
  if (migrated.error) throw new Error(`migration failed: ${JSON.stringify(migrated.error)}`);
  storage.sql.exec(`INSERT INTO workspace (id, name, slug) VALUES ('ws_acme', ?, 'acme')`, name);
  const dump = [...dumpDatabase(storage)].join("");
  storage.close();
  return dump;
}
