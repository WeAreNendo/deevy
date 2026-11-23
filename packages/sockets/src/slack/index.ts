import type {
  ChatChannel,
  ChatMessage,
  ChatMessageRef,
  SocketIdentity,
  SocketModule,
  SocketModuleInput,
} from "@deevy/core/sockets";
import { render } from "./blocks.ts";

/**
 * A Slack app as a Socket (ADR-0024, ADR-0036, `docs/slack-manifest.yaml`).
 *
 * A chat tool rather than a tracker: it carries no records, and what it is for
 * is telling a Project's channel that a Gate is waiting, with a link to rule on
 * it in deevy, and how it was ruled on. deevy only posts there — everything
 * goes through the Web API with the bot token — and Slack sends deevy nothing,
 * so there is no request to verify and no signing secret.
 *
 * Web-standard, like every provider: `fetch` and `crypto.subtle`, so the
 * Workers build compiles it (ADR-0006).
 */

export interface SlackConfig {
  /** The team the app is installed in, learned when the token is proved. */
  teamId?: string;
  /** The Web API's root, for a test or a proxy. */
  apiBase?: string;
}

export interface SlackCredentials {
  /** The bot user's OAuth token, `xoxb-…`. */
  botToken?: string;
}

const DEFAULT_API = "https://slack.com/api";

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Slack answers a refusal with a code and no sentence. These are the ones an
 * operator can do something about, in words; any other is said as the code.
 */
const REFUSALS: Record<string, string | ((said: Record<string, unknown>) => string)> = {
  invalid_auth: "Slack does not know this token",
  not_authed: "No token was sent",
  account_inactive: "This token was revoked, or the app was removed from the workspace",
  token_revoked: "This token was revoked, or the app was removed from the workspace",
  token_expired: "This token has expired",
  not_allowed_token_type:
    "Slack does not take this kind of token here; paste the Bot User OAuth Token, which starts xoxb-",
  missing_scope: (said) =>
    `The app is missing the ${text(said.needed) || "needed"} scope: add it under OAuth & Permissions and reinstall it`,
  not_in_channel: "deevy is not in that channel: /invite @deevy there",
  channel_not_found: "deevy cannot see a channel with that ID",
  is_archived: "That channel is archived",
  message_not_found: "The message to change is gone",
  ratelimited: "Slack asked deevy to slow down",
};

/** A Slack refusal, as the words above and then the code and the method. */
function refusal(method: string, said: Record<string, unknown>, status: number): string {
  const code = text(said.error);
  if (!code) return `Slack answered HTTP ${String(status)} (${method})`;
  const words = REFUSALS[code];
  if (!words) return `Slack answered ${code} (${method})`;
  return `${typeof words === "function" ? words(said) : words} (${code}, ${method})`;
}

export function createSlackSocket({ config, credentials, fetch }: SocketModuleInput): SocketModule {
  const settings = config as SlackConfig;
  const secrets = credentials as SlackCredentials;
  const api = (settings.apiBase ?? DEFAULT_API).replace(/\/+$/, "");

  /**
   * One Web API method, answering its body or throwing Slack's own word for
   * why not. A method that writes takes JSON; one that reads takes only a form
   * and reads a JSON body as nothing at all, so it is sent as one.
   */
  async function call<T>(
    method: string,
    body: Record<string, unknown>,
    as: "json" | "form" = "json",
  ): Promise<T> {
    if (!secrets.botToken) throw new Error("This Slack Socket has no bot token; connect it again.");
    const response = await fetch(`${api}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secrets.botToken}`,
        "content-type":
          as === "form" ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8",
      },
      body:
        as === "form"
          ? new URLSearchParams(
              Object.entries(body).map(([key, value]) => [key, String(value)]),
            ).toString()
          : JSON.stringify(body),
    });
    const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || answer.ok !== true) {
      throw new Error(refusal(method, answer, response.status));
    }
    return answer as T;
  }

  return {
    provider: "slack",
    capabilities: new Set(["chat"] as const),
    // Slack sends deevy nothing, so nothing is signed (ADR-0036).
    webhookSecretFrom: "none",

    /**
     * The app's bot, proved by its token. A user's token proves too, as that
     * user — no `bot_id` in the answer — and is refused: deevy would post
     * every Gate as them.
     */
    async identity(): Promise<SocketIdentity> {
      const who = await call<{
        user: string;
        user_id: string;
        team: string;
        team_id: string;
        url: string;
        bot_id?: string;
      }>("auth.test", {});
      if (!who.bot_id) {
        throw new Error(
          `This is ${who.user ? `${who.user}'s` : "a"} user token: deevy would post as them. Paste the app's Bot User OAuth Token, which starts xoxb-, instead.`,
        );
      }
      return {
        login: who.user,
        id: who.user_id,
        mentionHandle: `@${who.user}`,
        learned: { teamId: who.team_id, team: who.team, url: who.url },
      };
    },

    chat: {
      async post(channel: string, message: ChatMessage): Promise<ChatMessageRef> {
        const posted = await call<{ channel: string; ts: string }>("chat.postMessage", {
          channel,
          ...render(message),
          unfurl_links: false,
        });
        return { channel: posted.channel, ts: posted.ts };
      },

      async update(ref: ChatMessageRef, message: ChatMessage): Promise<void> {
        await call("chat.update", { channel: ref.channel, ts: ref.ts, ...render(message) });
      },

      /**
       * The channels the app is in, public and private: the ones it can post
       * in without an `/invite` first. Ten pages of two hundred is more than a
       * picker can show, so a team with more types the id.
       */
      async listChannels(): Promise<ChatChannel[]> {
        const found: ChatChannel[] = [];
        let cursor = "";
        for (let page = 0; page < 10; page += 1) {
          const listed = await call<{
            channels?: Array<{ id?: unknown; name?: unknown }>;
            response_metadata?: { next_cursor?: unknown };
          }>(
            "users.conversations",
            {
              types: "public_channel,private_channel",
              exclude_archived: true,
              limit: 200,
              ...(cursor ? { cursor } : {}),
            },
            "form",
          );
          for (const channel of listed.channels ?? []) {
            if (text(channel.id)) found.push({ id: text(channel.id), name: text(channel.name) });
          }
          cursor = text(listed.response_metadata?.next_cursor);
          if (!cursor) break;
        }
        return found;
      },
    },
  };
}
