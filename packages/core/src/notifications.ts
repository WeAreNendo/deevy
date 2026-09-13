import {
  humanNotificationKinds,
  delivery as deliveryTable,
  issue as issueTable,
  notification as notificationTable,
  workflowState,
  type Db,
  type Event,
  type HumanNotificationKind,
  type Notification,
} from "@deevy/db";
import { eq } from "drizzle-orm";
import { approvalsThisVisit, eligibleApprovers, gateApprovers, requesterFor } from "./workflow.ts";
import { newId } from "./ids.ts";

/**
 * Notifications derive from the Event log rather than being written a second
 * time (docs/PLAN.md): this runs in the same request, right after the Event is
 * appended, and reads only that Event. Nothing here decides what happened.
 *
 * Routing is two questions asked in order. Who does this Event concern — the
 * answer the Event log alone gives, unchanged since M1 — and then, for each of
 * them, which Channels it reaches: their own preferences say what they want to
 * hear, and the Workspace's routing rules say where a Slack Channel gets it
 * (docs/plans/m2.md). The first question never depends on the second, so
 * turning Slack off changes where a Human hears about something and never
 * whether it concerns them.
 *
 * One inbox row per recipient per kind per Event, and one message per Channel
 * per Event, both of them the unique indexes' invariant rather than this
 * function's care (docs/plans/m3.md). The actor is never told about their own
 * action, and a suspended Member is told nothing at all.
 */
