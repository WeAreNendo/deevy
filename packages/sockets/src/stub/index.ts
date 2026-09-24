/**
 * The provider that is not a tool.
 *
 * Every rule deevy has about inbound deliveries, routing, mirroring and
 * rulings is a rule about what happens when a tracker says something. Proving
 * those against GitHub means a network, an App, a tunnel and a clock; proving
 * them against this means a function call. So the stub is a real tracker and a
 * real forge with an in-memory store, it signs its deliveries the way a
 * provider does, and it is what the core's tests, the seed and the acceptance
 * walk play (docs/plans/sockets.md).
 *
 * It is refused in production by the entry that registers it, never by this
 * file: a module that decides where it may run cannot be tested anywhere.
 */
import type {
  Container,
  ExternalComment,
  ExternalIssue,
  ExternalRef,
  ForgeCredential,
  InboundCheck,
  InboundEvent,
  InboundInput,
  IssueDraft,
  IssuePage,
  IssueQuery,
  PullRequestDraft,
  Scope,
  SocketModule,
  SocketModuleInput,
} from "@deevy/core/sockets";

/** A container in the stub tracker: what a Project binds to. */
export interface StubContainer {
  scopeKey: string;
  name: string;
  issues: Map<string, ExternalIssue>;
  comments: Map<string, ExternalComment[]>;
  pulls: { url: string; number: number; head: string; base: string; title: string; body: string }[];
  /** The bare repository this container's Runs clone, when it stands for code too. */
  cloneUrl: string | null;
}

/**
 * The state one stub Socket holds, keyed so that every instantiation of the
 * module finds the same one. `createApp` builds a module per request from the
 * Socket row, so the store cannot live in a closure the row does not name.
 */
export interface StubStore {
  id: string;
  containers: Map<string, StubContainer>;
  /** What the loop guard drops: a comment this login wrote is deevy's own mirror. */
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
 * `acme/deevy=/srv/repos/deevy.git,acme/ops` — a name, and optionally a
 * repository a Run can clone. An entry that is already there is left alone,
 * because this runs where the entry is built and an entry rebuilt would drop
 * every record the store holds.
 *
 * It exists because a store lives in the process deevy runs in: a developer
 * driving a stubbed instance from outside — a browser, the acceptance walk —
 * has no other way to say what the tracker contains
 * (docs/sockets-acceptance.md).
 */
export function openDevStubStore(spec = "", id: string = DEV_STUB_STORE): StubStore {
  const store = openStubStore({ id });
  const wanted = spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of wanted.length > 0 ? wanted : ["acme/deevy"]) {
    const [scopeKey = "", cloneUrl] = entry.split("=");
    if (scopeKey && !store.containers.has(scopeKey)) {
      addContainer(store, { scopeKey, cloneUrl: cloneUrl ?? null });
    }
  }
  return store;
}

export interface AddContainerOptions {
  scopeKey: string;
  name?: string;
  cloneUrl?: string | null;
}

export function addContainer(
  store: StubStore,
  { scopeKey, name = scopeKey, cloneUrl = null }: AddContainerOptions,
): StubContainer {
  const container: StubContainer = {
    scopeKey,
    name,
    issues: new Map(),
    comments: new Map(),
    pulls: [],
    cloneUrl,
  };
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

// The wire. The stub's own format, because what it exists to exercise is
// deevy's half: a signature over the raw body, a delivery id that makes a
// replay a no-op, and an event name `normalize` switches on.

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let same = 0;
  for (let index = 0; index < a.length; index += 1)
    same |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return same === 0;
}

/** One delivery, ready to be POSTed at `/hooks/<socketId>`. */
export interface StubDelivery {
  headers: Record<string, string>;
  body: string;
}

let deliveries = 0;

/**
 * Signs one delivery. The events are carried verbatim, because the stub is not
 * modelling a provider's payload — a provider's own shape is what its fixture
 * tests are for, and what this proves is the machinery behind `normalize`.
 */
export async function signDelivery(
  secret: string,
  events: InboundEvent[],
  options: { deliveryId?: string; eventName?: string } = {},
): Promise<StubDelivery> {
  deliveries += 1;
  const deliveryId = options.deliveryId ?? `stub-delivery-${deliveries}`;
  const body = JSON.stringify({ events });
  return {
    headers: {
      "content-type": "application/json",
      "stub-event": options.eventName ?? "events",
      "stub-delivery": deliveryId,
      "stub-signature": await hmac(secret, body),
    },
    body,
  };
}

/**
 * The clocks a delivery lost on the way through JSON.
 *
 * A provider's `normalize` reads a parsed body and answers deevy's own types,
 * and two of those are Dates: the core compares them to decide a reordered
 * delivery and writes them to integer columns. A stub that handed back strings
 * would be a stub that only worked in a test that never wrote one down.
 */
