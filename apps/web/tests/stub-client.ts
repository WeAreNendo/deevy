/**
 * The shape every SPA test mocks `lib/orpc` with. Each slice adds operations,
 * and a test that does not care about them should not have to know they exist,
 * so the defaults answer everything with something empty and a test overrides
 * only what it asserts on.
 */
type StubCall = (input: never) => unknown;
/**
 * One operation, or a nested namespace of them: `agents.keys.issue` is two
 * levels deep, and an override replaces such a namespace whole.
 */
type StubOperation = StubCall | Record<string, StubCall>;

export interface StubOverrides {
  [namespace: string]: Record<string, StubOperation> | undefined;
}

const stamp = new Date("2026-09-20T09:00:00Z");

/**
 * The Socket every fixture here is projected from: one in-process tracker, so
 * a Project has something to be bound to and an Issue has somewhere to have
 * come from (ADR-0024).
 */
export const stubSocket = {
  id: "sock_stub00000",
  workspaceId: "w1",
  provider: "stub",
  capabilities: ["tracker", "forge"],
  name: "Stub tracker",
  identity: { login: "deevy[bot]", id: "1", mentionHandle: "deevy" },
  config: {},
  installedBy: null,
  status: "active",
  lastInboundAt: stamp,
  pollMinutes: null,
  createdAt: stamp,
  updatedAt: stamp,
};

/** A Project as the API answers one: a binding, with no Issues and no Workflow of its own. */
export function stubProject(slug: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id: `proj_${slug}`,
    workspaceId: "w1",
    slug,
    name,
    description: null,
    trackerSocketId: stubSocket.id,
    trackerScope: { container: slug },
    trackerScopeKey: slug,
    forgeSocketId: null,
    forgeScope: null,
    docsSocketId: null,
    docsScope: null,
    defaultAgentMemberId: null,
    routing: { labelPrefix: "agent:", mention: true },
    mirror: "gates",
    createdAt: stamp,
    archivedAt: null,
    ...extra,
  };
}

const stubbedProject = stubProject("acme-deevy", "deevy");

/**
 * An Issue as the API answers one: the projection of a record, in the tracker's
 * own words — its key, its URL and its state (ADR-0024). deevy authors none of
 * it, so there is nothing here a screen may edit.
 */
const emptyIssue = {
  id: "iss_stub000000",
  projectId: stubbedProject.id,
  socketId: stubSocket.id,
  externalId: "1",
  externalKey: "acme/deevy#1",
  url: "https://example.com/acme/deevy/issues/1",
  title: "Stub",
  body: null,
  state: "open",
  stateName: "open",
  assignees: [],
  labels: [],
  assignee: null,
  assigneeMemberId: null,
  parentExternalId: null,
  parent: null,
  parentId: null,
  children: [],
  createdBy: null,
  externalUpdatedAt: stamp,
  lastSyncedAt: stamp,
  createdAt: stamp,
  updatedAt: stamp,
  closedAt: null,
  project: stubbedProject,
};

/**
 * A Gate as the API answers one: the request, the policy it is measured
 * against, the Rulings so far, and where the Human reading it stands
 * (ADR-0024). Every screen that shows a Gate takes this shape.
 */
export function stubGate(extra: Record<string, unknown> = {}) {
  return {
    id: "gate_stub00000",
    runId: "run_stub000000",
    issueId: emptyIssue.id,
    projectId: stubbedProject.id,
    checkpoint: "ship",
    proposal: "## What I will do\n\nRewrite the totals, behind a flag.",
    links: [] as Array<{ url: string; title: string }>,
    requestedBy: "m-planner",
    visit: 1,
    status: "open",
    askedAt: stamp,
    decidedAt: null,
    url: "https://deevy.test/gates/gate_stub00000",
    policy: {
      id: null,
      name: "ship",
      approvalsRequired: 1,
      excludeRequester: false,
      approverMemberIds: [] as string[],
    },
    decisions: [] as Array<Record<string, unknown>>,
    approvals: 0,
    run: { id: "run_stub000000", issueKey: emptyIssue.externalKey },
    you: { mayRule: true, hasRuled: false, why: null as string | null },
    ...extra,
  };
}

/** A Run as the feed lists one, with the Gate it is waiting at when it is. */
export function stubRun(extra: Record<string, unknown> = {}) {
  return {
    id: "run_stub000000",
    issueKey: emptyIssue.externalKey,
    agentMemberId: "m-planner",
    triggeredByMemberId: null,
    trigger: "assignment",
    status: "active",
    summary: null,
    startedAt: stamp,
    lastActivityAt: stamp,
    finishedAt: null,
    createdAt: stamp,
    lastActivities: [] as Array<Record<string, unknown>>,
    activityCount: 0,
    openGateRequestId: null,
    ...extra,
  };
}

export { emptyIssue as stubIssue };

