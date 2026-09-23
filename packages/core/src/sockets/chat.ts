import type { Socket } from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { appendEvent, type EventSource } from "../events.ts";
import { recordRuling } from "../gates.ts";
import { memberForExternalIdentity, mintLinkCode } from "../identities.ts";
import type {
  ChatInteraction,
  ChatReply,
  ChatSocket,
  ExternalActor,
  IdentityScope,
} from "./port.ts";

/**
 * A click, a dialog or a command from a chat tool (ADR-0025).
 *
 * The second door to `recordRuling` from outside deevy, beside the tracker's
 * comment: the same policy, the same refusals, recorded `via: "slack"`. What a
 * chat tool adds is an audience of one — Slack answers the person who clicked
 * and nobody else — so every refusal and every link code is said to them
 * alone, and nothing that must stay private is written anywhere a log reader
 * could find it.
 *
 * Slack wants its answer within three seconds, on a Worker that may be cold.
 * So what happens here is the least that has to: the Ruling is written, and
 * the message it changes is updated later, through the outbox, from the Gate's
 * own Events (sockets/chat-out.ts). The two things that cannot wait are said
 * inline — a dialog, which Slack's `trigger_id` allows three seconds for, and a
 * link code, which must never sit in a queue.
 */

export interface ApplyChat {
  source: EventSource;
  socket: Socket;
  chat: ChatSocket;
  scope: IdentityScope;
  eventName: string;
  interaction: ChatInteraction;
  /** Where a Human opens deevy, for the one link a reply carries. */
  origin: string;
  now: Date;
}

export interface ChatOutcome {
  reply: ChatReply;
  /** What the delivery row records: applied when something changed. */
  status: "applied" | "skipped";
  why: string | null;
}

const skipped = (reply: ChatReply, why: string): ChatOutcome => ({ reply, status: "skipped", why });

export async function applyChat({
  source,
  socket,
  chat,
  scope,
  eventName,
  interaction,
  origin,
  now,
}: ApplyChat): Promise<ChatOutcome> {
  if (interaction.kind === "ignored") {
    // A command somebody typed deserves an answer; a stray click does not.
    return skipped(
      eventName === "slash_command"
        ? { kind: "private", text: "Type `/deevy link` to link your Slack account to deevy." }
        : { kind: "none" },
      interaction.why,
    );
  }

  const actor: ExternalActor = {
    login: interaction.actor.login,
    id: interaction.actor.user,
    isBot: false,
  };
  const identities = `${origin}/settings/identities`;

  if (interaction.kind === "link") {
    const known = await memberForExternalIdentity({ source, socket, scope, actor });
    if (known) {
      return skipped(
        {
          kind: "private",
          text: `This Slack account already approves and rejects for you in deevy. You can unlink it at ${identities}.`,
        },
        "already linked",
      );
    }
    const code = await mintLinkCode(source, socket, scope, actor, now);
    return {
      reply: { kind: "private", text: codeText(code, identities) },
      status: "applied",
      why: null,
    };
  }

  const gate = await source.db.query.gateRequest.findFirst({
    where: { id: interaction.gateRequestId },
    with: { project: { columns: { workspaceId: true } } },
  });
  // A Gate in another Workspace is not one this Socket can see, whatever a
  // forged value on a button says.
  if (!gate || gate.project.workspaceId !== socket.workspaceId) {
    return tell(chat, interaction, "That Gate is not one deevy knows here.", "no such Gate");
  }

  const refuse = async (reason: "unknown_identity" | "refused", message: string | null) => {
    await appendEvent(source, {
      kind: "gate.ruling_refused",
      subjectType: "gate",
      subjectId: gate.id,
      projectId: gate.projectId,
      payload: {
        issueId: gate.issueId,
        socketId: socket.id,
        checkpoint: gate.checkpoint,
        // Said in the chat tool already: the tracker is not told (mirror.ts).
        via: "slack",
        reason,
        ...(message ? { message } : {}),
        externalActor: actor.login,
      },
    });
  };

  const resolved = await memberForExternalIdentity({ source, socket, scope, actor });
  if (!resolved) {
    await refuse("unknown_identity", null);
    const code = await mintLinkCode(source, socket, scope, actor, now);
    return tell(
      chat,
      interaction,
      `deevy doesn't know whose Slack account this is yet, so that ruled nothing. ${codeText(code, identities)} Then click again.`,
      "unknown identity",
    );
  }

  if (interaction.wantsNote) {
    if (!interaction.triggerId) {
      return tell(chat, interaction, "Say why in deevy instead.", "no way to ask why");
    }
    await chat.askForNote(interaction.triggerId, {
      gateRequestId: gate.id,
      checkpoint: gate.checkpoint,
      message: interaction.message,
    });
    return skipped({ kind: "none" }, "asked why");
  }

  try {
    await recordRuling(
      // The Human is the actor of what follows, exactly as if they had clicked
      // in deevy: the Gate's Events are theirs.
      { ...source, member: resolved.member },
      {
        requestId: gate.id,
        memberId: resolved.member.id,
        decision: interaction.decision,
        note: interaction.note,
        via: "slack",
        socketId: socket.id,
        externalRef: {
          team: interaction.actor.team,
          user: interaction.actor.user,
          login: interaction.actor.login,
          ...(interaction.message
            ? { channel: interaction.message.channel, ts: interaction.message.ts }
            : {}),
          verifiedBy: resolved.identity.verifiedBy,
        },
      },
    );
  } catch (error) {
    // The Checkpoint's own words, to the one who clicked: the same sentence
    // the ruling screen would have shown them (checkpoints.ts).
    if (!(error instanceof ORPCError)) throw error;
    await refuse("refused", error.message);
    return tell(chat, interaction, `That ruled nothing. ${error.message}.`, error.message);
  }
  return { reply: { kind: "none" }, status: "applied", why: null };
}

/** What a code is said with, wherever it is said. */
function codeText(code: string, identities: string): string {
  return `Your code is *${code}*. Enter it at ${identities} within ten minutes to link this Slack account to you.`;
}

/**
 * Says something to the one person who clicked. A dialog answers in itself,
 * keeping it open; a button answers through the URL Slack gave for it; and a
 * failure to answer is not a failure of the click, which already happened.
 */
async function tell(
  chat: ChatSocket,
  interaction: ChatInteraction,
  text: string,
  why: string,
): Promise<ChatOutcome> {
  if (interaction.kind !== "ruling" || interaction.responseUrl === null) {
    return skipped({ kind: "dialog_error", text }, why);
  }
  await chat.respond(interaction.responseUrl, text).catch(() => undefined);
  return skipped({ kind: "none" }, why);
}
