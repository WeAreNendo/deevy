import { event, type Db, type Event, type Member, type Workspace } from "@deevy/db";
import type { JobQueue } from "./jobs.ts";
import { deriveNotifications } from "./notifications.ts";
import { triggersFor } from "./triggers.ts";
import { deriveSocketMirrors } from "./sockets/mirror.ts";
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
  /**
   * A record arrived from a tracker Socket (ADR-0024). `issue.created` is the
   * first sight of one; `issue.synced` is every sight after that, carrying what
   * changed so a reader is not left diffing two snapshots.
   */
  | "issue.created"
  | "issue.synced"
  | "issue.assigned"
  /**
   * The record closed, or opened again. What "closed" means is the tracker's to
   * say, and `wakeParent` reads it rather than a State's category.
   */
  | "issue.closed"
  | "issue.reopened"
  /**
   * An Agent asked for one more sub-issue than this Workspace allows, and did
   * not get it (docs/plans/sub-issue-delegation.md). The one Event here that
   * records something *not* happening, and it earns its place: an Agent that
   * hits a ceiling notes it and does something else, so without this the
   * Sponsor never learns that the shape of the work was decided by a number.
   */
  | "delegation.refused"
  /**
   * Every sub-issue of this Issue is finished. A delegating Run does not wait —
   * it finishes, and this is what wakes the Agent that opened them
   * (docs/plans/sub-issue-delegation.md). Appended even where there is no Agent
   * left to wake, so a parent whose children are done is visibly a Human's
   * rather than silently nobody's.
   */
  | "issue.children_closed"
  | "comment.created"
  | "issue.link_added"
  | "issue.link_removed"
  | "workspace.updated"
  /** A tool deevy is connected to, and the Projects bound to it (ADR-0024). */
  | "socket.connected"
  | "socket.updated"
  | "socket.removed"
  /**
   * A tool told deevy where else it was installed. One App serves every
   * repository somebody installs it on, so the installations are a list that
   * grows after the connecting, and a delivery is how deevy hears about it.
   */
  | "socket.installation_added"
  /**
   * deevy could not say back in the tracker what happened here, and has
   * stopped trying (ADR-0003's shape, ADR-0024's reason). The Workspace's
   * record and the tracker's have drifted, and this is the line that says so.
   */
  | "socket.mirror_exhausted"
  | "agent.created"
  | "agent.updated"
  | "agent.key_issued"
  | "agent.key_revoked"
  | "agent.sponsor_changed"
  | "agent.project_granted"
  | "agent.project_revoked"
  /**
   * A Run's request to pass a Checkpoint, and what Humans ruled on it
   * (ADR-0024). `gate.approval` is one approval short of the threshold, which
   * is the Event four-eyes is visible in: it says how many of how many.
   * `gate.superseded` is the Agent changing its mind about what it is asking.
   */
  | "gate.requested"
  | "gate.superseded"
  | "gate.approval"
  | "gate.approved"
  | "gate.rejected"
  /**
   * A Ruling made in a tracker that ruled nothing, and why: an account deevy
   * cannot place, a Human the Checkpoint will not take, nothing waiting
   * (ADR-0025). Said back in the tracker as a reply, because the Human who
   * wrote it is reading there and not here.
   */
  | "gate.ruling_refused"
  /**
   * An account on a tool is now somebody's here, or no longer is: the
   * Identity a Ruling from outside deevy is attributed through (ADR-0025).
   */
  | "identity.linked"
  | "identity.revoked"
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
   * The code half of a Run (ADR-0014, ADR-0024). `run.checkout_issued` says a
   * credential was minted and never what it was; `run.pull_request_opened`
   * says where the work went.
   */
  | "run.checkout_issued"
  | "run.pull_request_opened"
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
  // And what the tracker is owed, which is deevy saying back where the work
  // lives (ADR-0024). Same shape, same row, same sweep: a Project that mirrors
  // nothing pays one pure check and no query at all (sockets/mirror.ts).
  owed.push(...(await deriveSocketMirrors(source.db, row)));

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
