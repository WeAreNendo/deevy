import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { createApp } from "@deevy/core/app";
import type {
  ExternalComment,
  ExternalIssue,
  SocketModule,
  SocketModules,
} from "@deevy/core/sockets";
import { createAuth, type Session as AuthSession } from "@deevy/core/auth";
import { router } from "@deevy/core/router";
import { openDatabase } from "@deevy/adapters/node";
import { agent, member, projectGrant, user, workspace } from "@deevy/db";
import type { Db, Member, Workspace } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import type { Config } from "../src/config.ts";
import { createDeevy } from "../src/deevy.ts";
import { openProxy, type Proxy } from "../src/proxy.ts";
import type { Session, SessionEvent, SessionInput } from "../src/session.ts";
import { deevyToolNames } from "../src/tools.ts";
import { newId } from "@deevy/core";

const migrationsFolder = new URL("../../../packages/db/drizzle", import.meta.url).pathname;
// Better Auth refuses a plain-http MCP resource that is not loopback, and this
// origin is what tokens and Gate URLs are built from either way.
const baseURL = "http://localhost:3000";

/** The knobs a test never varies, so a test that does vary one says why. */
export const testConfig: Config = {
  url: baseURL,
  key: "unset",
  harness: "claude-code",
  // A test is not root, so a session shares its user; the container smoke in
  // CI is where the two-user boundary is real (docs/plans/agent-owns-git.md).
  sessionUid: 10002,
  sessionGid: 10002,
  pollSeconds: 1,
  runTimeoutSeconds: 60,
  model: "claude-opus-5",
  effort: "high",
  maxTurns: 10,
  repo: null,
  listenPort: 0,
};

/**
 * A real deevy, and an Agent with a real key pointed at it.
 *
 * The runtime reaches it through `fetch`, and the fetch a test hands over is
 * the app's own handler: the request goes through the same routing, the same
 * middleware and the same API-key authentication a deployed instance uses,
 * with no port to bind and no process to wait for. Slice 4's container test is
 * where a real socket gets exercised (docs/plans/m4.md).
 */
export interface InstanceOptions {
  /**
   * A repository the Project's forge Socket hands out a credential for: the
   * path of a bare repository on disk, which is what a Run clones. Absent, the
   * Project is bound to a tracker and nothing else, which is a Project whose
   * Runs write no code.
   */
  repo?: string;
}

