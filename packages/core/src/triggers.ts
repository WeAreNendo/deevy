import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  member as memberTable,
  projectGrant,
  run as runTable,
  type Db,
  type Event,
  type Run,
} from "@deevy/db";
import type { EventInput } from "./events.ts";
import { openRunFor } from "./runs.ts";
import { newId } from "./ids.ts";

/**
 * The triggers read the Event log rather than being spread through the handlers
 * that write it: this runs in `appendEvent`'s tail beside
 * `deriveNotifications`, in the same request and right after the Event, and
 * reads only that Event. Nothing here decides what happened.
 *
 * It returns the Events its own writes deserve rather than appending them, so
 * `appendEvent` stays the only writer of the log and this module never imports
 * it back. Those Events go through the tail again, which is safe because every
 * path is guarded by the "at most one open Run per (issue, agent)" rule, and
 * `run.*` triggers nothing at all.
 */
export async function triggersFor(db: Db, event: Event): Promise<EventInput[]> {
  // A Run is not a reason to start a Run. This is the first line of the
  // recursion guard; the open-Run rule below is the second.
  if (event.kind.startsWith("run.")) return [];
  if (event.subjectType !== "issue") return [];

  if (event.kind === "issue.assigned") {
    const payload = (event.payload ?? {}) as { to?: unknown };
    const assignee = typeof payload.to === "string" ? payload.to : null;
    return startRuns(db, event, assignee ? [assignee] : [], "assignment");
  }

  if (event.kind === "comment.created") {
    const payload = (event.payload ?? {}) as { mentionedMemberIds?: unknown };
    const mentioned = Array.isArray(payload.mentionedMemberIds)
      ? payload.mentionedMemberIds.filter((id): id is string => typeof id === "string")
      : [];
    // A Project can say a mention hands nobody work (`routing.mention`). The
    // comment still tells whoever it names (notifications.ts), and a label,
    // an assignment or the Project's default still routes the record.
    if (mentioned.length === 0 || !(await mentionsRoute(db, event.projectId))) return [];
    return startRuns(db, event, mentioned, "mention");
  }

  // A record the tracker closed is what finishes a piece of work now: `done`
  // was a State's category, and there are no States (ADR-0024).
  if (event.kind === "issue.closed") return wakeParent(db, event);

  return [];
}

/**
 * An Agent that delegates does not wait — its Run finishes, and this is what
 * wakes it (docs/plans/sub-issue-delegation.md). When the Issue that just
 * closed was the last of its parent's sub-issues, the parent is told so and the
 * Agent it is routed to gets a Run to pick the work back up from.
 *
 * Three ways this could loop, and what stops each. A parent that is itself a
 * child closes bottom-up, one wake per level, because each level is only
 * reached by its own child closing. A parent that is already
 * finished is not waiting for anything and is left alone. And a child reopened
 * and closed again cannot open a second Run, because at most one is open per
 * (issue, agent) and the first is still there.
 */
async function wakeParent(db: Db, event: Event): Promise<EventInput[]> {
  const child = await db.query.issue.findFirst({
    where: { id: event.subjectId },
    columns: { id: true, parentId: true, state: true },
  });
  if (!child?.parentId || child.state !== "closed") return [];

  const parent = await db.query.issue.findFirst({
    where: { id: child.parentId },
    columns: { id: true, projectId: true, state: true, assigneeMemberId: true },
  });
  if (!parent || parent.state === "closed") return [];

  // Across Projects and across Sockets: closed is closed, whoever said so, so
  // a child in another tracker finishing counts exactly as one here does.
  const siblings = await db.query.issue.findMany({
    where: { parentId: parent.id },
    columns: { id: true, state: true },
  });
  if (siblings.some((one) => one.state !== "closed")) return [];

  /*
   * The Agent the parent is routed to: the one that holds the work the
   * children were cut from. deevy no longer opens a sub-issue, so it cannot
   * say who did (docs/plans/simplify.md, slice 4); whoever holds the parent is
   * who the finished parts come back to. A parent routed to a Human, or to
   * nobody, wakes no Agent.
   */
  const [delegator] = await agentsAmong(
    db,
    parent.assigneeMemberId ? [parent.assigneeMemberId] : [],
    event.workspaceId,
  );

  const closed: EventInput = {
    kind: "issue.children_closed",
    subjectType: "issue",
    subjectId: parent.id,
    projectId: parent.projectId,
    // The Agent holding the parent, suspended or not: its Sponsor is who this
    // is addressed to, and a Sponsor whose Agent cannot pick the work back up
    // is exactly the person who needs to hear that it is finished.
    payload: { children: siblings.length, ...(delegator ? { routedTo: delegator } : {}) },
  };

  /*
   * A suspended Agent, or one whose grant on this Project was withdrawn while
   * the work was being done, wakes nothing. The Event still goes in, so the
   * parent is visibly a Human's rather than silently nobody's.
   */
  if (!delegator) return [closed];
  const [working] = await workingAgents(db, [delegator], event.workspaceId, parent.projectId);
  if (!working) return [closed];

  const started = await startRun(db, {
    issueId: parent.id,
    agentMemberId: working,
    // The Agent holding the work, not whoever happened to close the last part
    // of it. This field decides who hears when the Run finishes
    // (`notifications.ts`), and a passing Human must not inherit that.
    triggeredByMemberId: delegator,
    trigger: "children_done",
  });
  /*
   * No Run means somebody else already woke this parent — the other half of a
   * race, or a Run still open from the last time its sub-issues finished — and
   * they announced it. Saying it twice is two inbox rows about one thing.
   */
  return started ? [closed, runStartedEvent(started, parent.projectId)] : [];
}

