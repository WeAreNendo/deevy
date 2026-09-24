import type {
  Container,
  ExternalComment,
  ExternalIssue,
  ExternalRef,
  InboundCheck,
  InboundEvent,
  InboundInput,
  IssueDraft,
  IssuePage,
  IssueQuery,
  LinkedAccount,
  Scope,
  SetupInput,
  SetupResult,
  SocketIdentity,
  SocketModule,
  SocketModuleInput,
} from "@deevy/core/sockets";
import { hmacHex, sameText } from "../signing.ts";
import { commentOf, issueOf, normalizeLinear } from "./payloads.ts";

/**
 * Linear, as a tracker deevy projects from (ADR-0024).
 *
 * One Linear OAuth application is one Socket, in the one Linear workspace it
 * was made in. deevy acts as the application itself — Linear's `app` actor —
 * so every comment and label is the app's, not whichever Human connected it.
 * The token for that comes from the client-credentials grant, minted from the
 * client id and secret the operator pasted: Linear's authorization-code tokens
 * live a day and rotate their refresh token on every use, which would need a
 * writer the port does not have, while this one is minted again whenever it
 * is needed, the way a GitHub installation token is.
 *
 * A team is a container. A Project is bound to one, and its issues' routing
 * labels are read by name.
 *
 * Everything here is `fetch` and `crypto.subtle`, for the Worker's sake.
 */

export interface LinearConfig {
  /** The workspace the app is in, learned at connect: an Identity's instance (ADR-0025). */
  organizationId?: string;
  organizationName?: string;
  urlKey?: string;
  /** Whether the app was installed so people can assign issues to it. */
  assignable?: boolean;
  /** Linear's API root. The tests set it; nobody else needs to. */
  apiBase?: string;
}

export interface LinearCredentials {
  clientId?: string;
  clientSecret?: string;
}

const DEFAULT_API = "https://api.linear.app";
const AUTHORIZE_URL = "https://linear.app/oauth/authorize";

/**
 * What the app asks for: reading the teams it can see and writing on their
 * issues. Nothing that administers the workspace.
 */
const APP_SCOPES = "read,write";

/**
 * What installing it as an agent adds: being a delegate on an issue — which is
 * what Linear's "assign" does to an app — and being mentioned.
 */
const INSTALL_SCOPES = "read,write,app:assignable,app:mentionable";

/** Linear's advice for how old a signed delivery may be before it is a replay. */
const WINDOW_MS = 60_000;

/** How long before a minted token's expiry deevy stops trusting it. */
const TOKEN_SLACK_MS = 60_000;

/**
 * App tokens, shared across requests in one isolate.
 *
 * A module is built per request, and a token lives thirty days: minting one per
 * delivery would be a round trip for nothing, and Linear keeps at most a
 * thousand alive per app.
 */
const tokens = new Map<string, { token: string; expiresAt: number }>();

/** Forgets every cached token. A test that mints one twice calls it first. */
export function resetLinearTokens(): void {
  tokens.clear();
}

const ISSUE_FIELDS = `
fragment DeevyIssueFields on Issue {
  id identifier url title description updatedAt
  parent { id }
  delegate { id }
  assignee { id name displayName }
  state { name type }
  labels { nodes { name } }
  team { id }
}`;

const WHO = `query DeevyWho { viewer { id name displayName } organization { id name urlKey } }`;

interface Who {
  viewer: { id: string; name: string; displayName?: string };
  organization: { id: string; name: string; urlKey: string };
}

/** The team a scope names: its id, which is what a Project's binding stores. */
function teamOf(scope: Scope): string {
  const team = typeof scope.scopeKey === "string" ? scope.scopeKey : "";
  if (!team) throw new Error("That scope names no Linear team");
  return team;
}

class LinearError extends Error {
  constructor(
    message: string,
    readonly unauthenticated: boolean,
  ) {
    super(message);
  }
}

