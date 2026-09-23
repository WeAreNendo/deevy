import type {
  ChatActor,
  ChatInteraction,
  ChatMessage,
  ChatMessageRef,
  ChatReply,
  InboundCheck,
  InboundInput,
  SocketIdentity,
  SocketModule,
  SocketModuleInput,
} from "@deevy/core/sockets";
import { noteView, render } from "./blocks.ts";

/**
 * A Slack app as a Socket (ADR-0024, ADR-0025, `docs/slack-manifest.yaml`).
 *
 * A chat tool rather than a tracker: it carries no records, and what it is for
 * is the two buttons on a Gate — so a Human can rule where they already are,
 * as the Human deevy linked their Slack account to. Everything it sends goes
 * through the Web API with the bot token; the one thing that does not is an
 * answer to a single click, which Slack's `response_url` carries on its own.
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

/** How far a signed timestamp may be from now before the request is a replay. */
const WINDOW_SECONDS = 5 * 60;

/** The buttons deevy draws. Anything else on a message is somebody else's. */
const ACTIONS = { deevy_approve: "approved", deevy_reject: "rejected" } as const;

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compared in time that does not depend on where they first differ. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let differ = 0;
  for (let index = 0; index < a.length; index += 1)
    differ |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return differ === 0;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The JSON a Slack form carries under `payload`, or null when it is a slash command. */
function payloadOf(rawBody: string): Record<string, unknown> | null {
  const raw = new URLSearchParams(rawBody).get("payload");
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function actorOf(payload: Record<string, unknown>): ChatActor {
  const user = (payload.user ?? {}) as Record<string, unknown>;
  const team = (payload.team ?? {}) as Record<string, unknown>;
  return {
    team: text(team.id) || text(user.team_id),
    user: text(user.id),
    login: text(user.username) || text(user.name),
  };
}

/** What one request means. Pure: the body in, deevy's own terms out. */
export function normalizeSlack(eventName: string, rawBody: string): ChatInteraction {
  if (eventName === "slash_command") {
    const form = new URLSearchParams(rawBody);
    const said = form.get("text")?.trim().toLowerCase() ?? "";
    if (said !== "link") {
      return { kind: "ignored", why: `/deevy ${said || "(nothing)"} is not something deevy does` };
    }
    return {
      kind: "link",
      actor: {
        team: form.get("team_id") ?? "",
        user: form.get("user_id") ?? "",
        login: form.get("user_name") ?? "",
      },
      responseUrl: form.get("response_url"),
    };
  }

  const payload = payloadOf(rawBody);
  if (!payload) return { kind: "ignored", why: "a request with no payload in it" };

  if (eventName === "block_actions") {
    const [action] = Array.isArray(payload.actions)
      ? (payload.actions as Record<string, unknown>[])
      : [];
    const decision = ACTIONS[text(action?.action_id) as keyof typeof ACTIONS];
    if (!action || !decision) return { kind: "ignored", why: "a button deevy did not draw" };
    const container = (payload.container ?? {}) as Record<string, unknown>;
    const channel = text(container.channel_id);
    const ts = text(container.message_ts);
    return {
      kind: "ruling",
      actor: actorOf(payload),
      gateRequestId: text(action.value),
      decision,
      note: null,
      // Rejecting asks why first: a rejection nobody can read the reason for
      // is a Gate the Agent cannot answer (ADR-0020).
      wantsNote: decision === "rejected",
      message: channel && ts ? { channel, ts } : null,
      responseUrl: text(payload.response_url) || null,
      triggerId: text(payload.trigger_id) || null,
    };
  }

  if (eventName === "view_submission") {
    const view = (payload.view ?? {}) as Record<string, unknown>;
    if (text(view.callback_id) !== "deevy_reject") {
      return { kind: "ignored", why: "a dialog deevy did not open" };
    }
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(text(view.private_metadata) || "{}") as Record<string, unknown>;
    } catch {
      return { kind: "ignored", why: "a dialog whose Gate cannot be read" };
    }
    const values = ((view.state as Record<string, unknown> | undefined)?.values ?? {}) as Record<
      string,
      Record<string, { value?: unknown }>
    >;
    const note = text(values.note?.note?.value).trim();
    const channel = text(meta.channel);
    const ts = text(meta.ts);
    return {
      kind: "ruling",
      actor: actorOf(payload),
      gateRequestId: text(meta.gateRequestId),
      decision: "rejected",
      note: note || null,
      wantsNote: false,
      message: channel && ts ? { channel, ts } : null,
      responseUrl: null,
      triggerId: null,
    };
  }

  return { kind: "ignored", why: `a ${eventName} deevy does not act on` };
}

