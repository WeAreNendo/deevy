import {
  notification as notificationTable,
  type Db,
  type Event,
  type Notification,
} from "@deevy/db";
import { newId } from "./ids.ts";

/**
 * An Agent's inbox, derived from the Event log rather than written a second
 * time (docs/PLAN.md): this runs in the same request, right after the Event is
 * appended, and reads only that Event. Nothing here decides what happened.
 *
 * Only an Agent is told anything (docs/plans/simplify.md, slice 8). What an
 * Agent waits for is here: the record routing gave it, a comment that names
 * it, and the Ruling on the Gate it stopped at. A Human's attention is the
 * Gates they may rule on, which Needs me derives from the Gates themselves and
 * a Project's chat channel is posted (sockets/chat-out.ts), and the tracker
 * tells them the rest; so there is no Human row, no preference, no routing
 * rule and no email.
 *
 * One inbox row per recipient per kind per Event, the unique index's invariant
 * rather than this function's care (docs/plans/m3.md). The actor is never told
 * about their own action, and a suspended Agent is told nothing at all.
 */
export async function deriveNotifications(db: Db, event: Event): Promise<void> {
  const inbox = await recipientsFor(db, event);
  if (inbox.length === 0) return;
  // Running this a second time for the same Event owes nobody a second row.
  await db
    .insert(notificationTable)
    .values(
      inbox.map(({ memberId, kind }) => ({
        id: newId("notification"),
        recipientMemberId: memberId,
        kind,
        eventId: event.seq,
        issueId: issueOf(event),
      })),
    )
    .onConflictDoNothing();
}

export type Recipient = { memberId: string; kind: Notification["kind"] };

/**
 * The Issue a Notification points at. A Run is not an Issue, but it happens on
 * one, and its Events carry that Issue so the inbox needs no second query.
 */
export function issueOf(event: Event): string | null {
  if (event.subjectType === "issue") return event.subjectId;
  // A Run and a Gate both happen on an Issue without being one, and both carry
  // it, so the inbox needs no second query for either (ADR-0024).
  const carried = (event.payload as { issueId?: unknown } | null)?.issueId;
  return typeof carried === "string" ? carried : null;
}

/**
 * The Gate a waiting Run stopped at, which a `run.awaiting_input` names in its
 * payload.
 *
 * A Gate is the one thing a Run waits at (docs/plans/simplify.md, slice 5), so
 * this names one on every such Event since; one from before, when an Agent
 * could leave its Run waiting on a question, names none. Read from the row
 * rather than looked up, because the chat sweep asks later and must stay a
 * pure function of the Event.
 */
export function gateRequestIdOf(event: Event): string | null {
  if (event.kind !== "run.awaiting_input") return null;
  const carried = (event.payload as { gateRequestId?: unknown } | null)?.gateRequestId;
  return typeof carried === "string" ? carried : null;
}

async function recipientsFor(db: Db, event: Event): Promise<Recipient[]> {
  const payload = (event.payload ?? {}) as {
    to?: unknown;
    mentionedMemberIds?: unknown;
  };

  // What routing gave an Agent, which is what opened its Run.
  if (event.kind === "issue.assigned") {
    const assignee = typeof payload.to === "string" ? payload.to : null;
    if (!assignee || assignee === event.actorMemberId) return [];
    return (await activeAgents(db, [assignee], event)).map((memberId) => ({
      memberId,
      kind: "assignment" as const,
    }));
  }

  // A comment that names an Agent, which is how an answer in the tracker
  // reaches it (slice 5).
  if (event.kind === "comment.created") {
    const mentioned = Array.isArray(payload.mentionedMemberIds)
      ? payload.mentionedMemberIds.filter((id): id is string => typeof id === "string")
      : [];
    const others = mentioned.filter((id) => id !== event.actorMemberId);
    return (await activeAgents(db, others, event)).map((memberId) => ({
      memberId,
      kind: "mention" as const,
    }));
  }

  // A Ruling is owed to whoever asked for it, and that is the Agent. The
  // Human who ruled is the actor and is never told about their own action.
  if (event.kind === "run.answered" && event.subjectType === "run") {
    const found = await db.query.run.findFirst({
      where: { id: event.subjectId },
      columns: { agentMemberId: true },
    });
    if (!found || found.agentMemberId === event.actorMemberId) return [];
    return (await activeAgents(db, [found.agentMemberId], event)).map((memberId) => ({
      memberId,
      kind: "run_answered" as const,
    }));
  }

  return [];
}

/** Of the given Members, the Agents still able to act. Suspension silences an inbox. */
async function activeAgents(db: Db, memberIds: string[], event: Event): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const rows = await db.query.member.findMany({
    where: {
      id: { in: memberIds },
      workspaceId: event.workspaceId,
      kind: "agent",
      suspendedAt: { isNull: true },
    },
    columns: { id: true },
  });
  return rows.map((row) => row.id);
}