export async function deriveNotifications(db: Db, event: Event): Promise<void> {
  const { inbox, slack } = await routeEvent(db, event);

  if (inbox.length > 0) {
    // One row per recipient per kind per Event, which the unique index makes
    // true rather than this being the only caller careful enough to keep it
    // (docs/plans/m3.md): running this a second time for the same Event owes
    // nobody a second inbox row.
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

  // The delivery row is the record that a message is owed, and the only one
  // (schema/delivery.ts): the sweep renders it from this Event when it sends,
  // so nothing here copies what it will say. One row per Channel per Event
  // with no recipient, because an incoming webhook posts to a room and three
  // Humans concerned by one Event are not three messages in it.
  if (slack.length > 0) {
    await db
      .insert(deliveryTable)
      .values(
        slack.map(({ channelId }) => ({
          id: newId("delivery"),
          workspaceId: event.workspaceId,
          target: "slack" as const,
          targetId: channelId,
          eventSeq: event.seq,
        })),
      )
      .onConflictDoNothing();
  }
}

export type Recipient = { memberId: string; kind: Notification["kind"] };

/** A Recipient owed one of the kinds a Human is sent, and so one with a preference and a rule. */
type HumanRecipient = { memberId: string; kind: HumanNotificationKind };

/** Whether a Human is ever sent this kind, and so whether Slack can say it. */
export function isHumanNotificationKind(kind: Notification["kind"]): kind is HumanNotificationKind {
  return (humanNotificationKinds as ReadonlyArray<string>).includes(kind);
}

/**
 * Whether this Notification is a Human's. A guard on the Recipient rather than
 * on its kind, so filtering narrows what the preference lookup and the Slack
 * rules are handed rather than leaving them to trust a comment.
 */
function isHumanRecipient(recipient: Recipient): recipient is HumanRecipient {
  return isHumanNotificationKind(recipient.kind);
}

/** One Slack Channel a Notification of this kind is due to reach. */
export interface SlackTarget {
  channelId: string;
  /** Slack's incoming-webhook URL, out of the Channel's config. */
  webhookUrl: string;
  kind: Notification["kind"];
}

/** Where one Event's Notifications go. */
export interface Routing {
  /** The Members who get an inbox row, and what it says. */
  inbox: Recipient[];
  /**
   * The Slack Channels the same Notification reaches, at most once each: a
   * Channel is a room, not a person, so two recipients routed to the same one
   * are one message.
   */
  slack: SlackTarget[];
}

const noRouting: Routing = { inbox: [], slack: [] };

/**
 * The routing decision for one Event: recipients first, then Channels. Two
 * queries beyond the recipients, whatever the Workspace holds — the
 * preferences of the Members concerned, and the Workspace's rules with their
 * Channels — because this runs in the tail of every write.
 */
export async function routeEvent(db: Db, event: Event): Promise<Routing> {
  const recipients = await recipientsFor(db, event);
  if (recipients.length === 0) return noRouting;

  // An Agent's Notification takes neither road. The preference matrix and the
  // Workspace's routing rules are a Human's answer to "what do I want to hear
  // about, and where", and an Agent has no preferences and no Slack: its inbox
  // is the endpoint ADR-0003 promised it (schema/notification.ts).
  const forAgents = recipients.filter((recipient) => !isHumanRecipient(recipient));
  const forHumans = recipients.filter(isHumanRecipient);
  if (forHumans.length === 0) return { inbox: forAgents, slack: [] };

  const preferences = await db.query.notificationPreference.findMany({
    where: { memberId: { in: forHumans.map((recipient) => recipient.memberId) } },
  });
  const wanted = new Map(preferences.map((row) => [`${row.memberId}:${row.kind}`, row] as const));
  // A Member who has never said otherwise wants everything, in both places:
  // the row is a preference, and its absence is the default (schema/channel.ts).
  const wants = (recipient: HumanRecipient, where: "inbox" | "slack") =>
    wanted.get(`${recipient.memberId}:${recipient.kind}`)?.[where] ?? true;

  const inbox = [...forAgents, ...forHumans.filter((recipient) => wants(recipient, "inbox"))];
  const kinds = new Set(
    forHumans.filter((recipient) => wants(recipient, "slack")).map((recipient) => recipient.kind),
  );
  if (kinds.size === 0) return { inbox, slack: [] };

  return { inbox, slack: await slackTargets(db, event, kinds) };
}

/**
 * The Slack Channels the Workspace's rules send these kinds to. A rule with a
 * null kind or a null Project means any of them (schema/channel.ts), and a
 * rule scoped to a Project only fires for that Project's Events.
 */
async function slackTargets(
  db: Db,
  event: Event,
  kinds: Set<HumanNotificationKind>,
): Promise<SlackTarget[]> {
  const rules = await db.query.routingRule.findMany({
    where: { workspaceId: event.workspaceId },
    with: { channel: true },
  });

  const targets = new Map<string, SlackTarget>();
  for (const rule of rules) {
    if (rule.channel.kind !== "slack") continue;
    if (rule.projectId !== null && rule.projectId !== event.projectId) continue;
    const webhookUrl = rule.channel.config?.webhookUrl;
    if (typeof webhookUrl !== "string" || webhookUrl.length === 0) continue;
    for (const kind of kinds) {
      if (rule.notificationKind !== null && rule.notificationKind !== kind) continue;
      targets.set(`${rule.channelId}:${kind}`, { channelId: rule.channelId, webhookUrl, kind });
    }
  }
  return [...targets.values()];
}

/**
 * The Issue a Notification points at. A Run is not an Issue, but it happens on
 * one, and its Events carry that Issue so the inbox needs no second query.
 */
export function issueOf(event: Event): string | null {
  // A wave of sub-issues is one line about the parent, so it is the parent the
  // line points at: the parent is the only place that work is whole
  // (docs/plans/sub-issue-delegation.md).
  const under = delegatedUnder(event);
  if (under) return under;
  if (event.subjectType === "issue") return event.subjectId;
  if (!event.kind.startsWith("run.")) return null;
  const carried = (event.payload as { issueId?: unknown } | null)?.issueId;
  return typeof carried === "string" ? carried : null;
}

/** The parent an Agent opened this Issue under, when that is what happened. */
function delegatedUnder(event: Event): string | null {
  if (event.kind !== "issue.created") return null;
  const carried = (event.payload as { delegatedTo?: unknown } | null)?.delegatedTo;
  return typeof carried === "string" ? carried : null;
}

/** What a Run Event tells a Human, or nothing when the Event is not one. */
const runNotificationKinds: Partial<Record<Event["kind"], Notification["kind"]>> = {
  "run.awaiting_input": "run_awaiting_input",
  "run.completed": "run_finished",
  "run.failed": "run_finished",
};

/**
 * The one Event whose Notification is owed to the Agent rather than to a Human.
 *
 * ADR-0003 says an Agent without a webhook polls its inbox over MCP, and until
 * now the one thing it waits for never arrived there: a Gate ruling resumed its
 * Run and told nobody, so the Agent learned of it only by thinking to call
 * `runs.list` again. Everything else in this file routes to Humans because
 * everything else concerns them; this concerns the Agent, and the Human who
 * decided it is the actor and is never told about their own action
 * (docs/plans/m3.md).
 */
const AGENT_ANSWERED: Event["kind"] = "run.answered";

/** The Events that mean a Gate is waiting, whichever way the Issue arrived in one. */
const gateEventKinds = new Set<Event["kind"]>([
  "issue.created",
  "issue.moved",
  "gate.approval",
  "gate.approved",
  "gate.rejected",
]);

/**
 * What this Event tells a Human, decided from the Event alone. Delivery asks
 * this again when it sends, hours later and without the request that appended
 * the Event, so it must be a pure function of the row: the Event is the source
 * (ADR-0003), and a kind copied into the delivery row would be a second one.
 */
export function notificationKindOf(event: Event): Notification["kind"] | null {
  if (event.kind === "issue.assigned") return "assignment";
  if (event.kind === "comment.created" || event.kind === "issue.updated") return "mention";
  // Before the Gate kinds below, which `issue.created` is otherwise one of: a
  // sub-issue arriving in a Gate is not everybody's business, it is its
  // Sponsor's, and forty of them are one line.
  if (delegatedUnder(event) || event.kind === "issue.children_closed") return "delegation";
  if (gateEventKinds.has(event.kind)) return "gate_awaiting";
  // A Run that stopped at a Gate is asking for a decision, not for an answer:
  // the Event says so by carrying the Gate, and that is what the Human is
  // being asked for (docs/plans/m2.md).
  if (gateStateAsked(event)) return "gate_awaiting";
  if (event.kind === AGENT_ANSWERED) return "run_answered";
  return runNotificationKinds[event.kind] ?? null;
}

/** The Gate a `run.awaiting_input` Event is waiting on, when it is waiting on one. */
function gateStateAsked(event: Event): string | null {
  if (event.kind !== "run.awaiting_input") return null;
  const carried = (event.payload as { gateStateId?: unknown } | null)?.gateStateId;
  return typeof carried === "string" ? carried : null;
}

async function recipientsFor(db: Db, event: Event): Promise<Recipient[]> {
  const payload = (event.payload ?? {}) as {
    to?: unknown;
    mentionedMemberIds?: unknown;
  };

  if (event.kind === "issue.assigned") {
    const assignee = typeof payload.to === "string" ? payload.to : null;
    if (!assignee || assignee === event.actorMemberId) return [];
    return (await active(db, [assignee], event)).map((memberId) => ({
      memberId,
      kind: "assignment" as const,
    }));
  }

  const under = delegatedUnder(event);
  if (under) return delegationRecipients(db, event, under, { rollUp: true });
  if (event.kind === "issue.children_closed") {
    // Once per wave by its nature — the last sub-issue closes once — so it is
    // never rolled up into the line that announced the wave. They say two
    // different things and a Human wants both. And it is addressed to the
    // Sponsor of whoever split the work, not of whoever happened to close the
    // last piece of it.
    const opened = (event.payload as { openedBy?: unknown } | null)?.openedBy;
    return typeof opened === "string"
      ? delegationRecipients(db, event, event.subjectId, { rollUp: false, agent: opened })
      : [];
  }

  if (event.kind === "comment.created" || event.kind === "issue.updated") {
    const mentioned = Array.isArray(payload.mentionedMemberIds)
      ? payload.mentionedMemberIds.filter((id): id is string => typeof id === "string")
      : [];
    const others = mentioned.filter((id) => id !== event.actorMemberId);
    return (await active(db, others, event)).map((memberId) => ({
      memberId,
      kind: "mention" as const,
    }));
  }

  // A Gate is a State an Issue cannot leave without a Human, so arriving in one
  // is everyone's business until somebody decides. That includes arriving by
  // approval: approving Intent lands the Issue in the Spec Gate, which needs a
  // Human just as much as the one before it.
  if (
    event.kind === "issue.created" ||
    event.kind === "issue.moved" ||
    event.kind === "gate.approval" ||
    event.kind === "gate.approved" ||
    event.kind === "gate.rejected"
  ) {
    if (event.subjectType !== "issue") return [];
    const gate = await gateStateOf(db, event.subjectId);
    if (!gate) return [];
    return gateRecipients(db, event, gate);
  }

  // An Agent that reached a Gate mid-Run asks the same Humans the Gate itself
  // would ask, not the Human behind the Run: the decision is the Gate's to
  // make (ADR-0004), and the Sponsor may not be one of its approvers.
  const askedAbout = gateStateAsked(event);
  if (askedAbout) {
    const asked = (event.payload as { issueId?: unknown } | null)?.issueId;
    const gate = await gateAsked(db, askedAbout, typeof asked === "string" ? asked : null);
    return gate ? gateRecipients(db, event, gate) : [];
  }

  // A ruling is owed to whoever asked for it, and that is the Agent.
  if (event.kind === AGENT_ANSWERED && event.subjectType === "run") {
    const found = await db.query.run.findFirst({
      where: { id: event.subjectId },
      columns: { agentMemberId: true },
    });
    if (!found || found.agentMemberId === event.actorMemberId) return [];
    return (await active(db, [found.agentMemberId], event)).map((memberId) => ({
      memberId,
      kind: "run_answered" as const,
    }));
  }

  // A Run belongs to the Human behind it: the Member that triggered it, or the
  // Sponsor accountable for the Agent when an Agent triggered its own work
  // (docs/plans/m2.md). One Human, so a finished Run is told once.
  const runKind = runNotificationKinds[event.kind];
  if (runKind) {
    if (event.subjectType !== "run") return [];
    const found = await db.query.run.findFirst({
      where: { id: event.subjectId },
      columns: { agentMemberId: true, triggeredByMemberId: true },
    });
    if (!found) return [];
    const human = await humanBehind(db, found.triggeredByMemberId ?? found.agentMemberId);
    if (!human || human === event.actorMemberId) return [];
    return (await active(db, [human], event)).map((memberId) => ({ memberId, kind: runKind }));
  }

  return [];
}

/**
 * The Human accountable for a Member: itself when it is a Human, its Sponsor
 * when it is an Agent (CONTEXT.md). An Agent with no Sponsor tells nobody.
 */
async function humanBehind(db: Db, memberId: string | null): Promise<string | null> {
  if (!memberId) return null;
  const found = await db.query.member.findFirst({
    where: { id: memberId },
    columns: { kind: true, sponsorId: true },
  });
  if (!found) return null;
  return found.kind === "human" ? memberId : found.sponsorId;
}

/** The Gate an Issue is sitting in, or none when the State it is in is not one. */
async function gateStateOf(db: Db, issueId: string): Promise<Gate | null> {
  const [row] = await db
    .select({
      id: workflowState.id,
      isGate: workflowState.isGate,
      excludeRequester: workflowState.excludeRequester,
      issueId: issueTable.id,
      stateEnteredAt: issueTable.stateEnteredAt,
    })
    .from(issueTable)
    .innerJoin(workflowState, eq(issueTable.stateId, workflowState.id))
    .where(eq(issueTable.id, issueId))
    .limit(1);
  return row?.isGate === true ? row : null;
}

/** The Gate an Issue is in, with the Issue's visit to it. */
interface Gate {
  id: string;
  excludeRequester: boolean;
  issueId: string;
  stateEnteredAt: Date;
}

/** The same, for a Gate named by a Run's question rather than by where the Issue is. */
async function gateAsked(db: Db, stateId: string, issueId: string | null): Promise<Gate | null> {
  const state = await db.query.workflowState.findFirst({
    where: { id: stateId },
    columns: { id: true, excludeRequester: true },
  });
  if (!state) return null;
  const issue = issueId
    ? await db.query.issue.findFirst({
        where: { id: issueId },
        columns: { id: true, stateEnteredAt: true },
      })
    : null;
  return {
    id: state.id,
    excludeRequester: state.excludeRequester,
    issueId: issue?.id ?? "",
    stateEnteredAt: issue?.stateEnteredAt ?? new Date(0),
  };
}

/**
 * Who is asked to decide one Gate. A Gate that names approvers asks only them;
 * one that names none asks every active Human, which is what M1 shipped
 * (schema/gate.ts). The actor is never asked about their own action either way.
 */
async function gateRecipients(db: Db, event: Event, gate: Gate): Promise<Recipient[]> {
  const named = await gateApprovers(db, gate.id);
  const visit = { id: gate.issueId, stateEnteredAt: gate.stateEnteredAt };
  // Both of these cost a query and neither is the common case, so neither is
  // paid for by a Workflow that wants one approval from anybody: creating an
  // Issue in a Gate is deevy's busiest write (tests/budget.test.ts).
  //
  // A Gate that excludes the requester is asking them for nothing, so it does
  // not put the question in their inbox; and a Gate that wants more than one
  // Human keeps asking the ones who have not answered and stops asking the one
  // who has, since an approval already given is not a question
  // (docs/plans/four-eyes-gates.md).
  const requester = gate.excludeRequester && gate.issueId ? await requesterFor(db, visit) : null;
  const already =
    event.kind === "gate.approval" && gate.issueId
      ? await approvalsThisVisit(db, visit, gate.id)
      : [];
  const humans = await eligibleApprovers(db, {
    workspaceId: event.workspaceId,
    named,
    exclude: event.actorMemberId,
  });
  return humans
    .filter((memberId) => memberId !== requester && !already.includes(memberId))
    .map((memberId) => ({ memberId, kind: "gate_awaiting" as const }));
}

/** Of the given Members, those still able to act. Suspension silences an inbox. */
/**
 * Who hears that an Agent split work up, or finished splitting it: the Human
 * accountable for that Agent, and nobody else. Rolled up to one line per parent
 * while that line is unread — a wave of forty sub-issues is one thing that
 * happened, and forty rows about it is an inbox nobody can use
 * (docs/plans/sub-issue-delegation.md).
 */
async function delegationRecipients(
  db: Db,
  event: Event,
  parentId: string,
  { rollUp, agent }: { rollUp: boolean; agent?: string },
): Promise<Recipient[]> {
  const who = agent ?? event.actorMemberId;
  const actor = who
    ? await db.query.member.findFirst({
        where: { id: who },
        columns: { sponsorId: true, kind: true },
      })
    : null;
  const sponsor = actor?.kind === "agent" ? actor.sponsorId : null;
  if (!sponsor) return [];
  /*
   * Rolled up against the other waves only. An unread "every sub-issue is
   * finished" line is the same kind on the same parent, and matching it would
   * mean the wake-up Run's own decomposition — the whole point of waking it —
   * is never announced.
   */
  const already = rollUp
    ? await db.query.notification.findFirst({
        where: {
          recipientMemberId: sponsor,
          kind: "delegation",
          issueId: parentId,
          readAt: { isNull: true },
          event: { kind: "issue.created" },
        },
        columns: { id: true },
      })
    : null;
  if (already) return [];
  return (await active(db, [sponsor], event)).map((memberId) => ({
    memberId,
    kind: "delegation" as const,
  }));
}

async function active(db: Db, memberIds: string[], event: Event): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const rows = await db.query.member.findMany({
    where: {
      id: { in: memberIds },
      workspaceId: event.workspaceId,
      suspendedAt: { isNull: true },
    },
    columns: { id: true },
  });
  return rows.map((row) => row.id);
}