export function createSlackSocket({
  config,
  credentials,
  fetch,
  now,
}: SocketModuleInput): SocketModule {
  const settings = config as SlackConfig;
  const secrets = credentials as SlackCredentials;
  const api = (settings.apiBase ?? DEFAULT_API).replace(/\/+$/, "");

  /** One Web API method, answering its body or throwing Slack's own word for why not. */
  async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    if (!secrets.botToken) throw new Error("This Slack Socket has no bot token; connect it again.");
    const response = await fetch(`${api}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secrets.botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const answer = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || answer.ok !== true) {
      throw new Error(
        `Slack refused ${method}: ${answer.error ?? `HTTP ${String(response.status)}`}`,
      );
    }
    return answer as T;
  }

  return {
    provider: "slack",
    capabilities: new Set(["chat"] as const),
    // A team's accounts, which nobody signs in to deevy with: a Slack user is
    // linked by a code Slack delivered to them alone (ADR-0025).
    identityScope: { instance: settings.teamId ?? "slack" },

    async identity(): Promise<SocketIdentity> {
      const who = await call<{
        user: string;
        user_id: string;
        team: string;
        team_id: string;
        url: string;
      }>("auth.test", {});
      return {
        login: who.user,
        id: who.user_id,
        mentionHandle: `@${who.user}`,
        learned: { teamId: who.team_id, team: who.team, url: who.url },
      };
    },

    chat: {
      async verifyInteraction({
        headers,
        rawBody,
        webhookSecret,
        now: at,
      }: InboundInput): Promise<InboundCheck> {
        const timestamp = headers.get("x-slack-request-timestamp") ?? "";
        const signature = headers.get("x-slack-signature") ?? "";
        const clock = Math.floor((at ?? now()).getTime() / 1000);
        const eventName = payloadOf(rawBody)
          ? text(payloadOf(rawBody)?.type)
          : new URLSearchParams(rawBody).has("command")
            ? "slash_command"
            : "";
        const fresh =
          /^\d+$/.test(timestamp) && Math.abs(clock - Number(timestamp)) <= WINDOW_SECONDS;
        if (!fresh || !signature.startsWith("v0="))
          return { ok: false, deliveryId: null, eventName };
        const expected = `v0=${await hmacHex(webhookSecret, `v0:${timestamp}:${rawBody}`)}`;
        return { ok: sameText(signature, expected), deliveryId: null, eventName };
      },

      normalizeInteraction: normalizeSlack,

      answer(reply: ChatReply): Response {
        if (reply.kind === "private") {
          return Response.json({ response_type: "ephemeral", text: reply.text });
        }
        if (reply.kind === "dialog_error") {
          return Response.json({ response_action: "errors", errors: { note: reply.text } });
        }
        // Slack wants a 200 and nothing else within three seconds, whatever
        // deevy then does about the click.
        return new Response(null, { status: 200 });
      },

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

      async openDm(user: string): Promise<string> {
        const opened = await call<{ channel: { id: string } }>("conversations.open", {
          users: user,
        });
        return opened.channel.id;
      },

      async askForNote(triggerId, input): Promise<void> {
        await call("views.open", { trigger_id: triggerId, view: noteView(input) });
      },

      async respond(responseUrl: string, said: string): Promise<void> {
        // The URL is its own credential and good for one person for a while:
        // no token goes with it, and nobody else sees what it carries.
        const response = await fetch(responseUrl, {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text: said }),
        });
        if (!response.ok)
          throw new Error(`Slack refused the reply: HTTP ${String(response.status)}`);
      },
    },
  };
}
