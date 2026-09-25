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
  Scope,
  SocketIdentity,
  SocketModule,
  SocketModuleInput,
} from "@deevy/core/sockets";
import { hmacHex, sameText } from "../signing.ts";
import {
  issueOf,
  normalizeNotion,
  notionScope,
  pageIdOf,
  plainText,
  scopeOf,
  titleOf,
} from "./payloads.ts";

/**
 * Notion, as a tracker and as where a team's documents live (ADR-0024).
 *
 * One internal connection (Notion's internal integration, renamed) is one
 * Socket, in the one workspace it was made in, and deevy acts as its bot
 * through the installation access token the operator pasted. A data
 * source — one table of a database — is a container: its rows are records,
 * and a Project's binding says which of its properties mean what. It sees only
 * the pages shared with the connection, which is Notion's own rule.
 *
 * Notion's webhooks name what changed and carry none of it, so a delivery is
 * read back here (`getIssue`, `getComment`); and Notion has no account a Human
 * can link, so an address it reports is the most it offers as proof of who
 * commented, taken only where an admin allowed it (ADR-0025).
 *
 * Everything here is `fetch` and `crypto.subtle`, for the Worker.
 */

export interface NotionConfig {
  /** The workspace the connection is in, learned at connect: an Identity's instance. */
  workspaceId?: string;
  workspaceName?: string;
  /** Notion's API root. The tests set it; nobody else needs to. */
  apiBase?: string;
}

export interface NotionCredentials {
  /** The connection's installation access token, `ntn_…`. */
  token?: string;
}

const DEFAULT_API = "https://api.notion.com";
const NOTION_VERSION = "2026-03-11";

interface NotionUser {
  id?: string;
  name?: string;
  type?: string;
  person?: { email?: string };
}

