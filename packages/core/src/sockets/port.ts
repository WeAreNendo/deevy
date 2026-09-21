/**
 * What deevy asks a connected tool for (ADR-0024).
 *
 * The types live here and the implementations live in `@deevy/sockets`, one
 * module per provider. The core imports this file and never a provider: the
 * two runtime entries build the registry and hand it to `createApp`, the way
 * the MCP surface's metadata fetch is injected. That is what keeps ADR-0006
 * true with five HTTP clients in the tree — a provider module is web-standard
 * (`fetch`, `crypto.subtle`, no `node:`) and the Workers build compiles it.
 *
 * A provider implements whichever capabilities it has. A Project's binding
 * names one Socket per capability it uses, so a tracker without a repository
 * and a repository without a tracker are both ordinary.
 */

export const socketProviders = ["github", "linear", "gitlab", "notion", "slack", "stub"] as const;
export type SocketProvider = (typeof socketProviders)[number];

export const socketCapabilities = ["tracker", "forge", "docs", "chat"] as const;
export type SocketCapability = (typeof socketCapabilities)[number];

/** Where a record lives inside a Socket: the shape a Project's binding stores. */
export type Scope = Record<string, unknown>;

/** One record in a tracker, flattened to what deevy projects (`issue`). */
export interface ExternalIssue {
  /** The provider's own stable id: a GitHub node id, a Linear issue id, a Notion page id. */
  externalId: string;
  /** What a Human reads and types: `acme/deevy#42`, `ENG-12`. */
  key: string;
  url: string;
  title: string;
  /** Markdown. The core caps it on the way in; a provider need not. */
  body: string | null;
  state: "open" | "closed";
  /** The provider's own word: `open`, `Done`, `In Review`. */
  stateName: string;
  assignees: { login: string; id: string }[];
  labels: string[];
  parentExternalId: string | null;
  /** The provider's clock, which is what decides a reordered delivery. */
  updatedAt: Date;
}

export interface ExternalComment {
  externalId: string;
  url: string;
  body: string;
  author: ExternalActor;
  createdAt: Date;
}

/** Who did something on the provider's side. Never matched on by `login` (ADR-0025). */
export interface ExternalActor {
  login: string;
  id: string;
  /** Whether this is a machine — including deevy's own Socket, whose comments rule nothing. */
  isBot: boolean;
}

/** Names one record inside a scope. */
export interface ExternalRef {
  externalId: string;
  url: string;
}

/**
 * What one delivery means, in deevy's terms. `normalize` is pure: it reads the
 * parsed body and answers, so a fixture test needs no network and no clock.
 */
export type InboundEvent =
  | { kind: "issue"; scopeKey: string; issue: ExternalIssue; actor: ExternalActor | null }
  | { kind: "comment"; scopeKey: string; issueExternalId: string; comment: ExternalComment }
  | {
      kind: "ruling";
      scopeKey: string;
      issueExternalId: string;
      comment: ExternalComment;
      decision: "approved" | "rejected";
      note: string | null;
    }
  | { kind: "installation"; installations: { id: string; account: string }[] }
  | { kind: "ignored"; why: string };

/** The answer to "is this delivery really from the tool, and which delivery is it?" */
export interface InboundCheck {
  ok: boolean;
  /** The provider's own delivery id, which is what makes a replay a no-op. */
  deliveryId: string | null;
  /** The provider's name for what happened, passed back to `normalize`. */
  eventName: string;
}

export interface InboundInput {
  headers: Headers;
  /** Exactly the bytes that arrived: every provider signs the raw body. */
  rawBody: string;
  webhookSecret: string;
  /** The receiver's clock, for the providers that sign a timestamp. */
  now?: Date;
}

export interface IssuePage {
  issues: ExternalIssue[];
  nextCursor: string | null;
}

export interface IssueQuery {
  updatedSince: Date | null;
  cursor: string | null;
  limit: number;
}

export interface IssueDraft {
  title: string;
  body: string;
  parent: ExternalRef | null;
  labels: string[];
}

/** A container a Project can be bound to: a repository, a Linear team, a database. */
export interface Container {
  scope: Scope;
  scopeKey: string;
  name: string;
}