// The return type is deliberately loose: createTanstackQueryUtils wants a real
// client shape, and a stub only ever implements the operations a test touches.
export function stubClient(overrides: StubOverrides = {}): never {
  const base: Record<string, Record<string, StubOperation>> = {
    health: {
      ping: async () => ({
        ok: true,
        time: new Date(0).toISOString(),
        devSignIn: false,
        devSockets: false,
        providers: [{ id: "github", label: "GitHub", kind: "social" }],
      }),
    },
    me: {
      get: async () => ({
        user: {},
        member: { role: "admin" },
        workspace: {},
        principal: "cookie",
      }),
    },
    oauthClients: {
      list: async () => ({ clients: [] }),
      revoke: async () => ({ revoked: true }),
    },
    identities: {
      list: async () => ({ identities: [], signIns: [], linkable: [], tools: [] }),
    },
    workspace: {
      get: async () => ({
        id: "w1",
        name: "deevy",
        slug: "deevy",
        maxChildrenPerIssue: 20,
        maxDelegationDepth: 3,
        maxOpenDescendants: 50,
        createdAt: new Date("2026-09-06"),
      }),
      update: async () => ({
        id: "w1",
        name: "deevy",
        slug: "deevy",
        maxChildrenPerIssue: 20,
        maxDelegationDepth: 3,
        maxOpenDescendants: 50,
        createdAt: new Date("2026-09-06"),
      }),
    },
    members: {
      list: async () => ({ members: [] }),
      updateRole: async () => ({}),
      suspend: async () => ({}),
      reinstate: async () => ({}),
    },
    agents: {
      list: async () => ({ agents: [] }),
      create: async () => ({}),
      update: async () => ({}),
      setSponsor: async () => ({}),
      suspend: async () => ({}),
      reinstate: async () => ({}),
      keys: {
        list: async () => ({ keys: [] }),
        issue: async () => ({ id: "stub-key", key: "deevy_sk_stub", name: "stub" }),
        revoke: async () => ({ revoked: true }),
      },
      grants: {
        list: async () => ({ projects: [] }),
        add: async () => ({ projects: [] }),
        remove: async () => ({ projects: [] }),
      },
    },
    allowlist: {
      list: async () => ({ rules: [] }),
      add: async () => ({}),
      remove: async () => ({ removed: true }),
    },
    invitations: {
      list: async () => ({ invitations: [] }),
      create: async () => ({ id: "inv-stub", url: "https://deevy.example.com/invite/stub" }),
      revoke: async () => ({ id: "inv-stub" }),
      accept: async () => ({ id: "mem-stub", role: "member" }),
    },
    sockets: {
      list: async () => ({ sockets: [] }),
      connect: async () => stubSocket,
      remove: async () => ({ ...stubSocket, status: "removed" }),
    },
    projects: {
      list: async () => ({ projects: [] }),
      get: async () => stubbedProject,
      create: async () => stubbedProject,
      update: async () => stubbedProject,
      archive: async () => ({ ...stubbedProject, archivedAt: stamp }),
    },
    issues: {
      list: async () => ({ issues: [], nextCursor: null, hasMore: false }),
      get: async () => emptyIssue,
      create: async () => emptyIssue,
    },
    inbox: {
      list: async () => ({ notifications: [], nextCursor: null }),
      unreadCount: async () => ({ unread: 0 }),
      markRead: async () => ({ read: 0 }),
      markAllRead: async () => ({ read: 0 }),
    },
    channels: {
      list: async () => ({ channels: [] }),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({ deleted: true }),
      test: async () => ({ delivered: true, status: 200, error: null }),
    },
    routing: {
      list: async () => ({ rules: [] }),
      set: async () => ({ rules: [] }),
    },
    webhooks: {
      list: async () => ({ subscriptions: [] }),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({ deleted: true }),
      deliveries: async () => ({ deliveries: [] }),
      redeliver: async () => ({ queued: true }),
    },
    preferences: {
      get: async () => ({ preferences: [] }),
      set: async () => ({ preferences: [] }),
    },
    links: {
      list: async () => ({ links: [] }),
      add: async () => ({}),
      remove: async () => ({ removed: true }),
    },
    runs: {
      list: async () => ({ runs: [], nextCursor: null }),
      get: async () => ({ activities: [] }),
      start: async () => ({}),
      postActivity: async () => ({ run: {}, activity: {} }),
      answer: async () => ({ run: {}, activity: {} }),
      finish: async () => ({}),
    },
    comments: {
      create: async () => ({}),
    },
    gates: {
      list: async () => ({ gates: [] }),
      get: async () => stubGate(),
      request: async () => stubGate(),
      approve: async () => stubGate({ status: "approved" }),
      reject: async () => stubGate({ status: "rejected" }),
    },
    checkpoints: {
      list: async () => ({ checkpoints: [] }),
      set: async () => ({ checkpoints: [] }),
    },
    events: {
      list: async () => ({ events: [], nextCursor: null }),
      // Stays open the way the real stream does, so the live hook does not spin.
      // It never yields on purpose: the test wants a stream that is connected
      // and silent, which is what the real one looks like between Events.
      subscribe: async () =>
        // eslint-disable-next-line require-yield
        (async function* () {
          await new Promise(() => {});
        })(),
    },
  };

  for (const [namespace, operations] of Object.entries(overrides)) {
    base[namespace] = { ...base[namespace], ...operations };
  }
  return base as never;
}