/**
 * Starts one Run per Agent among the candidates and hands back the Events they
 * deserve. Candidates are whoever the rule named; which of them is an Agent
 * that can still work is this function's business, in one query rather than
 * one per name.
 */
async function startRuns(
  db: Db,
  event: Event,
  candidates: string[],
  trigger: Run["trigger"],
): Promise<EventInput[]> {
  const events: EventInput[] = [];
  if (!event.projectId) return events;
  const working = await workingAgents(db, candidates, event.workspaceId, event.projectId);
  for (const agentMemberId of working) {
    const started = await startRun(db, {
      issueId: event.subjectId,
      agentMemberId,
      triggeredByMemberId: event.actorMemberId,
      trigger,
    });
    if (started) events.push(runStartedEvent(started, event.projectId));
  }
  return events;
}

/** Whether a mention starts work in this Project, which it does unless the Project turned it off. */
async function mentionsRoute(db: Db, projectId: string | null): Promise<boolean> {
  if (!projectId) return false;
  const project = await db.query.project.findFirst({
    where: { id: projectId },
    columns: { routing: true },
  });
  return project?.routing.mention !== false;
}

/** Of the Members named, those that are Agents at all, suspended or not. */
async function agentsAmong(db: Db, memberIds: string[], workspaceId: string): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const rows = await db.query.member.findMany({
    where: { id: { in: memberIds }, workspaceId, kind: "agent" },
    columns: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Of the Members named, those a Run in this Project is work for: a Human is not
 * triggered, a suspended Member does nothing (docs/PLAN.md's Sponsor cascade),
 * and an Agent sees only the Projects it was granted. Without that last rule a
 * mention, an assignment, or a default Agent whose grant was taken back made a
 * Run the Agent could never see: `runs.list` leaves an ungranted Project out,
 * so it waited, pending, for good. One query, because a mention can name a
 * whole Team.
 */
async function workingAgents(
  db: Db,
  memberIds: string[],
  workspaceId: string,
  projectId: string,
): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const rows = await db
    .select({ id: memberTable.id })
    .from(memberTable)
    .innerJoin(
      projectGrant,
      and(eq(projectGrant.memberId, memberTable.id), eq(projectGrant.projectId, projectId)),
    )
    .where(
      and(
        inArray(memberTable.id, memberIds),
        eq(memberTable.workspaceId, workspaceId),
        eq(memberTable.kind, "agent"),
        isNull(memberTable.suspendedAt),
      ),
    );
  return rows.map((row) => row.id);
}

interface StartRunInput {
  issueId: string;
  agentMemberId: string;
  /** The Member whose action triggered it; null when deevy's own clock did. */
  triggeredByMemberId: string | null;
  trigger: Run["trigger"];
}

/**
 * Creates the Run unless the Agent already has an open one on the Issue. That
 * rule is slice 2's, enforced in one place (runs.ts): two attempts claiming one
 * outcome is the thing no trigger may cause.
 */
async function startRun(db: Db, input: StartRunInput): Promise<Run | null> {
  if (await openRunFor(db, input.issueId, input.agentMemberId)) return null;
  /*
   * And again, from the database. The read above is what normally stops a
   * second Run, but a trigger that reads and then inserts loses to another
   * request that did the same thing in between — which is not exotic here: two
   * sub-issues of one parent finishing at the same moment is how a fan-out
   * ordinarily ends (docs/plans/sub-issue-delegation.md). The partial unique
   * index settles it, and losing that race is not an error: somebody else
   * already started the Run this was going to start.
   */
  const [started] = await db
    .insert(runTable)
    .values({
      id: newId("run"),
      issueId: input.issueId,
      agentMemberId: input.agentMemberId,
      triggeredByMemberId: input.triggeredByMemberId,
      trigger: input.trigger,
    })
    .onConflictDoNothing()
    .returning();
  return (started as Run | undefined) ?? null;
}

/** The Event a triggered Run announces itself with, in `runs.start`'s shape. */
function runStartedEvent(run: Run, projectId: string | null): EventInput {
  return {
    kind: "run.started",
    subjectType: "run",
    subjectId: run.id,
    projectId,
    payload: {
      issueId: run.issueId,
      trigger: run.trigger,
      agentMemberId: run.agentMemberId,
    },
  };
}
