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

const emptyIssue = {
  id: "stub-issue",
  key: "DEV-0",
  number: 0,
  title: "Stub",
  description: null,
  state: { id: "stub-state", name: "Build", position: 0, isGate: false, category: "active" },
  assignee: null,
  assigneeMemberId: null,
  parent: null,
  parentId: null,
  children: [],
  gateDecisions: [],
  labels: [],
  closedAt: null,
  updatedAt: new Date(),
  project: { id: "stub-project", key: "DEV", name: "deevy" },
};

// The return type is deliberately loose: createTanstackQueryUtils wants a real
// client shape, and a stub only ever implements the operations a test touches.
export function stubClient(overrides: StubOverrides = {}): never {
  const base: Record<string, Record<string, StubOperation>> = {
    health: {
      ping: async () => ({
        ok: true,
        time: new Date(0).toISOString(),
        devSignIn: false,
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
    teams: {
      list: async () => ({ teams: [] }),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({ deleted: true }),
      addMember: async () => ({}),
      removeMember: async () => ({}),
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
    projects: {
      list: async () => ({ projects: [] }),
      get: async () => ({
        ...emptyIssue.project,
        description: null,
        team: null,
        archivedAt: null,
        states: [],
      }),
      create: async () => ({}),
      update: async () => ({}),
      archive: async () => ({}),
    },
    workflow: { get: async () => ({ states: [] }), update: async () => ({ states: [] }) },
    issues: {
      list: async () => ({ issues: [], nextCursor: null }),
      get: async () => emptyIssue,
      create: async () => emptyIssue,
      update: async () => emptyIssue,
      move: async () => emptyIssue,
      setLabels: async () => emptyIssue,
    },
    gates: { approve: async () => emptyIssue, reject: async () => emptyIssue },
    labels: {
      list: async () => ({ labels: [] }),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({ deleted: true }),
    },
    documents: {
      list: async () => ({ documents: [] }),
      get: async () => ({
        id: "d",
        name: "intent",
        currentVersion: 1,
        version: 1,
        body: "",
        authorMemberId: null,
        writtenAt: new Date("2026-09-01T10:00:00Z"),
      }),
      versions: async () => ({ versions: [] }),
      write: async () => ({}),
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
      list: async () => ({ comments: [] }),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({ deleted: true }),
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
