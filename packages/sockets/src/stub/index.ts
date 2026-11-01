/**
 * The provider that is not a tool.
 *
 * Every rule deevy has about inbound deliveries, routing, rulings and the
 * comments that announce a Gate is a rule about what happens when a tracker
 * says something, or is told something. Proving those against GitHub means a
 * network, an App, a tunnel and a clock; proving them against this means a
 * function call. So the stub is a real tracker with an in-memory store, it
 * signs and reads its deliveries the way the generic Socket does, it keeps what deevy says on a
 * record where a test can read it, and it is what the core's tests, the seed
 * and the acceptance walk play (docs/plans/sockets.md).
 *
 * It is refused in production by the entry that registers it, never by this
 * file: a module that decides where it may run cannot be tested anywhere.
 */
import type {
  Container,
  ExternalComment,
  ExternalIssue,
  ExternalRef,
  Scope,
  SocketModule,
  SocketModuleInput,
} from "@deevy/core/sockets";
import { readEvents, verifyDelivery } from "../generic/wire.ts";

/** A container in the stub tracker: what a Project binds to. */
export interface StubContainer {
  scopeKey: string;
  name: string;
  issues: Map<string, ExternalIssue>;
  comments: Map<string, ExternalComment[]>;
}

/**
 * The state one stub Socket holds, keyed so that every instantiation of the
 * module finds the same one. `createApp` builds a module per request from the
 * Socket row, so the store cannot live in a closure the row does not name.
 */
export interface StubStore {
  id: string;
  containers: Map<string, StubContainer>;
  /** What the loop guard drops: a comment this login wrote is deevy's own announcement. */
  identity: { login: string; id: string; mentionHandle: string };
}

const stores = new Map<string, StubStore>();

export interface OpenStubStoreOptions {
  id?: string;
  login?: string;
}

/** Makes (or finds) a store. Its `id` goes in the Socket row's `config.storeId`. */
export function openStubStore({
  id = `stub-${Math.random().toString(36).slice(2, 10)}`,
  login = "deevy",
}: OpenStubStoreOptions = {}): StubStore {
  const found = stores.get(id);
  if (found) return found;
  const store: StubStore = {
    id,
    containers: new Map(),
    identity: { login, id: `stub-user-${login}`, mentionHandle: `@${login}` },
  };
  stores.set(id, store);
  return store;
}

/** Forgets every store. A test that does not want another's records calls it first. */
export function resetStubStores(): void {
  stores.clear();
}

/** The store a deployment's own dev stub uses, named so a Socket row can find it. */
export const DEV_STUB_STORE = "dev";

/**
 * The containers a stubbed deployment offers, from one string.
 *
 * `acme/deevy,acme/ops` — their names, separated by commas. An entry that is
 * already there is left alone, because this runs where the entry is built and
 * an entry rebuilt would drop every record the store holds.
 *
 * It exists because a store lives in the process deevy runs in: a developer
 * driving a stubbed instance from outside — a browser, the acceptance walk —
 * has no other way to say what the tracker contains
 * (docs/acceptance.md).
 */
export function openDevStubStore(spec = "", id: string = DEV_STUB_STORE): StubStore {
  const store = openStubStore({ id });
  const wanted = spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of wanted.length > 0 ? wanted : ["acme/deevy"]) {
    // `name=…` was a container with a repository behind it, when deevy held
    // a Run's code; the name is all that is read now (ADR-0034).
    const [scopeKey = ""] = entry.split("=");
    if (scopeKey && !store.containers.has(scopeKey)) addContainer(store, { scopeKey });
  }
  return store;
}

/** What `/dev/tracker` answers: the stubbed tracker, container by container. */
export interface DevTrackerView {
  containers: Array<{
    scopeKey: string;
    name: string;
    issues: ExternalIssue[];
    /** Keyed by the record's `externalId`. */
    comments: Record<string, ExternalComment[]>;
  }>;
}

/**
 * What the stubbed tracker holds, as JSON a walk outside this process can read
 * at `/dev/tracker`: each container's records and the comments on them,
 * deevy's own among them (docs/acceptance.md).
 */
export function devTrackerView(id: string = DEV_STUB_STORE): DevTrackerView {
  // Looked up, never opened: only the entry that registers the stub makes its
  // store, and a request that made one would leave a tracker behind in a
  // deployment that has none.
  const store = stores.get(id);
  if (!store) return { containers: [] };
  return {
    containers: [...store.containers.values()].map((container) => ({
      scopeKey: container.scopeKey,
      name: container.name,
      issues: [...container.issues.values()],
      comments: Object.fromEntries(container.comments),
    })),
  };
}