export interface TrackerSocket {
  /** Never throws: a bad signature is an answer, not an exception. */
  verifyInbound(input: InboundInput): Promise<InboundCheck>;
  /** Pure. One delivery may mean several things, or nothing. */
  normalize(eventName: string, payload: unknown): InboundEvent[];
  getIssue(scope: Scope, ref: ExternalRef): Promise<ExternalIssue>;
  listIssues(scope: Scope, query: IssueQuery): Promise<IssuePage>;
  listComments(scope: Scope, ref: ExternalRef, limit: number): Promise<ExternalComment[]>;
  /** `parentLinked` is false where the provider has no native parent to set. */
  createIssue(scope: Scope, draft: IssueDraft): Promise<ExternalIssue & { parentLinked: boolean }>;
  createComment(scope: Scope, ref: ExternalRef, body: string): Promise<ExternalRef>;
  setLabels(
    scope: Scope,
    ref: ExternalRef,
    change: { add: string[]; remove: string[] },
  ): Promise<void>;
  /** What the binding picker offers. */
  listContainers(): Promise<Container[]>;
}

/** What a Run needs to clone, and what it opens when it has pushed. */
export interface ForgeCredential {
  cloneUrl: string;
  username: string;
  secret: string;
  expiresAt: Date | null;
}

export interface PullRequestDraft {
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface ForgeSocket {
  credential(scope: Scope): Promise<ForgeCredential>;
  openPullRequest(scope: Scope, draft: PullRequestDraft): Promise<{ url: string; number: number }>;
}

export interface DocsSocket {
  readPage(ref: { url: string } | { externalId: string }): Promise<{
    title: string;
    markdown: string;
    url: string;
  }>;
}

/**
 * Who a Socket is on the tool's side. Recorded at connect, and read by the
 * inbound loop guard: a comment by this login is deevy's own mirror coming
 * back, and it rules nothing (ADR-0025).
 */
export interface SocketIdentity {
  login: string;
  id: string;
  /** What a Human types to name deevy there: `@deevy`. */
  mentionHandle: string;
}

/**
 * What a provider's own redirect left deevy with, at `/hooks/:socketId/setup`.
 *
 * Everything is optional because the two flows behind it are different shapes:
 * GitHub's manifest conversion hands back a whole App — credentials, a webhook
 * secret and an identity — while an installation callback adds one line to the
 * configuration and nothing else (ADR-0024).
 */
export interface SetupResult {
  /** Merged into the Socket's configuration. Never a secret. */
  config?: Record<string, unknown>;
  /** Sealed and merged into the Socket's credentials (secrets.ts). */
  credentials?: Record<string, string>;
  /** Sealed as the Socket's webhook secret, where the provider minted one. */
  webhookSecret?: string;
  /** Who deevy turned out to be there, where the flow settled it. */
  identity?: SocketIdentity;
  /** Where to send the operator's browser next, relative to deevy's own origin. */
  redirectTo?: string;
  /** What the log should say happened. */
  summary?: string;
}

export interface SetupInput {
  /** The query the provider redirected with, as strings. */
  params: Record<string, string>;
}

export interface SocketModule {
  provider: SocketProvider;
  capabilities: ReadonlySet<SocketCapability>;
  /** Proves the credential at connect, and is what `sockets.test` re-asks. */
  identity(): Promise<SocketIdentity>;
  /**
   * Takes the provider's own redirect, where connecting one takes more than a
   * paste: GitHub's App manifest conversion and its installation callback are
   * both this. A provider without such a flow leaves it out and the route
   * answers that it has nothing to finish.
   */
  setup?(input: SetupInput): Promise<SetupResult>;
  tracker?: TrackerSocket;
  forge?: ForgeSocket;
  docs?: DocsSocket;
}

export interface SocketModuleInput {
  /** The Socket row's `config`: everything about the connection that is not a secret. */
  config: Record<string, unknown>;
  /** Opened from the sealed column. A provider with nothing to hold gets `{}`. */
  credentials: Record<string, string>;
  /** Injected, so a provider test reaches a fixture rather than the network. */
  fetch: typeof fetch;
  now: () => Date;
}

/** What an entry hands `createApp`: the providers this deployment can speak. */
export type SocketModules = Partial<
  Record<SocketProvider, (input: SocketModuleInput) => SocketModule>
>;