export function createLinearSocket({
  config,
  credentials,
  fetch,
  now,
}: SocketModuleInput): SocketModule {
  const settings = config as LinearConfig;
  const secrets = credentials as LinearCredentials;
  const api = (settings.apiBase ?? DEFAULT_API).replace(/\/+$/, "");

  function client(): { id: string; secret: string } {
    if (!secrets.clientId || !secrets.clientSecret) {
      throw new Error("This Linear Socket has no client id and secret; connect it again.");
    }
    return { id: secrets.clientId, secret: secrets.clientSecret };
  }

  async function form<T>(path: string, fields: Record<string, string>, token?: string) {
    const response = await fetch(`${api}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: new URLSearchParams(fields).toString(),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Linear answered ${String(response.status)} for ${path}: ${detail}`);
    }
    return (await response.json()) as T;
  }

  /** A token for the app itself, from the one in hand or a fresh grant. */
  async function appToken(): Promise<string> {
    const { id, secret } = client();
    const cacheKey = `${api}:${id}`;
    const held = tokens.get(cacheKey);
    if (held && held.expiresAt - TOKEN_SLACK_MS > now().getTime()) return held.token;
    const minted = await form<{ access_token: string; expires_in?: number }>("/oauth/token", {
      grant_type: "client_credentials",
      scope: APP_SCOPES,
      client_id: id,
      client_secret: secret,
    });
    tokens.set(cacheKey, {
      token: minted.access_token,
      expiresAt: now().getTime() + (minted.expires_in ?? 86_400) * 1000,
    });
    return minted.access_token;
  }

  /** Trades a code Linear sent a browser back with, as an authorization-code grant. */
  async function exchange(code: string, redirectUri: string): Promise<string> {
    const { id, secret } = client();
    const traded = await form<{ access_token: string }>("/oauth/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: id,
      client_secret: secret,
    });
    return traded.access_token;
  }

  async function graphql<T>(
    token: string,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const operation = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "a query";
    const response = await fetch(`${api}/graphql`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "user-agent": "deevy",
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      data?: T;
      errors?: { message?: string; extensions?: { code?: string } }[];
    };
    const errors = body.errors ?? [];
    if (!response.ok || errors.length > 0 || body.data === undefined) {
      const unauthenticated =
        response.status === 401 ||
        errors.some((error) => error.extensions?.code === "AUTHENTICATION_ERROR");
      const said = errors.map((error) => error.message ?? "").join("; ");
      throw new LinearError(
        `Linear answered ${String(response.status)} for ${operation}: ${said || "nothing"}`,
        unauthenticated,
      );
    }
    return body.data;
  }

  /**
   * As the app. A token Linear stopped taking — the client secret was rotated,
   * or the app is past its thousand — is forgotten and replaced, once.
   */
  async function asApp<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    try {
      return await graphql<T>(await appToken(), query, variables);
    } catch (error) {
      if (!(error instanceof LinearError) || !error.unauthenticated) throw error;
      tokens.delete(`${api}:${client().id}`);
      return graphql<T>(await appToken(), query, variables);
    }
  }

  /**
   * The ids of labels named on a team: its own first, then the workspace's,
   * and — when asked to — one made on the team for a name nobody has used.
   * Linear's labels are ids; deevy's routing and its mirror both speak names.
   */
  async function labelIds(team: string, names: string[], make: boolean): Promise<string[]> {
    if (names.length === 0) return [];
    const found = await asApp<{
      issueLabels: { nodes: { id: string; name: string; team: { id: string } | null }[] };
    }>(
      `query DeevyLabels($names: [String!]) {
        issueLabels(filter: { name: { in: $names } }, first: 100) { nodes { id name team { id } } }
      }`,
      { names },
    );
    const ids: string[] = [];
    for (const name of names) {
      const named = found.issueLabels.nodes.filter((label) => label.name === name);
      const label =
        named.find((one) => one.team?.id === team) ?? named.find((one) => one.team === null);
      if (label) {
        ids.push(label.id);
        continue;
      }
      if (!make) continue;
      const made = await asApp<{ issueLabelCreate: { issueLabel: { id: string } } }>(
        `mutation DeevyLabelCreate($input: IssueLabelCreateInput!) {
          issueLabelCreate(input: $input) { success issueLabel { id } }
        }`,
        { input: { name, teamId: team } },
      );
      ids.push(made.issueLabelCreate.issueLabel.id);
    }
    return ids;
  }

  /** Who a token belongs to, and in which workspace. */
  function whoIs(token: string): Promise<Who> {
    return graphql<Who>(token, WHO);
  }

  return {
    provider: "linear",
    capabilities: new Set(["tracker"] as const),
    // Linear's accounts are nobody's sign-in, so nothing is shared with one:
    // a Human links theirs through Linear's own consent (`accountLink`).
    identityScope: { instance: settings.organizationId ?? "linear" },

    /** The app's own user in this workspace, which is who every comment is by. */
    async identity(): Promise<SocketIdentity> {
      const who = await asApp<Who>(WHO);
      const login = who.viewer.displayName || who.viewer.name;
      return {
        login,
        id: who.viewer.id,
        mentionHandle: `@${login}`,
        learned: {
          organizationId: who.organization.id,
          organizationName: who.organization.name,
          urlKey: who.organization.urlKey,
        },
      };
    },

    /**
     * Where an admin's install of the app as an agent lands (ADR-0024).
     *
     * Installing with `actor=app` is what lets people assign an issue to deevy
     * — Linear makes the app the issue's delegate — and it takes a workspace
     * admin's consent on Linear's own page. The code proves that consent; the
     * token it buys is not kept, because the app's own grant is what deevy
     * works with.
     */
    async setup({ params, redirectUri }: SetupInput): Promise<SetupResult> {
      if (params.error) {
        throw new Error(
          `Linear did not install the app: ${params.error_description ?? params.error}`,
        );
      }
      if (!params.code || !redirectUri) {
        throw new Error("That redirect carried nothing to finish connecting with.");
      }
      const who = await whoIs(await exchange(params.code, redirectUri));
      if (settings.organizationId && who.organization.id !== settings.organizationId) {
        throw new Error(
          `That install was in another Linear workspace than the one this Socket reads (${who.organization.name}).`,
        );
      }
      return {
        config: { assignable: true },
        summary: `People can assign issues to deevy in ${who.organization.name}`,
      };
    },

    /** Where an admin installs the app as an agent, coming back to `setup`. */
    install({ redirectUri, state }) {
      const search = new URLSearchParams({
        client_id: client().id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: INSTALL_SCOPES,
        state,
        actor: "app",
      });
      return `${AUTHORIZE_URL}?${search.toString()}`;
    },

    accountLink: {
      authorizeUrl({ redirectUri, state }) {
        const search = new URLSearchParams({
          client_id: client().id,
          redirect_uri: redirectUri,
          response_type: "code",
          // Who they are, and nothing they can do: the token is spent on one
          // question and given back.
          scope: "read",
          state,
          prompt: "consent",
        });
        return `${AUTHORIZE_URL}?${search.toString()}`;
      },

      async account({ code, redirectUri }): Promise<LinkedAccount> {
        const token = await exchange(code, redirectUri);
        const who = await whoIs(token);
        // Given back as soon as it has answered: deevy keeps nothing that
        // could act as the Human in Linear (ADR-0025).
        await form("/oauth/revoke", { token }, token).catch(() => undefined);
        return {
          id: who.viewer.id,
          login: who.viewer.displayName || who.viewer.name,
          instance: who.organization.id,
        };
      },
    },

    tracker: {
      async verifyInbound({
        headers,
        rawBody,
        webhookSecret,
        now: at,
      }: InboundInput): Promise<InboundCheck> {
        const eventName = headers.get("linear-event") ?? "";
        const deliveryId = headers.get("linear-delivery");
        const refused = { ok: false, deliveryId, eventName };
        const signature = (headers.get("linear-signature") ?? "").toLowerCase();
        if (!sameText(signature, await hmacHex(webhookSecret, rawBody))) return refused;

        // Inside the signed body, so it cannot be changed without the
        // signature changing too. Linear's own advice is a minute.
        let sent = Number.NaN;
        try {
          sent = Number((JSON.parse(rawBody) as { webhookTimestamp?: unknown }).webhookTimestamp);
        } catch {
          return refused;
        }
        const received = (at ?? now()).getTime();
        if (!Number.isFinite(sent) || Math.abs(received - sent) > WINDOW_MS) return refused;
        return { ok: true, deliveryId, eventName };
      },

      normalize(eventName: string, payload: unknown): InboundEvent[] {
        return normalizeLinear(eventName, payload);
      },

      async getIssue(_scope: Scope, ref: ExternalRef): Promise<ExternalIssue> {
        const found = await asApp<{ issue: unknown }>(
          `query DeevyIssue($id: String!) { issue(id: $id) { ...DeevyIssueFields } } ${ISSUE_FIELDS}`,
          { id: ref.externalId },
        );
        const issue = issueOf(found.issue);
        if (!issue) throw new Error(`Linear answered with no issue for ${ref.url}`);
        return issue;
      },

      /**
       * What changed on a team since deevy last looked, oldest change first.
       * Linear orders by the newest change, so the oldest page is its last one:
       * asked for with `last`, turned round here, and continued with `before`.
       */
      async listIssues(scope: Scope, query: IssueQuery): Promise<IssuePage> {
        const found = await asApp<{
          issues: {
            nodes: unknown[];
            pageInfo: { hasPreviousPage: boolean; startCursor: string | null };
          };
        }>(
          `query DeevyIssues($filter: IssueFilter, $last: Int, $before: String) {
            issues(filter: $filter, last: $last, before: $before, orderBy: updatedAt) {
              nodes { ...DeevyIssueFields }
              pageInfo { hasPreviousPage startCursor }
            }
          } ${ISSUE_FIELDS}`,
          {
            filter: {
              team: { id: { eq: teamOf(scope) } },
              ...(query.updatedSince
                ? { updatedAt: { gt: query.updatedSince.toISOString() } }
                : {}),
            },
            last: query.limit,
            before: query.cursor,
          },
        );
        const issues = found.issues.nodes
          .map((node) => issueOf(node))
          .filter((issue): issue is ExternalIssue => issue !== null)
          .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
        const { hasPreviousPage, startCursor } = found.issues.pageInfo;
        return { issues, nextCursor: hasPreviousPage ? startCursor : null };
      },

      async listComments(
        _scope: Scope,
        ref: ExternalRef,
        limit: number,
      ): Promise<ExternalComment[]> {
        const found = await asApp<{ issue: { comments: { nodes: unknown[] } } | null }>(
          `query DeevyComments($id: String!, $first: Int) {
            issue(id: $id) {
              comments(first: $first) {
                nodes { id body url createdAt user { id name displayName } botActor { id name type } }
              }
            }
          }`,
          { id: ref.externalId, first: limit },
        );
        return (found.issue?.comments.nodes ?? [])
          .map((node) => commentOf(node))
          .filter((comment): comment is ExternalComment => comment !== null)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      },

      /** Under its parent natively: Linear has sub-issues everywhere. */
      async createIssue(
        scope: Scope,
        draft: IssueDraft,
      ): Promise<ExternalIssue & { parentLinked: boolean }> {
        const team = teamOf(scope);
        const labels = await labelIds(team, draft.labels, true);
        const created = await asApp<{ issueCreate: { issue: unknown } }>(
          `mutation DeevyIssueCreate($input: IssueCreateInput!) {
            issueCreate(input: $input) { success issue { ...DeevyIssueFields } }
          } ${ISSUE_FIELDS}`,
          {
            input: {
              teamId: team,
              title: draft.title,
              description: draft.body,
              ...(draft.parent ? { parentId: draft.parent.externalId } : {}),
              ...(labels.length > 0 ? { labelIds: labels } : {}),
            },
          },
        );
        const issue = issueOf(created.issueCreate.issue);
        if (!issue) throw new Error("Linear answered with no issue after creating one");
        return { ...issue, parentLinked: draft.parent !== null };
      },

      async createComment(_scope: Scope, ref: ExternalRef, body: string): Promise<ExternalRef> {
        const created = await asApp<{ commentCreate: { comment: { id: string; url: string } } }>(
          `mutation DeevyCommentCreate($input: CommentCreateInput!) {
            commentCreate(input: $input) { success comment { id url } }
          }`,
          { input: { issueId: ref.externalId, body } },
        );
        return {
          externalId: created.commentCreate.comment.id,
          url: created.commentCreate.comment.url,
        };
      },

      /**
       * By name. A label added that the team has never had is made on first
       * use, which is the lazy creation the mirror relies on; one removed that
       * does not exist is not on the record, which is what was wanted.
       */
      async setLabels(
        scope: Scope,
        ref: ExternalRef,
        change: { add: string[]; remove: string[] },
      ): Promise<void> {
        const team = teamOf(scope);
        const added = await labelIds(team, change.add, true);
        const removed = await labelIds(team, change.remove, false);
        if (added.length === 0 && removed.length === 0) return;
        await asApp(
          `mutation DeevyLabelsChange($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) { success }
          }`,
          { id: ref.externalId, input: { addedLabelIds: added, removedLabelIds: removed } },
        );
      },

      /** Every team the app can see, which is every public team in the workspace. */
      async listContainers(): Promise<Container[]> {
        const found = await asApp<{
          teams: { nodes: { id: string; key: string; name: string }[] };
        }>(`query DeevyTeams { teams(first: 100) { nodes { id key name } } }`);
        return found.teams.nodes.map((team) => ({
          scope: { scopeKey: team.id, teamKey: team.key },
          scopeKey: team.id,
          name: `${team.name} (${team.key})`,
        }));
      },
    },
  };
}