export interface AddContainerOptions {
  scopeKey: string;
  name?: string;
}

export function addContainer(
  store: StubStore,
  { scopeKey, name = scopeKey }: AddContainerOptions,
): StubContainer {
  const container: StubContainer = { scopeKey, name, issues: new Map(), comments: new Map() };
  store.containers.set(scopeKey, container);
  return container;
}

export interface PutIssueOptions extends Partial<Omit<ExternalIssue, "externalId">> {
  externalId: string;
}

/** Puts a record in the tracker, as a Human opening or editing one would. */
export function putIssue(
  container: StubContainer,
  { externalId, ...rest }: PutIssueOptions,
): ExternalIssue {
  const existing = container.issues.get(externalId);
  const issue: ExternalIssue = {
    externalId,
    key: rest.key ?? existing?.key ?? `${container.scopeKey}#${externalId}`,
    url: rest.url ?? existing?.url ?? `https://stub.invalid/${container.scopeKey}/${externalId}`,
    title: rest.title ?? existing?.title ?? `Issue ${externalId}`,
    body: rest.body ?? existing?.body ?? null,
    state: rest.state ?? existing?.state ?? "open",
    stateName: rest.stateName ?? existing?.stateName ?? rest.state ?? existing?.state ?? "open",
    assignees: rest.assignees ?? existing?.assignees ?? [],
    labels: rest.labels ?? existing?.labels ?? [],
    parentExternalId: rest.parentExternalId ?? existing?.parentExternalId ?? null,
    updatedAt: rest.updatedAt ?? new Date(),
  };
  container.issues.set(externalId, issue);
  return issue;
}

function requireContainer(store: StubStore, scope: Scope): StubContainer {
  const scopeKey = typeof scope.scopeKey === "string" ? scope.scopeKey : "";
  const container = store.containers.get(scopeKey);
  if (!container) throw new Error(`stub: no container ${scopeKey}`);
  return container;
}

// The wire is the generic Socket's (src/generic/wire.ts): what the stub exists
// to exercise is deevy's half — a signature over the raw body, a delivery id
// that makes a replay a no-op, a strict reader — and a public format is the
// one worth exercising on every deployment.

export function createStubSocket({ config, now }: SocketModuleInput): SocketModule {
  // A Socket connected with no configuration finds the store the deployment
  // seeded, which is the only one anybody outside this process can fill
  // (`openDevStubStore`). A test or a seed that wants its own names it.
  const store = openStubStore({
    id: typeof config.storeId === "string" ? config.storeId : DEV_STUB_STORE,
  });

  return {
    provider: "stub",
    capabilities: new Set(["tracker"] as const),
    // In the process, so it signs with whatever it is given.
    webhookSecretFrom: "either",
    // Walked on every deployment, on every commit (docs/acceptance.md).
    walked: true,
    // Its own accounts, unless its configuration says they are the ones deevy
    // signs people in with: that is how the acceptance walk and the seed play a
    // Human who signed in with GitHub and rules from the tracker with no
    // linking step (ADR-0025). The stub is refused in production, so saying so
    // vouches for nobody real.
    identityScope: {
      instance: `stub:${store.id}`,
      ...(config.signInProvider === "github" || config.signInProvider === "gitlab"
        ? { signInProvider: config.signInProvider }
        : {}),
    },
    identity: () => Promise.resolve(store.identity),

    tracker: {
      verifyInbound: verifyDelivery,
      normalize: (_eventName, payload) => readEvents(payload),

      getIssue(scope: Scope, ref: ExternalRef): Promise<ExternalIssue> {
        const issue = requireContainer(store, scope).issues.get(ref.externalId);
        if (!issue) throw new Error(`stub: no issue ${ref.externalId}`);
        return Promise.resolve(issue);
      },

      createComment(scope: Scope, ref: ExternalRef, body: string): Promise<ExternalRef> {
        const container = requireContainer(store, scope);
        const thread = container.comments.get(ref.externalId) ?? [];
        const comment: ExternalComment = {
          externalId: `c${thread.length + 1}`,
          url: `${ref.url}#comment-${thread.length + 1}`,
          body,
          author: { ...store.identity, isBot: true },
          createdAt: now(),
        };
        container.comments.set(ref.externalId, [...thread, comment]);
        return Promise.resolve({ externalId: comment.externalId, url: comment.url });
      },

      listContainers(): Promise<Container[]> {
        return Promise.resolve(
          [...store.containers.values()].map((container) => ({
            scope: { scopeKey: container.scopeKey },
            scopeKey: container.scopeKey,
            name: container.name,
          })),
        );
      },
    },
  };
}
