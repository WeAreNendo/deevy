import { event, type Db, type Event, type Member, type Workspace } from "@deevy/db";
import type { JobQueue } from "./jobs.ts";
import { deriveNotifications } from "./notifications.ts";
import { triggersFor } from "./triggers.ts";
import { deriveWebhookDeliveries } from "./webhooks.ts";

/**
 * The Event log is the audit trail (docs/PLAN.md): every write appends one
 * immutable Event in the same handler, and Notifications, the live stream, and
 * the Issue timeline read it back rather than keeping a second source.
 */

/**
 * Dotted `<subject>.<verb>`. The union grows one slice at a time; the payload
 * shape each kind carries is documented by the operation that appends it.
 */
export type EventKind =
  | "workspace.created"
  | "member.joined"
  | "member.role_changed"
  | "member.suspended"
  | "member.reinstated"
  | "allowlist.rule_added"
  | "allowlist.rule_removed"
  /**
   * A person admitted one at a time, where a rule admits a category
   * (docs/plans/sign-in.md). The payload carries the address and the role and
   * never the token; accepting appends `member.joined` beside it, so the
   * Workspace's history reads the same whether somebody joined by rule or by
   * invitation.
   */
  | "invitation.created"
  | "invitation.revoked"
  | "invitation.accepted"
  | "project.created"
  | "project.updated"
  | "project.archived"
  | "team.created"
  | "team.updated"
  | "team.deleted"
  | "team.member_added"
  | "team.member_removed"
  | "issue.created"
  | "issue.updated"
  | "issue.assigned"
  | "issue.reparented"
  | "issue.moved"
  /**
   * One Human's approval of a Gate that wants more than one, and the Issue
   * still in it. `gate.approved` stays the Event that means the Issue left, so
   * everything that reads the log keeps meaning what it meant
   * (docs/plans/four-eyes-gates.md).
   */
  | "gate.approval"
  | "gate.approved"
  /**
   * A Document changed while its Issue sat at a Gate that had approvals toward
   * a threshold, so those approvals were cleared (ADR-0021). A Gate wanting two
   * Humans exists to stop one text being approved by two people who read two
   * different texts; nothing is deleted, and the count starts again.
   */
  | "gate.approvals_cleared"
  | "gate.rejected"
  | "workflow.updated"
  | "document.created"
  | "document.updated"
  | "label.created"
  | "label.updated"
  | "label.deleted"
  | "issue.labels_changed"
  | "comment.created"
  | "comment.edited"
  | "comment.deleted"
  | "issue.link_added"
  | "issue.link_removed"
  | "workspace.updated"
  | "agent.created"
  | "agent.updated"
  | "agent.key_issued"
  | "agent.key_revoked"
  | "agent.sponsor_changed"
  | "agent.project_granted"
  | "agent.project_revoked"
  /** A Run and what the Agent does inside it (docs/plans/m2.md). */
  | "run.started"
  | "run.activity"
  | "run.awaiting_input"
  | "run.answered"
  | "run.completed"
  | "run.failed"
  /** Silence, not a decision: the sweep said so, and an Activity undoes it. */
  | "run.went_stale"
  /**
   * A URL that asked to be told, and the one thing that can go wrong with it:
   * `webhook.exhausted` is deevy admitting it could not deliver (ADR-0003).
   */
  | "webhook.subscribed"
  | "webhook.removed"
  | "webhook.exhausted"
  /** Where Notifications go: the Channels themselves, and the rules that aim them. */
  | "channel.created"
  | "channel.updated"
  | "channel.deleted"
  | "routing.updated";

export type EventPayload = Record<string, unknown>;

export interface EventInput {
  kind: EventKind;
  subjectType: string;
  subjectId: string;
  /** Set when the Event belongs to a Project, so a Project stream is one index scan. */
  projectId?: string | null;
  payload?: EventPayload;
}

/**
 * Who is appending. An operation's member context satisfies this as it stands;
 * writes deevy makes on its own pass `member: null` and the Workspace directly.
 */
export interface EventSource {
  db: Db;
  workspace: Pick<Workspace, "id">;
  member?: Pick<Member, "id"> | null;
  /**
   * Where a delivery this Event owes is nudged, on a deployment that has
   * somewhere to nudge (jobs.ts). Absent is the honest default: the row is
   * written either way and the next sweep finds it a beat later.
   */
  jobs?: JobQueue;
}

/** Appends one Event and returns the stored row, including its `seq` cursor. */
export async function appendEvent(source: EventSource, input: EventInput): Promise<Event> {
  const [row] = await source.db
    .insert(event)
    .values({
      workspaceId: source.workspace.id,
      actorMemberId: source.member?.id ?? null,
      kind: input.kind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      projectId: input.projectId ?? null,
      payload: input.payload ?? null,
    })
    .returning();
  if (!row) throw new Error("appendEvent: the insert returned no row");
  // Notifications derive from the Event, in the same request and right after
  // it, so nothing else has to remember to tell anyone (docs/plans/m1.md).
  await deriveNotifications(source.db, row);
  // And so do the deliveries owed to a subscribed URL, in the same tail and
  // for the same reason: the durable row is what makes a trigger reliable
  // whether or not anything is running to send it (ADR-0003).
  const owed = await deriveWebhookDeliveries(source.db, row);

  // Then, and only then, the nudge: a job names a row that is already durable,
  // so a deployment with a queue sends it now instead of at the next sweep and
  // a deployment without one loses nothing (jobs.ts). The port says `enqueue`
  // may not throw or reject; this does not depend on the port being kept,
  // because a queue that is down must not turn a write that succeeded into a
  // request that failed (docs/plans/m3.md slice 9).
  for (const id of owed) {
    try {
      await source.jobs?.enqueue({ kind: "webhook.delivery", id });
    } catch {
      // The row is the record. The next sweep finds exactly this.
    }
  }
  // Triggers derive from the same Event, right after it (docs/plans/m2.md).
  // They write their own rows and hand back the Events those deserve, so this
  // stays the only writer of the log. The recursion that follows is bounded:
  // a `run.*` Event triggers nothing, and an Event a trigger already acted on
  // finds the Run it created open and fires nothing a second time.
  for (const followed of await triggersFor(source.db, row)) {
    await appendEvent(source, followed);
  }
  return row;
}
