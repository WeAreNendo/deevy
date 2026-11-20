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
 * A Socket listens and announces (docs/plans/simplify.md, slice 4): it takes
 * the tool's deliveries and says on the record when a Gate opens and when it
 * is ruled on. Reading and writing the tool is the Agent's business, with its
 * own access, so a tracker needs three methods and the rest are for the tools
 * that cannot do without them.
 */

export const socketProviders = [
  "github",
  "linear",
  "gitlab",
  "notion",
  "slack",
  "generic",
  "stub",
] as const;
export type SocketProvider = (typeof socketProviders)[number];

export const socketCapabilities = ["tracker", "chat"] as const;
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
  /**
   * Markdown. The core caps it on the way in; a provider need not. Absent where
   * the tool's delivery does not carry it, and then deevy keeps the body it had.
   */
  body?: string | null;
  state: "open" | "closed";
  /** The provider's own word: `open`, `Done`, `In Review`. */
  stateName: string;
  assignees: { login: string; id: string }[];
  labels: string[];
  parentExternalId: string | null;
  /**
   * The account the tracker handed the record to on a Human's behalf, where
   * the tool has such a thing: assigning a Linear issue to an app makes the
   * app its delegate and leaves the Human its assignee. Read to route, never
   * stored (ADR-0024).
   */
  delegateId?: string | null;
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

/** Who did something on the provider's side, as the tool names them. */
export interface ExternalActor {
  login: string;
  id: string;
  /**
   * Whether this is a machine, deevy's own Socket among them: what deevy said
   * on a record coming back is not a comment anybody made.
   */
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
  /**
   * Where the tool's app is installed, added to what the Socket keeps, or with
   * `removed` taken off it: deleted, or suspended, where it works nothing
   * until it is unsuspended and arrives as an installation again.
   */
  | {
      kind: "installation";
      installations: { id: string; account: string }[];
      removed?: "deleted" | "suspended";
    }
  /**
   * A record changed, and the delivery says only which one: Notion's webhooks
   * name what changed and carry none of it. deevy reads the record back
   * through the Project's binding (`getIssue`) and applies it as an `issue`.
   */
  | { kind: "changed"; scopeKey: string; issueExternalId: string; actor: ExternalActor | null }
  /** The same for a comment: which one, on which record, to be read back (`getComment`). */
  | { kind: "commented"; issueExternalId: string; commentExternalId: string }
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
  /**
   * Says something on a record: a Gate waiting, and the Ruling that settled
   * it. Null where the tool takes nothing from deevy this way: the generic
   * Socket, whose adapter hears the Gate's own Events on the Workspace's
   * webhooks and says it in the tool itself.
   */
  createComment(scope: Scope, ref: ExternalRef, body: string): Promise<ExternalRef | null>;
  /**
   * One record, for a tool whose deliveries only name it (`changed`): Notion's.
   * Absent, such a delivery is skipped.
   */
  getIssue?(scope: Scope, ref: ExternalRef): Promise<ExternalIssue>;
  /**
   * One comment by its id, for a tool whose deliveries only name it
   * (`commented`). Null when it is gone.
   */
  getComment?(scope: Scope, ref: ExternalRef, commentId: string): Promise<ExternalComment | null>;
  /**
   * The signing secret a tool sends once, unsigned, to establish it: Notion's
   * `verification_token`. Null for any other request. deevy keeps what it is
   * given until a delivery signed with it proves it was the tool's, and not
   * after (sockets/hooks.ts).
   */
  handshake?(rawBody: string): string | null;
  /**
   * What the binding picker offers. Absent, an admin types the container's
   * key instead (`sockets.containers` answers null).
   */
  listContainers?(): Promise<Container[]>;
}

/** Where a message lives in a chat tool, which is what a later update names. */
export interface ChatMessageRef {
  channel: string;
  ts: string;
}

/**
 * A Gate as a chat message shows one: what the Agent proposed, the arithmetic,
 * and where to rule on it in deevy. The provider renders it; deevy decides what
 * it says, and nothing in it rules (ADR-0036).
 */
export interface ChatGateMessage {
  gateRequestId: string;
  /** The record it is about, as the tracker names it, with its URL. */
  issueKey: string;
  issueUrl: string;
  checkpoint: string;
  proposal: string;
  /** The Agent asking, and the Run it asked from. */
  agentName: string | null;
  runId: string;
  status: "open" | "approved" | "rejected" | "superseded";
  approvals: number;
  required: number;
  /** Where a Human rules on it, in deevy. */
  url: string;
  /** Who ruled, and how, once somebody has: a line per Ruling. */
  rulings: string[];
}

/** A channel deevy could post a Project's Gates in, as the picker offers it. */
export interface ChatChannel {
  /** The tool's own id for it, which a Project binds: `C0123ABCD` in Slack. */
  id: string;
  /** What a Human calls it, without the `#`. */
  name: string;
}

/** One message deevy sends to a chat tool: words and a link, or a Gate. */
export type ChatMessage =
  | { kind: "text"; text: string; link: { url: string; label: string } | null }
  | { kind: "gate"; gate: ChatGateMessage };

/**
 * A chat tool, which deevy tells and asks nothing of (ADR-0036): a Gate's
 * message is posted where a Project binds, and updated in place as it is ruled
 * on. A chat tool sends deevy nothing, so it has no inbound half.
 */
