import type { Db, Issue, Member, Project, Workspace } from "@deevy/db";
import { eq } from "drizzle-orm";
import { agent, member, project, projectGrant, socket, user, workspace } from "@deevy/db";
import type { OpenedDatabase } from "@deevy/adapters/node";
import { openDatabase } from "@deevy/adapters/node";
import type { Session } from "../src/auth.ts";
import type { AppContext } from "../src/operations/registry.ts";
import type { ApiKeys, ApiKeySummary } from "../src/keys.ts";
import { newId } from "../src/ids.ts";
import { upsertProjection } from "../src/issues.ts";
import type { ExternalIssue, SocketModule, SocketModules } from "../src/sockets/port.ts";

export const migrationsFolder = new URL("../../db/drizzle", import.meta.url).pathname;

export function testDb() {
  return openDatabase({ path: ":memory:", migrationsFolder });
}

export interface CountingDatabase extends OpenedDatabase {
  /** Every statement drizzle has run since the array was last emptied, in order. */
  statements: string[];
}

/**
 * A database that says what it was asked to do. On D1 the number of statements
 * one request runs is a limit rather than a detail, so the budget for a write
 * is a test with a number in it rather than a note in a document
 * (docs/plans/m3.md). Migrations run before the array is handed over, so what
 * a test empties and reads back is its own work and nothing else.
 */
export function countingDb(): CountingDatabase {
  const statements: string[] = [];
  const opened = openDatabase({
    path: ":memory:",
    migrationsFolder,
    logger: {
      logQuery: (query) => {
        statements.push(query);
      },
    },
  });
  statements.length = 0;
  return { ...opened, statements };
}

/** An AppContext whose caller is a Member of the Workspace, for createRouterClient. */
export type MemberContext = AppContext & {
  session: Session;
  member: Member;
  workspace: Workspace;
};

/** The context an operation sees for a Member that already exists. */
export function contextFor(db: Db, member: Member, workspace: Workspace): MemberContext {
  const session = {
    session: {
      id: newId("session"),
      userId: member.userId,
      token: "test",
      expiresAt: new Date(),
    },
    user: {
      id: member.userId,
      name: "Test",
      email: "test@example.com",
      image: null,
      kind: member.kind,
    },
  } as unknown as Session;
  // Every test builds its links from one origin, so a URL an operation hands
  // back is something a test can write out in full.
  return { db, session, member, workspace, baseURL: "https://deevy.test" };
}

export interface MemberContextOptions {
  role?: Member["role"];
  kind?: Member["kind"];
  name?: string;
  email?: string;
}

/**
 * Inserts a user, the Workspace when there is none yet, and a Member, and
 * returns the context an operation sees for that caller.
 */
export async function memberContext(
  db: Db,
  options: MemberContextOptions = {},
): Promise<MemberContext> {
  const name = options.name ?? "Ada";
  const email = options.email ?? `${name.toLowerCase()}@example.com`;
  const userId = newId("user");
  await db.insert(user).values({ id: userId, name, email });

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
    role: options.role ?? "member",
    kind: options.kind ?? "human",
  });
  const row = (await db.query.member.findFirst({ where: { id: memberId } })) as Member;

  return contextFor(db, row, ws);
}

export interface AgentContextOptions extends MemberContextOptions {
  /** The Human accountable for this Agent (ADR-0001). */
  sponsor?: Member;
  /** The Projects it may see. Absent means none, which is the safe default. */
  grants?: string[];
}

/**
 * An Agent Member with a Sponsor and its Project grants, and the context an
 * operation sees when its API key authenticated the request.
 */
export async function agentContext(
  db: Db,
  options: AgentContextOptions = {},
): Promise<MemberContext> {
  const context = await memberContext(db, {
    ...options,
    kind: "agent",
    name: options.name ?? "Planner",
  });
  await db.insert(agent).values({ memberId: context.member.id });
  if (options.sponsor) {
    await db
      .update(member)
      .set({ sponsorId: options.sponsor.id })
      .where(eq(member.id, context.member.id));
  }
  for (const projectId of options.grants ?? []) {
    await db.insert(projectGrant).values({ memberId: context.member.id, projectId });
  }
  const row = (await db.query.member.findFirst({ where: { id: context.member.id } })) as Member;
  return { ...contextFor(db, row, context.workspace), grantedProjectIds: options.grants ?? [] };
}

export interface FakeApiKeys extends ApiKeys {
  /** Every key this store has minted, plaintext included, for a test to compare against. */
  issued: Array<{ userId: string; name: string; plaintext: string }>;
}

/**
 * A store the `agents.keys.*` operations can talk to while the Better Auth
 * `apiKey` plugin is not wired in behind the seam (packages/core/src/keys.ts).
 */