function reviveDates(event: unknown): InboundEvent {
  const one = event as Record<string, Record<string, unknown> | undefined>;
  if (one.issue && typeof one.issue.updatedAt === "string") {
    one.issue = { ...one.issue, updatedAt: new Date(one.issue.updatedAt) };
  }
  if (one.comment && typeof one.comment.createdAt === "string") {
    one.comment = { ...one.comment, createdAt: new Date(one.comment.createdAt) };
  }
  return one as unknown as InboundEvent;
}

export function createStubSocket({ config, now }: SocketModuleInput): SocketModule {
  // A Socket connected with no configuration finds the store the deployment
  // seeded, which is the only one anybody outside this process can fill
  // (`openDevStubStore`). A test or a seed that wants its own names it.
  const store = openStubStore({
    id: typeof config.storeId === "string" ? config.storeId : DEV_STUB_STORE,
  });

  return {
    provider: "stub",
    capabilities: new Set(["tracker", "forge"] as const),
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
      async verifyInbound({
        headers,
        rawBody,
        webhookSecret,
      }: InboundInput): Promise<InboundCheck> {
        const eventName = headers.get("stub-event") ?? "";
        const deliveryId = headers.get("stub-delivery");
        const signature = headers.get("stub-signature") ?? "";
        const expected = await hmac(webhookSecret, rawBody);
        return { ok: equal(signature, expected), deliveryId, eventName };
      },

      normalize(_eventName: string, payload: unknown): InboundEvent[] {
        const events = (payload as { events?: unknown } | null)?.events;
        return Array.isArray(events) ? events.map(reviveDates) : [];
      },

      getIssue(scope: Scope, ref: ExternalRef): Promise<ExternalIssue> {
        const issue = requireContainer(store, scope).issues.get(ref.externalId);
        if (!issue) throw new Error(`stub: no issue ${ref.externalId}`);
        return Promise.resolve(issue);
      },

      listIssues(scope: Scope, query: IssueQuery): Promise<IssuePage> {
        const all = [...requireContainer(store, scope).issues.values()]
          .filter((issue) => !query.updatedSince || issue.updatedAt > query.updatedSince)
          .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
        const from = query.cursor ? Number(query.cursor) : 0;
        const page = all.slice(from, from + query.limit);
        const next = from + page.length;
        return Promise.resolve({
          issues: page,
          nextCursor: next < all.length ? String(next) : null,
        });
      },

      listComments(scope: Scope, ref: ExternalRef, limit: number): Promise<ExternalComment[]> {
        const comments = requireContainer(store, scope).comments.get(ref.externalId) ?? [];
        return Promise.resolve(comments.slice(-limit));
      },

      createIssue(
        scope: Scope,
        draft: IssueDraft,
      ): Promise<ExternalIssue & { parentLinked: boolean }> {
        const container = requireContainer(store, scope);
        const externalId = String(container.issues.size + 1);
        const issue = putIssue(container, {
          externalId,
          title: draft.title,
          body: draft.body,
          labels: draft.labels,
          parentExternalId: draft.parent?.externalId ?? null,
          updatedAt: now(),
        });
        return Promise.resolve({ ...issue, parentLinked: draft.parent !== null });
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

      setLabels(
        scope: Scope,
        ref: ExternalRef,
        change: { add: string[]; remove: string[] },
      ): Promise<void> {
        const container = requireContainer(store, scope);
        const issue = container.issues.get(ref.externalId);
        if (!issue) throw new Error(`stub: no issue ${ref.externalId}`);
        const labels = new Set(issue.labels);
        for (const label of change.remove) labels.delete(label);
        for (const label of change.add) labels.add(label);
        container.issues.set(ref.externalId, { ...issue, labels: [...labels] });
        return Promise.resolve();
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

    forge: {
      credential(scope: Scope): Promise<ForgeCredential> {
        const container = requireContainer(store, scope);
        if (!container.cloneUrl) throw new Error(`stub: ${container.scopeKey} has no repository`);
        return Promise.resolve({
          cloneUrl: container.cloneUrl,
          username: "x-access-token",
          secret: "stub-token",
          expiresAt: null,
        });
      },

      openPullRequest(
        scope: Scope,
        draft: PullRequestDraft,
      ): Promise<{ url: string; number: number }> {
        const container = requireContainer(store, scope);
        const number = container.pulls.length + 1;
        const url = `https://stub.invalid/${container.scopeKey}/pull/${number}`;
        container.pulls.push({ url, number, ...draft });
        return Promise.resolve({ url, number });
      },
    },
  };
}