export async function instance({ repo }: InstanceOptions = {}) {
  const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
  const auth = createAuth({
    db,
    env: {
      baseURL,
      secret: "test-secret-that-is-at-least-32-characters",
      providers: { github: { clientId: "id", clientSecret: "secret" } },
    },
  });
  const tracker = fakeTracker(repo);
  const app = createApp({ db, auth, baseURL, sockets: tracker.sockets });

  const ada = await insertMember(db, { name: "Ada", role: "admin", kind: "human" });
  const asAda = createRouterClient(router, {
    context: { ...contextFor(db, ada.member, ada.workspace), sockets: tracker.sockets },
  });
  // An Issue is a projection of a record in a tracker Socket (ADR-0024), so a
  // Workspace with work in it starts with something to project from.
  const socket = await asAda.sockets.connect({
    provider: "stub",
    name: "Example tracker",
    config: {},
  });
  const project = await asAda.projects.create({
    slug: "acme-deevy",
    name: "deevy",
    tracker: { socketId: socket.id, scope: { scopeKey: CONTAINER } },
    // A Project with a repository is what `runs.checkout` and `pulls.open`
    // need: both refuse a Project that is bound to a tracker and nothing else
    // (docs/plans/sockets.md, slice 6).
    ...(repo
      ? { forge: { socketId: socket.id, scope: { scopeKey: CONTAINER, baseBranch: "main" } } }
      : {}),
  });

  const planner = await insertMember(db, { name: "Planner", role: "member", kind: "agent" });
  await db.insert(agent).values({ memberId: planner.member.id });
  await db.insert(projectGrant).values({ memberId: planner.member.id, projectId: project.id });
  const issued = await auth.api.createApiKey({
    body: { userId: planner.member.userId, name: "runtime" },
  });

  const config: Config = { ...testConfig, url: baseURL, key: issued.key };
  /**
   * Every request the runtime made that deevy refused. A supervisor that asks
   * for something it knows will fail leaves an error in an operator's log on
   * nothing going wrong, and this is how a test can say it did not.
   */
  const refused: Array<{ method: string; path: string; status: number }> = [];
  /** The app's own handler as a fetch, so nothing binds a port. */
  const inProcess: typeof globalThis.fetch = (input, init) =>
    Promise.resolve(app.request(input as string, init as RequestInit));

  return {
    db,
    close,
    config,
    refused,
    /** The tracker deevy projects from, for a test that reads what was written there. */
    tracker,
    project,
    deevy: createDeevy({
      config,
      fetch: async (input, init) => {
        const response = await inProcess(input, init);
        if (!response.ok) {
          refused.push({
            method: init?.method ?? "GET",
            path: new URL(input as string).pathname,
            status: response.status,
          });
        }
        return response;
      },
    }),
    /**
     * The proxy the supervisor opens per Run, forwarding to this deevy with
     * the Agent's key (src/proxy.ts). A test that wants a different key or a
     * shorter tool list calls `openProxy` itself with `inProcess`.
     */
    proxy: (options: { onDenied?: (name: string) => void | Promise<void> } = {}): Promise<Proxy> =>
      openProxy({
        url: baseURL,
        key: issued.key,
        tools: deevyToolNames,
        fetch: inProcess,
        ...options,
      }),
    inProcess,
    /**
     * The Agent's key against a path the supervisor itself never calls. The
     * model reaches those over MCP, and a test playing the model needs a way to
     * make the same write without standing a second client up.
     */
    asAgent: async (path: string, body = "{}") => {
      const res = await app.request(`/api${path}`, {
        method: "POST",
        body,
        headers: { authorization: `Bearer ${issued.key}`, "content-type": "application/json" },
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return (await res.json()) as unknown;
    },
    /**
     * The same deevy on a real port. Only the live test needs one: a session
     * that spawns Claude is a subprocess, and a subprocess cannot reach a
     * handler that lives in this process's memory.
     */
    listen: async () => {
      const server = serve({ fetch: app.fetch, port: 0 });
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      return {
        url: `http://localhost:${port}`,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
      };
    },
    asAda,
    ada: ada.member,
    planner: planner.member,
    /**
     * A record in the tracker, routed to the Agent — which is what opens a Run
     * (`triggersFor`). The key comes back as the tracker wrote it, because that
     * is the only key there is now.
     */
    assign: async (title = "Ship it") => {
      const issue = await asAda.issues.create({
        projectSlug: project.slug,
        title,
        assignAgent: planner.member.id,
      });
      return issue;
    },
  };
}

/** The container every test's Project is bound to. */
export const CONTAINER = "acme/deevy";

const git = promisify(execFile);

/**
 * A bare repository with one commit on `main`: what a Project's forge Socket
 * hands a Run a credential for.
 *
 * Real git and no network. What a Run pushed is only a fact on the remote, and
 * only git can settle it. The caller removes the directory it is in.
 */
export async function bareRepo(): Promise<{ path: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "deevy-remote-"));
  const path = join(dir, "origin.git");
  const seed = join(dir, "seed");
  await git("git", ["init", "--bare", "--initial-branch", "main", "--quiet", path]);
  await git("git", ["clone", "--quiet", path, seed]);
  await git("git", ["-C", seed, "config", "user.email", "seed@deevy.test"]);
  await git("git", ["-C", seed, "config", "user.name", "seed"]);
  await writeFile(join(seed, "README.md"), "# a repository\n");
  await git("git", ["-C", seed, "add", "-A"]);
  await git("git", ["-C", seed, "commit", "--quiet", "-m", "first"]);
  await git("git", ["-C", seed, "push", "--quiet", "origin", "main"]);
  return { path, dir };
}

export interface FakeTracker {
  sockets: SocketModules;
  /** What the tracker holds, by external id. */
  records: Map<string, ExternalIssue>;
  /** What was said on each record, by external id: the loop deevy writes into. */
  comments: Map<string, ExternalComment[]>;
  /** The labels deevy asked the tracker to set, in order. */
  labelled: Array<{ externalId: string; add: string[]; remove: string[] }>;
  /** Every pull request deevy opened through it, in order. */
  pulls: Array<{ head: string; base: string; title: string; body: string }>;
}

/**
 * A tracker that is not a tool.
 *
 * The runtime never speaks to one — it reaches deevy over HTTP and nothing else
 * (docs/plans/m4.md) — but deevy does, so a test that opens a record or says
 * something on one needs a provider behind the Socket. Small and local rather
 * than `@deevy/sockets`: what these tests need of a tracker is that it answers.
 */