export interface ChatSocket {
  post(channel: string, message: ChatMessage): Promise<ChatMessageRef>;
  update(ref: ChatMessageRef, message: ChatMessage): Promise<void>;
  /**
   * The channels deevy could post in, which a Project's chat binding is picked
   * from. Absent, an admin types the channel's id instead (`sockets.channels`
   * answers null), as a tracker without `listContainers` has its key typed.
   */
  listChannels?(): Promise<ChatChannel[]>;
}

/**
 * Who a Socket is on the tool's side. Recorded at connect, and read by the
 * inbound loop guard: a comment by this login is deevy's own announcement
 * coming back.
 */
export interface SocketIdentity {
  login: string;
  id: string;
  /** What a Human types to name deevy there: `@deevy`. */
  mentionHandle: string;
  /**
   * What proving the credential taught deevy about the connection that is not
   * a secret — a Slack team's id — merged into the Socket's configuration at
   * connect and never stored as part of the identity.
   */
  learned?: Record<string, unknown>;
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
  /**
   * Where to send the operator's browser next: a path on deevy's own origin,
   * or an absolute https address on the tool itself, for a flow whose next
   * step is there (a GitHub App is made, then installed).
   */
  redirectTo?: string;
  /** What the log should say happened. */
  summary?: string;
}

export interface SetupInput {
  /** The query the provider redirected with, as strings. */
  params: Record<string, string>;
  /**
   * The address the provider redirected to, which an OAuth code exchange has
   * to name again exactly: Linear's install is one (ADR-0024).
   */
  redirectUri?: string;
}

/**
 * Who makes the secret a tool signs its deliveries with, which decides how a
 * Socket's is changed.
 *
 * - `either`: the tool's settings take a secret typed in, so deevy may mint
 *   one for it (`sockets.rotate`) or take one the tool has (`sockets.update`):
 *   a GitHub App's webhook secret, a GitLab webhook's secret or signing token.
 * - `tool`: the tool makes it and takes none typed in, so deevy can only take
 *   the tool's, and a minted one would refuse every delivery: a Linear
 *   webhook's.
 * - `handshake`: the tool sends it to establish its webhook and deevy keeps
 *   what it sent (hooks.ts): Notion's verification token. A minted one would
 *   replace it and break the webhook.
 * - `deevy`: deevy makes it when the Socket is connected, says it once, and
 *   whoever sends the tool's deliveries is given it: the generic Socket, whose
 *   sender is an adapter somebody wrote and has nowhere a secret comes from
 *   but deevy. A new one is minted the same way (`sockets.rotate`).
 * - `none`: the tool delivers nothing, so there is nothing to sign: a chat
 *   tool, which deevy only tells (ADR-0036). A secret typed in is refused.
 */
export const webhookSecretOrigins = ["either", "tool", "handshake", "deevy", "none"] as const;
export type WebhookSecretFrom = (typeof webhookSecretOrigins)[number];

export interface SocketModule {
  provider: SocketProvider;
  capabilities: ReadonlySet<SocketCapability>;
  /** Who makes what its deliveries are signed with: see `WebhookSecretFrom`. */
  webhookSecretFrom: WebhookSecretFrom;
  /**
   * Whether this module has been walked against the tool itself, rather than
   * only its recorded payloads (docs/plans/simplify.md, slice 7). Absent is
   * no, and Settings and the tool's page call it a Preview until it is.
   */
  walked?: boolean;
  /** Proves the credential at connect, and is what `sockets.test` re-asks. */
  identity(): Promise<SocketIdentity>;
  /**
   * Takes the provider's own redirect, where connecting one takes more than a
   * paste: GitHub's App manifest conversion and its installation callback are
   * both this. A provider without such a flow leaves it out and the route
   * answers that it has nothing to finish.
   */
  setup?(input: SetupInput): Promise<SetupResult>;
  /**
   * Why `sockets.begin` will not start this tool's own flow here, said in
   * words a screen can show an admin; absent where it may. A GitHub App's
   * manifest is a form deevy's pages may post only to github.com
   * (headers.ts), so a GitHub Socket on a GitHub Enterprise Server or
   * GHE.com is made there and pasted instead.
   */
  beginRefusal?: string;
  /**
   * Where an admin's browser goes to give the tool's app more than pasting
   * its credential could — Linear's install as an agent, which is what lets
   * people assign an issue to it — coming back to `setup` with a code.
   */
  install?(input: { redirectUri: string; state: string }): string;
  /**
   * Points the tool's own webhook at deevy's address, where the tool lets deevy
   * say it: a GitHub App's one webhook. For an instance whose address moved —
   * a laptop behind a tunnel with a new hostname — so nobody retypes it.
   */
  rewire?(url: string): Promise<void>;
  tracker?: TrackerSocket;
  chat?: ChatSocket;
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

/**
 * The signature deevy's webhooks carry, which is also the one a sender signs
 * a delivery to the generic Socket with: one scheme in both directions
 * (signature.ts).
 */
export { replayWindowSeconds, signPayload, verifySignature } from "../signature.ts";
export type { VerifyInput } from "../signature.ts";

/** What an entry hands `createApp`: the providers this deployment can speak. */
export type SocketModules = Partial<
  Record<SocketProvider, (input: SocketModuleInput) => SocketModule>
>;
