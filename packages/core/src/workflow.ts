import {
  gateApprover as gateApproverTable,
  event as eventTable,
  gateDecision as gateDecisionTable,
  gateDecisionDocument as gateDecisionDocumentTable,
  issue as issueTable,
  member as memberTable,
  type Db,
  type Issue,
  type Member,
  type WorkflowState,
} from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { issueUrl } from "./slack.ts";
import { newId } from "./ids.ts";

/** A State as the default template describes it, before it belongs to a Project. */
export type WorkflowStateTemplate = Pick<
  WorkflowState,
  "name" | "position" | "isGate" | "category" | "documentName" | "documentTemplate"
>;

/**
 * The Document templates the playbook asks each of the first three States for
 * (docs/PLAN.md). They are headings rather than prose, so an Agent and a Human
 * fill in the same shape.
 */
const templates = {
  intent: [
    "## Problem",
    "",
    "## Proposed outcome",
    "",
    "## Affected users and systems",
    "",
    "## Constraints",
    "",
    "## Open questions",
    "",
  ].join("\n"),
  spec: ["## Requirements", "", "## Design", "", "## Flagged concerns", ""].join("\n"),
  plan: ["## Files that change", "", "## Order of work", "", "## Tests that prove it", ""].join(
    "\n",
  ),
};

/**
 * The default Workflow every new Project starts with (docs/PLAN.md): Intent,
 * Spec, Plan, Build, Review, Done, with Gates on leaving Intent, Spec, Plan and
 * Review. A team that wants Todo, Doing, Done deletes the middle.
 *
 * `category` is what tells a board and a list which Issues are open: an Issue
 * is active from the moment someone writes its Spec, since reaching Spec means
 * the Intent Gate accepted the work.
 */
export function defaultWorkflow(): WorkflowStateTemplate[] {
  return [
    {
      name: "Intent",
      position: 0,
      isGate: true,
      category: "backlog",
      documentName: "intent",
      documentTemplate: templates.intent,
    },
    {
      name: "Spec",
      position: 1,
      isGate: true,
      category: "active",
      documentName: "spec",
      documentTemplate: templates.spec,
    },
    {
      name: "Plan",
      position: 2,
      isGate: true,
      category: "active",
      documentName: "plan",
      documentTemplate: templates.plan,
    },
    {
      name: "Build",
      position: 3,
      isGate: false,
      category: "active",
      documentName: null,
      documentTemplate: null,
    },
    {
      name: "Review",
      position: 4,
      isGate: true,
      category: "active",
      documentName: null,
      documentTemplate: null,
    },
    {
      name: "Done",
      position: 5,
      isGate: false,
      category: "done",
      documentName: null,
      documentTemplate: null,
    },
  ];
}

/**
 * Moving an Issue into a State. A `done` State closes the Issue and leaving one
 * reopens it, so `closedAt` and the State's category never disagree
 * (docs/plans/m1.md). Every move stamps `stateEnteredAt`.
 */