export function fakeTracker(repo?: string): FakeTracker {
  const records = new Map<string, ExternalIssue>();
  const comments = new Map<string, ExternalComment[]>();
  const labelled: FakeTracker["labelled"] = [];
  const pulls: FakeTracker["pulls"] = [];
  let opened = 0;

  const module = (): SocketModule => ({
    provider: "stub",
    capabilities: new Set(repo ? (["tracker", "forge"] as const) : (["tracker"] as const)),
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
      listComments: (_scope, ref, limit) =>
        Promise.resolve((comments.get(ref.externalId) ?? []).slice(-limit)),
      createIssue: (_scope, draft) => {
        opened += 1;
        const externalId = String(opened);
        const key = `${CONTAINER}#${externalId}`;
        const made: ExternalIssue = {
          externalId,
          key,
          url: `https://tracker.test/${CONTAINER}/issues/${externalId}`,
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
      createComment: (_scope, ref, body) => {
        const said = comments.get(ref.externalId) ?? [];
        const comment: ExternalComment = {
          externalId: `c${String(said.length + 1)}`,
          url: `${ref.url}#c${String(said.length + 1)}`,
          body,
          author: { login: "deevy", id: "bot-1", isBot: true },
          createdAt: new Date(),
        };
        said.push(comment);
        comments.set(ref.externalId, said);
        return Promise.resolve({ externalId: comment.externalId, url: comment.url });
      },
      setLabels: (_scope, ref, change) => {
        labelled.push({ externalId: ref.externalId, ...change });
        return Promise.resolve();
      },
      listContainers: () =>
        Promise.resolve([{ scope: { scopeKey: CONTAINER }, scopeKey: CONTAINER, name: CONTAINER }]),
    },
    // The half a Run needs to write code: a credential to clone with, and
    // somewhere to open what it pushed (ADR-0024). The credential is a real
    // path on disk, because what these tests clone is a real repository.
    ...(repo
      ? {
          forge: {
            credential: () =>
              Promise.resolve({
                cloneUrl: repo,
                username: "x-access-token",
                secret: "tracker-token",
                expiresAt: null,
              }),
            openPullRequest: (_scope, draft) => {
              pulls.push(draft);
              return Promise.resolve({
                url: `https://tracker.test/${CONTAINER}/pull/${String(pulls.length)}`,
                number: pulls.length,
              });
            },
          },
        }
      : {}),
  });

  return { sockets: { stub: module }, records, comments, labelled, pulls };
}

async function insertMember(
  db: Db,
  options: { name: string; role: Member["role"]; kind: Member["kind"] },
): Promise<{ member: Member; workspace: Workspace }> {
  const userId = newId("user");
  await db
    .insert(user)
    .values({ id: userId, name: options.name, email: `${options.name.toLowerCase()}@deevy.test` });
  let found = await db.query.workspace.findFirst();
  if (!found) {
    const id = newId("workspace");
    await db.insert(workspace).values({ id, name: "deevy", slug: "deevy" });
    found = await db.query.workspace.findFirst({ where: { id } });
  }
  const ws = found as Workspace;
  const memberId = newId("member");
  await db.insert(member).values({
    id: memberId,
    workspaceId: ws.id,
    userId,
    role: options.role,
    kind: options.kind,
  });
  return {
    member: (await db.query.member.findFirst({ where: { id: memberId } })) as Member,
    workspace: ws,
  };
}

/**
 * The context an operation sees for a Human signed in to deevy. Built here
 * rather than imported: the runtime's tests may reach into the workspace, and
 * reaching into `packages/core`'s internals is still reaching too far.
 */
function contextFor(db: Db, row: Member, ws: Workspace) {
  return {
    db,
    workspace: ws,
    member: row,
    baseURL,
    session: {
      session: { id: newId("session"), userId: row.userId, token: "t", expiresAt: new Date() },
      user: { id: row.userId, name: row.id, email: "ada@deevy.test", image: null, kind: row.kind },
    } as unknown as AuthSession,
  };
}

/**
 * A session that yields what a test wrote and does what a test told it to. A
 * step that is a function gets the session's input, so a test playing the
 * model can reach deevy the way the model does: through the proxy's URL.
 */
export function scripted(
  steps: Array<SessionEvent | ((input: SessionInput) => Promise<void>)>,
  ready: SessionEvent = {
    type: "ready",
    tools: [],
    servers: [{ name: "deevy", status: "connected" }],
  },
): Session {
  return async function* (input) {
    yield ready;
    for (const step of steps) {
      if (typeof step === "function") await step(input);
      else yield step;
    }
  };
}

export const finished: SessionEvent = { type: "done", ok: true, detail: "done" };
