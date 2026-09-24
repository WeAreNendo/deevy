import type { Socket } from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { appendEvent, type EventSource } from "../events.ts";
import { recordRuling } from "../gates.ts";
import { memberForExternalIdentity } from "../identities.ts";
import type { IdentityScope, InboundEvent } from "./port.ts";

/**
 * A Ruling made in a tracker (ADR-0025).
 *
 * The third door to `recordRuling`, beside the ruling screen and Slack, and the
 * same function behind all three: who may rule, whether the one who asked may
 * count, how many it takes. What this door adds is only what the other two get
 * from a session — who the Human is — and it gets that from the tool's own
 * account id, never from a name (identities.ts).
 *
 * The provider has already proved the delivery was signed and is not a replay,
 * and read the command off the first line of the comment (`parseRulingCommand`).
 * What is decided here:
 *
 * - **A machine rules nothing, and is not answered.** deevy's own mirrored
 *   comment quotes `/approve` in its instructions, and a reply to a bot is a
 *   conversation between two bots. The Socket's own identity is refused by name
 *   as well as by flag, because a provider that forgot to mark it is the loop.
 * - **The Gate is the newest open one on that record.** A record may have had
 *   several; only one is open per Run and Checkpoint, and the Human is replying
 *   to the one they can see.
 * - **Everything else that does not rule is said back**, as `gate.ruling_refused`,
 *   which the mirror turns into a reply in the same words the ruling screen
 *   would have used. The Human who wrote the comment is reading the tracker,
 *   and silence there would read as having worked.
 *
 * A Ruling that does count is said back too, by the mirror, from the Gate's own
 * Events: the arithmetic ("1 of 2, still waiting") is the card this Human
 * never sees.
 */

export type RulingEvent = Extract<InboundEvent, { kind: "ruling" }>;

export interface ApplyRuling {
  source: EventSource;
  socket: Socket;
  scope: IdentityScope;
  event: RulingEvent;
}

/** Why a Ruling from outside ruled nothing, in the words the reply is built from. */
export type RefusalReason = "unknown_identity" | "nothing_waiting" | "refused";

/** Applies one, answering null when it changed something and why when it did not. */
export async function applyRuling({
  source,
  socket,
  scope,
  event,
}: ApplyRuling): Promise<string | null> {
  const { db } = source;
  const author = event.comment.author;
  if (author.isBot || author.id === socket.identity.id || author.login === socket.identity.login) {
    return "A machine rules nothing";
  }

  const issue = await db.query.issue.findFirst({
    where: { socketId: socket.id, externalId: event.issueExternalId },
    columns: { id: true, projectId: true },
  });
  if (!issue) return `No record ${event.issueExternalId} has been projected here`;

  const gate = await db.query.gateRequest.findFirst({
    where: { issueId: issue.id, status: "open" },
    orderBy: { askedAt: "desc" },
    columns: { id: true, checkpoint: true },
  });

  const refuse = async (reason: RefusalReason, message: string | null = null) => {
    await appendEvent(source, {
      kind: "gate.ruling_refused",
      subjectType: gate ? "gate" : "issue",
      subjectId: gate ? gate.id : issue.id,
      projectId: issue.projectId,
      payload: {
        issueId: issue.id,
        socketId: socket.id,
        ...(gate ? { checkpoint: gate.checkpoint } : {}),
        reason,
        ...(message ? { message } : {}),
        externalActor: author.login,
        externalCommentId: event.comment.externalId,
        url: event.comment.url,
      },
    });
    return `That ruled nothing: ${reason}`;
  };

  if (!gate) return refuse("nothing_waiting");

  const resolved = await memberForExternalIdentity({ source, socket, scope, actor: author });
  if (!resolved) return refuse("unknown_identity");

  try {
    await recordRuling(
      // The Human is the actor of what follows, exactly as if they had clicked:
      // the Gate's Events are theirs, not the delivery's.
      { ...source, member: resolved.member },
      {
        requestId: gate.id,
        memberId: resolved.member.id,
        decision: event.decision,
        note: event.note,
        via: "socket",
        socketId: socket.id,
        externalRef: {
          externalId: event.comment.externalId,
          url: event.comment.url,
          login: author.login,
          verifiedBy: resolved.identity.verifiedBy,
        },
      },
    );
  } catch (error) {
    // The policy's own refusal, in its own words: not an approver, the Human
    // the Run is for, already ruled, suspended. The same sentence the ruling
    // screen shows (checkpoints.ts), because it is the same decision.
    if (error instanceof ORPCError) return refuse("refused", error.message);
    throw error;
  }
  return null;
}