export async function enterState(db: Db, issue: Issue, to: WorkflowState): Promise<void> {
  await db
    .update(issueTable)
    .set({
      stateId: to.id,
      stateEnteredAt: new Date(),
      closedAt: to.category === "done" ? (issue.closedAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(eq(issueTable.id, issue.id));
}

/**
 * A Gate is a State an Issue cannot leave without a Human's approval
 * (CONTEXT.md), so a plain move out of one is refused and `gates.approve` or
 * `gates.reject` is the only way through.
 */
export function assertLeavable(from: WorkflowState, issueKey: string): void {
  if (!from.isGate) return;
  throw new ORPCError("FORBIDDEN", {
    message: `${issueKey} is in the ${from.name} Gate; approve or reject it`,
  });
}

/**
 * Only a Human rules on a Gate (ADR-0004). The check lives here rather than in
 * the registry so M2's Agents meet it without a new rule.
 */
export function assertHuman(member: Pick<Member, "kind">): void {
  if (member.kind === "agent") {
    throw new ORPCError("FORBIDDEN", { message: "Only a Human can decide a Gate" });
  }
}

/**
 * The Humans a Gate names, in no particular order. Empty is M1's behaviour and
 * the default: any Human may decide it (schema/gate.ts). Naming approvers
 * narrows both who is asked and who may answer.
 */
export async function gateApprovers(db: Db, stateId: string): Promise<string[]> {
  const rows = await db
    .select({ memberId: gateApproverTable.memberId })
    .from(gateApproverTable)
    .where(eq(gateApproverTable.stateId, stateId));
  return rows.map((row) => row.memberId);
}

/**
 * A named list narrows who may decide; an empty one narrows nothing. ADR-0004
 * keeps every Agent out either way, which `assertHuman` says first.
 */
export function assertNamedApprover(approvers: string[], memberId: string): void {
  if (approvers.length === 0 || approvers.includes(memberId)) return;
  throw new ORPCError("FORBIDDEN", {
    message: "This Gate names its approvers, and you are not one of them",
  });
}

/**
 * The Humans who could rule on this Gate: the ones it names, or every Human of
 * the Workspace when it names none, less the suspended and less whoever is
 * being left out. It is one function because four callers need the same answer
 * and disagreeing about it is how a Gate becomes unopenable — the inbox asks
 * who to tell, `workflow.update` asks whether a threshold can ever be met,
 * `gates.approve` asks whether this Human counts, and the Issue page asks what
 * to say (docs/plans/four-eyes-gates.md).
 *
 * `named` is passed in rather than read here because `workflow.update` asks
 * about a list it has not written yet.
 */
export async function eligibleApprovers(
  db: Db,
  input: { workspaceId: string; named: string[]; exclude?: string | null },
): Promise<string[]> {
  const rows = await db
    .select({ id: memberTable.id })
    .from(memberTable)
    .where(
      and(
        eq(memberTable.workspaceId, input.workspaceId),
        eq(memberTable.kind, "human"),
        isNull(memberTable.suspendedAt),
        input.exclude ? ne(memberTable.id, input.exclude) : undefined,
        input.named.length > 0 ? inArray(memberTable.id, input.named) : undefined,
      ),
    );
  return rows.map((row) => row.id);
}

/**
 * The Events that put an Issue where it is. A `gate.rejected` counts only when
 * it moved the Issue: a rejection in the first State has nowhere to send it and
 * leaves it in the Gate it was already in, which somebody else put it in.
 */
function movedTheIssue(row: { kind: string; payload: Record<string, unknown> | null }): boolean {
  if (row.kind === "issue.created" || row.kind === "issue.moved") return true;
  if (row.kind === "gate.approved") return true;
  if (row.kind !== "gate.rejected") return false;
  return row.payload?.to !== row.payload?.state;
}

/**
 * The Human who put this Issue in front of the Gate it is in: the actor on the
 * move that brought it here and, when that actor is an Agent, its Sponsor. That
 * is PLAN.md's own rule for accountability — the accountable Human is the
 * triggering Human, or the Sponsor when an Agent triggered it — asked about who
 * should not be the one to wave the work through.
 *
 * Null when the log does not say: an Issue carried into a State by a Workflow
 * edit has no Event of its own, and a rule that guessed would be worse than one
 * that abstains. Only Events at or after `stateEnteredAt` are considered, which
 * is what makes that case null rather than the previous move's actor.
 */
export async function requesterFor(
  db: Db,
  issue: Pick<Issue, "id" | "stateEnteredAt">,
): Promise<string | null> {
  const rows = await db
    .select({
      kind: eventTable.kind,
      payload: eventTable.payload,
      actorMemberId: eventTable.actorMemberId,
      createdAt: eventTable.createdAt,
    })
    .from(eventTable)
    .where(and(eq(eventTable.subjectType, "issue"), eq(eventTable.subjectId, issue.id)))
    .orderBy(desc(eventTable.seq));

  for (const row of rows) {
    if (row.createdAt < issue.stateEnteredAt) return null;
    if (!movedTheIssue(row)) continue;
    if (!row.actorMemberId) return null;
    const actor = await db.query.member.findFirst({
      where: { id: row.actorMemberId },
      columns: { id: true, kind: true, sponsorId: true },
    });
    if (!actor) return null;
    return actor.kind === "agent" ? actor.sponsorId : actor.id;
  }
  return null;
}

/**
 * The distinct Humans who have approved this Gate during the Issue's current
 * visit to it, oldest first.
 *
 * A visit begins when the Issue enters the State, and begins again at every
 * rejection: a rejection is the answer, so approvals given before it are spent
 * whether or not the Issue moved. That second half matters because a rejection
 * in the first State has nowhere to send the Issue and so does not stamp
 * `stateEnteredAt` — without it, a Gate a Human had just rejected would open on
 * the next approval. Approvals do not begin a visit; they accumulate within one.
 *
 * A decision whose Member has been deleted counts for nobody: `memberId` is
 * `set null` on delete (schema/gate.ts), and a Gate must not be held open on
 * behalf of a Member who is gone.
 */
export async function approvalsThisVisit(
  db: Db,
  issue: Pick<Issue, "id" | "stateEnteredAt">,
  stateId: string,
): Promise<string[]> {
  const rows = await approvalsWithNotes(db, issue, stateId);
  return rows.map((row) => row.memberId);
}

/**
 * The same, less the approvals a Document change has since cleared (ADR-0021).
 * Separate from the pure rule above because it asks the log a question, and
 * separate from the rule's own reset because a rejection and a rewrite are
 * different things: one sends the Issue back, the other only starts the
 * counting again.
 */
export async function approvalsStanding(
  db: Db,
  issue: Pick<Issue, "id" | "stateEnteredAt" | "approvalsClearedAt">,
  stateId: string,
): Promise<Array<{ memberId: string; note: string | null; at: Date }>> {
  const rows = await approvalsWithNotes(db, issue, stateId);
  const cleared = issue.approvalsClearedAt;
  return cleared ? rows.filter((row) => row.at > cleared) : rows;
}

/** The same approvals, with what each Human said and when: the Issue page reads these. */
export async function approvalsWithNotes(
  db: Db,
  issue: Pick<Issue, "id" | "stateEnteredAt">,
  stateId: string,
): Promise<Array<{ memberId: string; note: string | null; at: Date }>> {
  const rows = await db
    .select({
      memberId: gateDecisionTable.memberId,
      decision: gateDecisionTable.decision,
      note: gateDecisionTable.note,
      createdAt: gateDecisionTable.createdAt,
    })
    .from(gateDecisionTable)
    .where(and(eq(gateDecisionTable.issueId, issue.id), eq(gateDecisionTable.stateId, stateId)))
    .orderBy(asc(gateDecisionTable.createdAt));

  return approvalsFrom(rows, issue.stateEnteredAt);
}

/**
 * The rule itself, over one Gate's rulings in the order they were made. Kept
 * pure so a caller holding the rulings already — the Issue page loads them for
 * its own history — spends no second query on them.
 */
export function approvalsFrom(
  rows: Array<{ memberId: string | null; decision: string; note: string | null; createdAt: Date }>,
  stateEnteredAt: Date,
): Array<{ memberId: string; note: string | null; at: Date }> {
  let approvals: Array<{ memberId: string; note: string | null; at: Date }> = [];
  for (const row of rows) {
    if (row.createdAt < stateEnteredAt) continue;
    if (row.decision === "rejected") {
      approvals = [];
      continue;
    }
    if (!row.memberId) continue;
    if (approvals.some((given) => given.memberId === row.memberId)) continue;
    approvals.push({ memberId: row.memberId, note: row.note, at: row.createdAt });
  }
  return approvals;
}

/** Why a Human may not approve the Gate an Issue is in. */
export type GateRefusal = "not_an_approver" | "requester" | "approved" | "too_few_humans";

export interface GateStanding {
  /** Distinct Humans who must approve before the Issue leaves. */
  required: number;
  /** How many Humans could give one: the named approvers, or everybody, less the suspended. */
  eligible: number;
  /** Whether this Gate refuses the Human who brought the Issue to it. */
  excludeRequester: boolean;
  /** Who has approved during this visit, oldest first. */
  approvals: Array<{ memberId: string; name: string | null; note: string | null; at: Date }>;
  mayApprove: boolean;
  /** Set when `mayApprove` is false, so a screen says why rather than only refusing. */
  refusedBecause: GateRefusal | null;
  /**
   * Approvals this Gate had, until the Document under them changed (ADR-0021).
   * Zero is the ordinary case; anything else is worth a line on the card, so
   * somebody who approved an hour ago is not left wondering where it went.
   */
  clearedByAnEdit: number;
}

/**
 * Everything a Human needs to know about the Gate an Issue is in: how far along
 * it is, whether they may move it, and when they may not, why
 * (docs/plans/four-eyes-gates.md slice 3).
 *
 * The four eligibility inputs — the named approvers, the active Humans, the
 * requester and who has already approved — are asked here once, so no screen
 * arrives at a different answer than `gates.approve` will. Nothing is asked at
 * all for a State that is not a Gate.
 */
export async function gateStanding(
  db: Db,
  input: {
    workspaceId: string;
    issue: Pick<Issue, "id" | "stateEnteredAt" | "approvalsClearedAt">;
    state: Pick<WorkflowState, "id" | "approvalsRequired" | "excludeRequester">;
    memberId: string;
    /** This Issue's rulings, oldest first, when the caller has them already. */
    decisions?: Array<{
      stateId: string;
      memberId: string | null;
      decision: string;
      note: string | null;
      createdAt: Date;
    }>;
  },
): Promise<GateStanding> {
  const named = await gateApprovers(db, input.state.id);
  const eligible = await eligibleApprovers(db, { workspaceId: input.workspaceId, named });
  // Approvals a Document change has cleared are history rather than a count
  // (ADR-0021): the ruling stays in the log, and the Gate asks again. The
  // boundary is on the Issue row this was called with, so it costs no query.
  const cleared = input.issue.approvalsClearedAt;
  const given = input.decisions
    ? approvalsFrom(
        input.decisions.filter((row) => row.stateId === input.state.id),
        input.issue.stateEnteredAt,
      )
    : await approvalsWithNotes(db, input.issue, input.state.id);
  const approved = cleared ? given.filter((row) => row.at > cleared) : given;
  const requester = input.state.excludeRequester ? await requesterFor(db, input.issue) : null;
  const rows = approved.length
    ? await db.query.member.findMany({
        where: { id: { in: approved.map((given) => given.memberId) } },
        columns: { id: true },
        with: { user: { columns: { name: true } } },
      })
    : [];

  const required = input.state.approvalsRequired;
  const available = eligible.filter((id) => id !== requester).length;
  // Ordered so the reason a Human reads is the one that is about them: being
  // shut out of the Gate, then having brought the Issue, then having already
  // answered, and last the arithmetic, which is nobody's fault and everybody's
  // problem (docs/plans/four-eyes-gates.md, convention 32).
  const refusedBecause: GateRefusal | null =
    named.length > 0 && !named.includes(input.memberId)
      ? "not_an_approver"
      : requester === input.memberId
        ? "requester"
        : approved.some((given) => given.memberId === input.memberId)
          ? "approved"
          : available < required
            ? "too_few_humans"
            : null;

  return {
    required,
    eligible: available,
    excludeRequester: input.state.excludeRequester,
    approvals: approved.map((given) => ({
      ...given,
      name: rows.find((member) => member.id === given.memberId)?.user.name ?? null,
    })),
    mayApprove: refusedBecause === null,
    refusedBecause,
    clearedByAnEdit: given.length - approved.length,
  };
}

/**
 * The Issue's page with this Gate in focus: the link an Agent hands a Human
 * when it reaches a Gate mid-Run (docs/plans/m2.md). The SPA reads `?gate=`
 * and scrolls to it.
 */
export function gateUrl(baseUrl: string, key: string, stateId: string): string {
  return `${issueUrl(baseUrl, key)}?gate=${encodeURIComponent(stateId)}`;
}

/** The State an approval moves to: the next by position, or none when the Gate is last. */
export function nextState(states: WorkflowState[], from: WorkflowState): WorkflowState | null {
  const ordered = [...states].sort((a, b) => a.position - b.position);
  const at = ordered.findIndex((state) => state.id === from.id);
  return ordered[at + 1] ?? null;
}

/** The State a rejection returns to: the previous by position, or the Gate itself when it is first. */
export function previousState(states: WorkflowState[], from: WorkflowState): WorkflowState {
  const ordered = [...states].sort((a, b) => a.position - b.position);
  const at = ordered.findIndex((state) => state.id === from.id);
  return ordered[at - 1] ?? from;
}

export interface RecordDecisionInput {
  issueId: string;
  stateId: string;
  decision: (typeof import("@deevy/db").gateDecisions)[number];
  note?: string | null;
  memberId: string;
}

/**
 * A ruling, and what the Issue's Documents said when it was made. The pin is
 * the point: a Human approves text, and an Agent may write that text again
 * immediately afterwards, so without the version an approval records nothing
 * about what was approved (docs/plans/collaborative-documents.md).
 */
export async function recordGateDecision(db: Db, input: RecordDecisionInput): Promise<string> {
  const id = newId("decision");
  await db.insert(gateDecisionTable).values({
    id,
    issueId: input.issueId,
    stateId: input.stateId,
    decision: input.decision,
    note: input.note ?? null,
    memberId: input.memberId,
  });
  const documents = await db.query.document.findMany({ where: { issueId: input.issueId } });
  if (documents.length > 0) {
    await db.insert(gateDecisionDocumentTable).values(
      documents.map((one) => ({
        decisionId: id,
        documentId: one.id,
        name: one.name,
        version: one.currentVersion,
      })),
    );
  }
  return id;
}
