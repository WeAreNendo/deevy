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
  /**
   * Markdown. The core caps it on the way in; a provider need not. Absent where
   * the tool's list does not carry it — Notion's query answers properties, not
   * content — and then deevy keeps the body it had.
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

/** Who did something on the provider's side. Never matched on by `login` (ADR-0025). */
export interface ExternalActor {
  login: string;
  id: string;
  /** Whether this is a machine — including deevy's own Socket, whose comments rule nothing. */
  isBot: boolean;
  /**
   * The address the tool reports for them, where it reports one. Matched only
   * on a Socket whose admin allowed it, and only against an address a Member
   * has verified: for a tool with nothing better to offer (ADR-0025).
   */
  email?: string;
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

/** What a forge opened: where it is, its number, and what the forge calls it. */
export interface OpenedPullRequest {
  url: string;
  number: number;
  /** The forge's own words for it — `Merge request !7` on GitLab. Absent, `Pull request #7`. */
  label?: string;
}

export interface ForgeSocket {
  credential(scope: Scope): Promise<ForgeCredential>;
  openPullRequest(scope: Scope, draft: PullRequestDraft): Promise<OpenedPullRequest>;
}

/** Who clicked or typed in a chat tool: one user, in one team. */
export interface ChatActor {
  /** The team the user belongs to, which is the Identity's instance (ADR-0025). */
  team: string;
  /** The tool's own id for the user. The only thing ever matched on. */
  user: string;
  /** What the tool calls them, for a screen and a reply. Never matched on. */
  login: string;
}

/** Where a message lives in a chat tool, which is what a later update names. */
export interface ChatMessageRef {
  channel: string;
  ts: string;
}

/**
 * What one request from a chat tool means, in deevy's terms. `normalizeInteraction`
 * is pure, like a tracker's `normalize`: the parsed request in, this out.
 */
export type ChatInteraction =
  | {
      kind: "ruling";
      actor: ChatActor;
      gateRequestId: string;
      decision: "approved" | "rejected";
      note: string | null;
      /**
       * A rejection asked for from a button, before its author has said why:
       * deevy asks for the note first (`askForNote`), and the answer arrives
       * as a second interaction carrying it.
       */
      wantsNote: boolean;
      /** The message the click was on, so a reply and an update can find it. */
      message: ChatMessageRef | null;
      /** Where to answer the clicker alone, for about half an hour. */
      responseUrl: string | null;
      /** What opening a dialog in answer needs, for about three seconds. */
      triggerId: string | null;
    }
  | { kind: "link"; actor: ChatActor; responseUrl: string | null }
  | { kind: "ignored"; why: string };

/** What deevy answers a chat tool's request with, which the tool renders its own way. */
export type ChatReply =
  | { kind: "none" }
  /** Said to the one person who asked, and nobody else. */
  | { kind: "private"; text: string }
  /** A dialog's answer that keeps it open and says what is wrong. */
  | { kind: "dialog_error"; text: string };

/**
 * A Gate as a chat message shows one: what the Agent proposed, the arithmetic,
 * and — while it is open — the two buttons. The provider renders it; deevy
 * decides what it says (ADR-0025).
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
  /** Where a Human opens it in deevy. */
  url: string;
  /** Who ruled, and how, once somebody has: a line per Ruling. */
  rulings: string[];
}

/** One message deevy sends to a chat tool: words and a link, or a Gate. */
export type ChatMessage =
  | { kind: "text"; text: string; link: { url: string; label: string } | null }
  | { kind: "gate"; gate: ChatGateMessage };

export interface ChatSocket {
  /**
   * Whether this request is really from the tool. A chat tool signs a
   * timestamp with the body, and a request older than a few minutes is a
   * replay whatever its signature says. Never throws.
   */
  verifyInteraction(input: InboundInput): Promise<InboundCheck>;
  /** Pure. The request, as the tool sent it, in deevy's terms. */
  normalizeInteraction(eventName: string, rawBody: string): ChatInteraction;
  /** The HTTP answer the tool expects for this reply. */
  answer(reply: ChatReply): Response;
  post(channel: string, message: ChatMessage): Promise<ChatMessageRef>;
  update(ref: ChatMessageRef, message: ChatMessage): Promise<void>;
  /** The direct conversation with one user, opened if it was not. */
  openDm(user: string): Promise<string>;
  /** A dialog asking why, for a rejection clicked from a button. */
  askForNote(
    triggerId: string,
    input: { gateRequestId: string; checkpoint: string; message: ChatMessageRef | null },
  ): Promise<void>;
  /** Says something to the one person who clicked, where only they see it. */
  respond(responseUrl: string, text: string): Promise<void>;
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

/** An account on a tool, as the tool itself said whose it is (ADR-0025). */
export interface LinkedAccount {
  /** The tool's own id for the account: the only thing ever matched on. */
  id: string;
  /** What the tool calls them, for a screen. Never matched on. */
  login: string;
  /** Where the account lives, which must be where the Socket's accounts do. */
  instance: string;
}

/**
 * How a Human proves an account on this tool is theirs, where the tool has an
 * OAuth grant of its own and is not a provider deevy signs people in with:
 * Linear. The Human consents on the tool's own page, the tool sends them back
 * with a code, and what the code answers is the proof — deevy keeps no token
 * (ADR-0025).
 */
export interface AccountLink {
  /** Where to send the Human's browser to consent, as themselves. */
  authorizeUrl(input: { redirectUri: string; state: string }): string;
  /** Spends the code once and answers whose account consented. */
  account(input: { code: string; redirectUri: string }): Promise<LinkedAccount>;
}

/**
 * Where this tool's accounts live, which is what an Identity is keyed by
 * (ADR-0025).
 *
 * `instance` tells two of one kind apart — github.com and a GitHub Enterprise
 * Server, a Linear organisation, a Slack team — because an account id means
 * nothing without the place that issued it. `signInProvider` says the accounts
 * here are the same accounts deevy signs people in with, so a Human who signed
 * in to deevy with one rules from here with no linking step.
 */
export interface IdentityScope {
  instance: string;
  signInProvider?: "github" | "gitlab";
}

export interface SocketModule {
  provider: SocketProvider;
  capabilities: ReadonlySet<SocketCapability>;
  /** Where its accounts live. Absent, the provider's name is the instance and nothing is shared. */
  identityScope?: IdentityScope;
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
  /** Present where a Human links an account here through the tool's own OAuth. */
  accountLink?: AccountLink;
  tracker?: TrackerSocket;
  forge?: ForgeSocket;
  docs?: DocsSocket;
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
 * Whether a comment is a Ruling, and which: the first line and nothing else,
 * `/approve`, or `/reject <why>`, with the rest of the comment as the note
 * (ADR-0025). A comment that merely mentions the word is a comment.
 *
 * One parser for every tracker, because the command is deevy's rather than
 * any tool's, and a Human who rules from GitHub and from Linear should not
 * learn two grammars.
 */
export function parseRulingCommand(
  body: string,
): { decision: "approved" | "rejected"; note: string | null } | null {
  const [first = "", ...rest] = body.trim().split("\n");
  const match = /^\/(approve|reject)\b\s*(.*)$/i.exec(first.trim());
  if (!match) return null;
  const note = [match[2] ?? "", ...rest].join("\n").trim();
  return {
    decision: match[1]?.toLowerCase() === "approve" ? "approved" : "rejected",
    note: note || null,
  };
}

/** What an entry hands `createApp`: the providers this deployment can speak. */
export type SocketModules = Partial<
  Record<SocketProvider, (input: SocketModuleInput) => SocketModule>
>;