export function fakeApiKeys(): FakeApiKeys {
  const rows = new Map<string, ApiKeySummary & { userId: string }>();
  const issued: FakeApiKeys["issued"] = [];
  return {
    issued,
    async issue({ userId, name }) {
      const id = `key-${rows.size + 1}`;
      const plaintext = `deevy_sk_${id}_secret`;
      const summary = {
        id,
        userId,
        name,
        start: plaintext.slice(0, 12),
        createdAt: new Date(),
        lastRequestAt: null,
        expiresAt: null,
        enabled: true,
      };
      rows.set(id, summary);
      issued.push({ userId, name, plaintext });
      return { ...summary, key: plaintext };
    },
    async list({ userId }) {
      return [...rows.values()].filter((row) => row.userId === userId);
    },
    async revoke({ userId, keyId }) {
      const found = rows.get(keyId);
      if (!found || found.userId !== userId) return false;
      rows.delete(keyId);
      return true;
    },
  };
}

/**
 * A tracker that is not a tool.
 *
 * Every rule about inbound, routing and projection is a rule about what happens
 * when a tracker says something, so the core's tests play one rather than
 * reaching for a network (ADR-0024). It is deliberately its own small fake and
 * not `@deevy/sockets`: the core holds the port, and a test dependency on a
 * package that depends on the core is a cycle nobody needs.
 */
export function fakeSockets(records: Map<string, ExternalIssue> = new Map()): {
  sockets: SocketModules;
  records: Map<string, ExternalIssue>;
} {
  let opened = 0;
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
      createIssue: (scope, draft) => {
        opened += 1;
        const container = typeof scope.scopeKey === "string" ? scope.scopeKey : "acme/deevy";
        const key = `${container}#${String(opened)}`;
        const made: ExternalIssue = {
          externalId: String(opened),
          key,
          url: `https://tracker.test/${key}`,
          title: draft.title,
          body: draft.body,
          state: "open",
          stateName: "Open",
          assignees: [],
          labels: draft.labels,
          parentExternalId: draft.parent?.externalId ?? null,
          updatedAt: new Date(),
        };
        records.set(made.externalId, made);
        return Promise.resolve({ ...made, parentLinked: draft.parent !== null });
      },
      createComment: (_scope, ref) =>
        Promise.resolve({ externalId: `c${String(records.size)}`, url: `${ref.url}#c` }),
      setLabels: () => Promise.resolve(),
      listContainers: () =>
        Promise.resolve([
          { scope: { scopeKey: "acme/deevy" }, scopeKey: "acme/deevy", name: "acme/deevy" },
        ]),
    },
  });
  return { sockets: { stub: module }, records };
}

/** A record as a tracker would state one, for a test that only cares about a few fields. */
export function externalIssue(
  over: Partial<ExternalIssue> & { externalId: string },
): ExternalIssue {
  const key = over.key ?? `acme/deevy#${over.externalId}`;
  return {
    key,
    url: over.url ?? `https://tracker.test/${key}`,
    title: over.title ?? `Record ${over.externalId}`,
    body: over.body ?? null,
    state: over.state ?? "open",
    stateName: over.stateName ?? (over.state === "closed" ? "Done" : "Open"),
    assignees: over.assignees ?? [],
    labels: over.labels ?? [],
    parentExternalId: over.parentExternalId ?? null,
    updatedAt: over.updatedAt ?? new Date(),
    externalId: over.externalId,
  };
}

export interface SeededProject {
  socketId: string;
  project: Project;
  /** Projects one record and hands back the row, as a delivery would. */
  record: (over: Partial<ExternalIssue> & { externalId: string }) => Promise<Issue>;
}

/**
 * A Socket and a Project bound to it: what every test that has an Issue needs
 * before it can have one. The Socket row is written directly because connecting
 * one is an admin operation and most of these tests are not about that.
 */
export async function seedProject(
  db: Db,
  workspaceId: string,
  options: { slug?: string; scopeKey?: string; defaultAgentMemberId?: string } = {},
): Promise<SeededProject> {
  const slug = options.slug ?? "deevy";
  const scopeKey = options.scopeKey ?? "acme/deevy";
  const socketId = newId("socket");
  await db.insert(socket).values({
    id: socketId,
    workspaceId,
    provider: "stub",
    capabilities: ["tracker"],
    name: "Example tracker",
    identity: { login: "deevy", id: "bot-1", mentionHandle: "@deevy" },
    config: {},
  });
  const [row] = await db
    .insert(project)
    .values({
      id: newId("project"),
      workspaceId,
      slug,
      name: slug,
      trackerSocketId: socketId,
      trackerScope: { scopeKey },
      trackerScopeKey: `stub:${scopeKey}`,
      ...(options.defaultAgentMemberId
        ? { defaultAgentMemberId: options.defaultAgentMemberId }
        : {}),
    })
    .returning();
  if (!row) throw new Error("seedProject: the insert returned no row");
  return {
    socketId,
    project: row,
    record: async (over) => {
      const { issue } = await upsertProjection(db, {
        projectId: row.id,
        socketId,
        external: externalIssue({ ...over, key: over.key ?? `${scopeKey}#${over.externalId}` }),
      });
      return issue;
    },
  };
}