export function createNotionSocket({
  config,
  credentials,
  fetch,
}: SocketModuleInput): SocketModule {
  const settings = config as NotionConfig;
  const secrets = credentials as NotionCredentials;
  const api = (settings.apiBase ?? DEFAULT_API).replace(/\/+$/, "");

  function token(): string {
    if (!secrets.token) throw new Error("This Notion Socket has no secret; connect it again.");
    return secrets.token;
  }

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${api}/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token()}`,
        "notion-version": NOTION_VERSION,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const said = (await response.json().catch(() => ({}))) as {
        code?: unknown;
        message?: unknown;
      };
      const where = `${method} ${path.split("?")[0] ?? path}`;
      throw new NotionError(
        typeof said.message === "string" && said.message
          ? `${said.message} (${typeof said.code === "string" ? `${said.code}, ` : ""}${where})`
          : `Notion answered ${String(response.status)} (${where})`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  /** A page and its content, which Notion reads out as markdown itself. */
  async function pageWithMarkdown(id: string): Promise<{ page: unknown; markdown: string }> {
    const page = await call<unknown>("GET", `/pages/${id}`);
    const content = await call<{
      markdown?: string;
      truncated?: boolean;
      unknown_block_ids?: unknown[];
    }>("GET", `/pages/${id}/markdown`);
    const markdown = content.markdown ?? "";
    const gap = gapNote(
      content.truncated === true,
      content.unknown_block_ids?.length ?? 0,
      (page as { url?: string }).url,
    );
    return { page, markdown: gap ? `${markdown}\n\n${gap}` : markdown };
  }

  /** Who a user is, asked once per call however many comments they wrote. */
  function usersReader() {
    const known = new Map<string, Promise<NotionUser | null>>();
    return (id: string): Promise<NotionUser | null> => {
      let found = known.get(id);
      if (!found) {
        found = call<NotionUser>("GET", `/users/${id}`).catch(() => null);
        known.set(id, found);
      }
      return found;
    };
  }

  async function commentOf(
    comment: unknown,
    url: string,
    userOf: (id: string) => Promise<NotionUser | null>,
  ): Promise<ExternalComment | null> {
    const found = (comment ?? {}) as {
      id?: string;
      created_time?: string;
      created_by?: { id?: string };
      rich_text?: unknown;
    };
    if (!found.id) return null;
    const authorId = found.created_by?.id ?? "";
    const author = authorId ? await userOf(authorId) : null;
    const email = author?.person?.email;
    return {
      externalId: found.id,
      url,
      body: plainText(found.rich_text),
      author: {
        login: author?.name ?? "",
        id: authorId,
        isBot: author?.type === "bot",
        ...(email ? { email } : {}),
      },
      createdAt: new Date(found.created_time ?? Date.now()),
    };
  }

  function pageId(ref: ExternalRef): string {
    const id = pageIdOf(ref.externalId) ?? pageIdOf(ref.url);
    if (!id) throw new Error(`That names no Notion page: ${ref.url || ref.externalId}`);
    return id;
  }

  return {
    provider: "notion",
    capabilities: new Set(["tracker", "docs"] as const),
    // No account a Human can link, and nobody signs in with Notion: the
    // workspace is where its accounts live, and an address is the proof
    // (ADR-0025).
    identityScope: { instance: settings.workspaceId ?? "notion" },

    /**
     * The connection's bot, which is who every comment deevy writes is by. A
     * personal access token answers with the Human who made it instead, and
     * is refused: deevy would write as them, and its echo guard would drop
     * every comment of theirs — their `/approve` too — as its own.
     */
    async identity(): Promise<SocketIdentity> {
      const me = await call<{
        id: string;
        type?: string;
        name?: string;
        bot?: { workspace_id?: string; workspace_name?: string };
      }>("GET", "/users/me");
      if (me.type === "person") {
        throw new Error(
          `This is ${me.name ? `${me.name}'s` : "somebody's"} personal access token: deevy would write as them, and take their comments for its own. Make an internal connection in Notion's Developer portal and paste its installation access token.`,
        );
      }
      const login = me.name ?? "deevy";
      return {
        login,
        id: me.id,
        mentionHandle: `@${login}`,
        learned: {
          ...(me.bot?.workspace_id ? { workspaceId: me.bot.workspace_id } : {}),
          ...(me.bot?.workspace_name ? { workspaceName: me.bot.workspace_name } : {}),
        },
      };
    },

    tracker: {
      /** Once, unsigned, when a webhook subscription is made: the secret it will sign with. */
      handshake(rawBody: string): string | null {
        try {
          const body = JSON.parse(rawBody) as Record<string, unknown>;
          return typeof body.verification_token === "string" && body.type === undefined
            ? body.verification_token
            : null;
        } catch {
          return null;
        }
      },

      async verifyInbound({
        headers,
        rawBody,
        webhookSecret,
      }: InboundInput): Promise<InboundCheck> {
        let body: { id?: unknown; type?: unknown } = {};
        try {
          body = JSON.parse(rawBody) as typeof body;
        } catch {
          // Refused below either way: nothing unsigned is read.
        }
        const deliveryId = typeof body.id === "string" ? body.id : null;
        const eventName = typeof body.type === "string" ? body.type : "";
        const signature = headers.get("x-notion-signature") ?? "";
        const expected = `sha256=${await hmacHex(webhookSecret, rawBody)}`;
        return { ok: sameText(signature, expected), deliveryId, eventName };
      },

      normalize(eventName: string, payload: unknown): InboundEvent[] {
        return normalizeNotion(eventName, payload);
      },

      async getIssue(scope: Scope, ref: ExternalRef): Promise<ExternalIssue> {
        const { page, markdown } = await pageWithMarkdown(pageId(ref));
        const issue = issueOf(page, scope, markdown);
        if (!issue)
          throw new Error(`Notion answered with no page for ${ref.url || ref.externalId}`);
        return issue;
      },

      /**
       * What changed since, oldest edit first. A query answers properties and
       * not content, so the body is left unread and deevy keeps the one it had:
       * reading twenty pages' content would be twenty more requests a pass.
       */
      async listIssues(scope: Scope, query: IssueQuery): Promise<IssuePage> {
        const binding = notionScope(scope);
        const answer = await call<{
          results: unknown[];
          next_cursor: string | null;
          has_more: boolean;
        }>("POST", `/data_sources/${binding.scopeKey}/query`, {
          ...(query.updatedSince
            ? {
                filter: {
                  timestamp: "last_edited_time",
                  last_edited_time: { on_or_after: query.updatedSince.toISOString() },
                },
              }
            : {}),
          sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
          page_size: query.limit,
          ...(query.cursor ? { start_cursor: query.cursor } : {}),
        });
        const issues = answer.results
          .map((page) => issueOf(page, scope))
          .filter((issue): issue is ExternalIssue => issue !== null);
        return { issues, nextCursor: answer.has_more ? answer.next_cursor : null };
      },

      async listComments(
        _scope: Scope,
        ref: ExternalRef,
        limit: number,
      ): Promise<ExternalComment[]> {
        const answer = await call<{ results: unknown[] }>(
          "GET",
          `/comments?block_id=${pageId(ref)}&page_size=${String(limit)}`,
        );
        const userOf = usersReader();
        const comments = await Promise.all(
          answer.results.map((comment) => commentOf(comment, ref.url, userOf)),
        );
        return comments.filter((comment): comment is ExternalComment => comment !== null);
      },

      async getComment(
        _scope: Scope,
        ref: ExternalRef,
        commentId: string,
      ): Promise<ExternalComment | null> {
        try {
          const comment = await call<unknown>("GET", `/comments/${commentId}`);
          return await commentOf(comment, ref.url, usersReader());
        } catch (error) {
          if (error instanceof NotionError && error.status === 404) return null;
          throw error;
        }
      },

      /** A row, with its labels, its parent where the data source has sub-items, and its content. */
      async createIssue(
        scope: Scope,
        draft: IssueDraft,
      ): Promise<ExternalIssue & { parentLinked: boolean }> {
        const binding = notionScope(scope);
        const parentLinked = Boolean(draft.parent && binding.parentProperty);
        const page = await call<unknown>("POST", "/pages", {
          parent: { data_source_id: binding.scopeKey },
          properties: {
            [binding.titleProperty ?? "Name"]: { title: [{ text: { content: draft.title } }] },
            ...(binding.labelsProperty && draft.labels.length > 0
              ? {
                  [binding.labelsProperty]: {
                    multi_select: draft.labels.map((name) => ({ name })),
                  },
                }
              : {}),
            ...(draft.parent && binding.parentProperty
              ? { [binding.parentProperty]: { relation: [{ id: pageId(draft.parent) }] } }
              : {}),
          },
          markdown: draft.body,
        });
        const issue = issueOf(page, scope, draft.body);
        if (!issue) throw new Error("Notion answered with no page after creating one");
        return { ...issue, parentLinked };
      },

      /** Markdown, which a Notion comment keeps for its inline marks. */
      async createComment(_scope: Scope, ref: ExternalRef, body: string): Promise<ExternalRef> {
        const created = await call<{ id: string }>("POST", "/comments", {
          parent: { page_id: pageId(ref) },
          markdown: body,
        });
        return { externalId: created.id, url: ref.url };
      },

      /**
       * A multi-select holds its whole value, so the change is read, applied
       * and written back — and not written when it changed nothing. A name
       * Notion has never seen becomes an option as it is set, which is the lazy
       * creation the mirror relies on. A data source with no labels property
       * has nothing to label with.
       */
      async setLabels(
        scope: Scope,
        ref: ExternalRef,
        change: { add: string[]; remove: string[] },
      ): Promise<void> {
        const property = notionScope(scope).labelsProperty;
        if (!property) return;
        const id = pageId(ref);
        const page = await call<{ properties?: Record<string, { multi_select?: unknown }> }>(
          "GET",
          `/pages/${id}`,
        );
        const current = (
          Array.isArray(page.properties?.[property]?.multi_select)
            ? (page.properties[property].multi_select as { name?: string }[])
            : []
        ).map((option) => option.name ?? "");
        const next = [
          ...current.filter((name) => !change.remove.includes(name)),
          ...change.add.filter((name) => !current.includes(name)),
        ];
        const same =
          next.length === current.length && next.every((name, at) => name === current[at]);
        if (same) return;
        await call("PATCH", `/pages/${id}`, {
          properties: { [property]: { multi_select: next.map((name) => ({ name })) } },
        });
      },

      /** Every data source the connection was shared, with what its schema says to read. */
      async listContainers(): Promise<Container[]> {
        const answer = await call<{ results: unknown[] }>("POST", "/search", {
          filter: { property: "object", value: "data_source" },
          page_size: 100,
        });
        const containers: Container[] = [];
        for (const result of answer.results) {
          const read = scopeOf(result);
          if (!read) continue;
          containers.push({
            scope: { ...read.scope },
            scopeKey: read.scope.scopeKey,
            name: read.name,
          });
        }
        return containers;
      },
    },

    docs: {
      /** A page as Notion writes it out in markdown, by its URL or its id. */
      async readPage(ref) {
        const named = "url" in ref ? ref.url : ref.externalId;
        const id = pageIdOf(named);
        if (!id) throw new Error(`That names no Notion page: ${named}`);
        const { page, markdown } = await pageWithMarkdown(id);
        const url = (page as { url?: string }).url ?? ("url" in ref ? ref.url : "");
        return { title: titleOf(page), markdown, url };
      },
    },
  };
}

/**
 * What a reader is owed when Notion's markdown is not the whole page. Notion
 * marks each block it could not load `<unknown url alt/>` and lists their ids:
 * past about 20,000 blocks it stops, and short of that it leaves out a child
 * page the connection was not shared and the kinds it does not write out
 * (bookmarks, embeds, link previews). Notion offers asking again for each id,
 * and says an unshared one answers 404; a request per block on every read
 * would buy little past the rare 20,000, so deevy says so instead: an Agent
 * reading the record knows the text is not all of it, and where the rest is.
 */
function gapNote(truncated: boolean, unknown: number, url: string | undefined): string | null {
  if (!truncated && unknown === 0) return null;
  const blocks = `${String(unknown)} block${unknown === 1 ? "" : "s"}`;
  const where = url ? ` is at ${url}` : " is in Notion";
  const missing =
    unknown === 0
      ? "its end is missing here"
      : `${blocks} ${unknown === 1 ? "is" : "are"} missing here, marked \`<unknown>\` above`;
  return truncated
    ? `> Notion stopped reading this page at about 20,000 blocks, so ${missing}. The whole page${where}.`
    : `> Notion left ${blocks} of this page out, marked \`<unknown>\` above: ${unknown === 1 ? "one" : "each"} not shared with deevy, or of a kind Notion does not write as markdown. The page${where}.`;
}

class NotionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
