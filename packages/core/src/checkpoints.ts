import {
  checkpoint as checkpointTable,
  checkpointApprover,
  gateRequest as gateRequestTable,
  type Checkpoint,
  type Db,
  type Run,
} from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { newId } from "./ids.ts";

/**
 * What a Project asks before a Run goes past a Checkpoint (CONTEXT.md).
 *
 * Separate from `gates.ts` because the notification tail reads it: a Gate asks
 * whoever may rule on it, and `notifications.ts` is imported by `appendEvent`,
 * so anything it needs has to sit below the Event log rather than beside it.
 * Nothing here appends anything.
 */

/** What a Checkpoint wants, whether or not anybody configured it. */
export interface CheckpointPolicy {
  /** Null where nobody configured this name and the default is answering. */
  id: string | null;
  name: string;
  approvalsRequired: number;
  excludeRequester: boolean;
  /** Empty means every active Human may rule, which is what a Workspace starts with. */
  approverMemberIds: string[];
}

/**
 * One approval, from anybody. A Checkpoint nobody configured still has to have
 * an answer: an Agent that asks about `security-review` in a Workspace that
 * never heard of it must be told what to do, not left waiting on a policy row
 * that does not exist.
 */
export function defaultPolicy(name: string): CheckpointPolicy {
  return { id: null, name, approvalsRequired: 1, excludeRequester: false, approverMemberIds: [] };
}

/** The live policy for a name in a Project, or the default when there is none. */
export async function policyFor(
  db: Db,
  projectId: string,
  name: string,
): Promise<CheckpointPolicy> {
  const found = await db.query.checkpoint.findFirst({
    where: { projectId, name },
    with: { approvers: true },
  });
  if (!found) return defaultPolicy(name);
  return policyOf(
    found,
    found.approvers.map((row) => row.memberId),
  );
}

/** The policy a stored Checkpoint row and its approvers describe. */
export function policyOf(row: Checkpoint, approverMemberIds: string[]): CheckpointPolicy {
  return {
    id: row.id,
    name: row.name,
    approvalsRequired: row.approvalsRequired,
    excludeRequester: row.excludeRequester,
    approverMemberIds,
  };
}

/**
 * The Human behind a Run, which is who a four-eyes policy excludes.
 *
 * Read off the Run rather than walked out of the Event log: the Member that
 * triggered it when that Member is a Human, else the Sponsor accountable for
 * the Agent (PLAN.md's accountability rule). It matters more than it looks —
 * with an Agent asking from a Checkpoint rather than a Human moving an Issue,
 * a definition that named the last actor would exclude nobody at all.
 */
export async function requesterFor(
  db: Db,
  run: Pick<Run, "triggeredByMemberId" | "agentMemberId">,
): Promise<string | null> {
  if (run.triggeredByMemberId) {
    const triggered = await db.query.member.findFirst({
      where: { id: run.triggeredByMemberId },
      columns: { id: true, kind: true, sponsorId: true },
    });
    if (triggered?.kind === "human") return triggered.id;
    if (triggered?.sponsorId) return triggered.sponsorId;
  }
  const agent = await db.query.member.findFirst({
    where: { id: run.agentMemberId },
    columns: { sponsorId: true },
  });
  return agent?.sponsorId ?? null;
}

/**
 * The Humans of a Workspace who are not suspended: everybody who could rule on
 * anything in it. Every count of who could approve starts here, so it is one
 * statement wherever it is read and the rest is arithmetic on it.
 */
export async function activeHumans(db: Db, workspaceId: string): Promise<Set<string>> {
  const rows = await db.query.member.findMany({
    where: { workspaceId, kind: "human", suspendedAt: { isNull: true } },
    columns: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/**
 * Who may rule under a policy, of the active Humans: the ones it names, or all
 * of them where it names nobody. The empty list has always meant "anybody" and
 * says so here rather than in each reader of it.
 */
export function approversAmong(
  policy: Pick<CheckpointPolicy, "approverMemberIds">,
  active: ReadonlySet<string>,
): string[] {
  if (policy.approverMemberIds.length === 0) return [...active];
  return policy.approverMemberIds.filter((id) => active.has(id));
}

/** Who is asked to rule: the Humans the Checkpoint names, or every active Human. */
export async function gateApprovers(
  db: Db,
  workspaceId: string,
  policy: CheckpointPolicy,
): Promise<string[]> {
  return approversAmong(policy, await activeHumans(db, workspaceId));
}

/**
 * Sets a Project's Checkpoints to the list given, refusing a threshold nobody
 * could meet, and answers what they were before (`loweredApprovals` reads it).
 *
 * The list is the policy, so a Checkpoint left out of it is one the Project no
 * longer has. But a Checkpoint that stays is changed where it is, by name, and
 * keeps its id: an open Gate links the row it was asked under, and the Slack
 * message and the email read its threshold through that link. Deleting and
 * inserting every row, as this did until 2026-10-16, cut every open Gate
 * loose on any save, and both then said one approval whatever was wanted.
 *
 * Sequential statements, because D1 has no interactive transactions: the rows
 * removed, the approvers of the rows kept where they had any, a statement per
 * Checkpoint, every approver in one, and — for a Checkpoint added at a name an
 * open Gate already asked at — that Gate linked to it, so it reads the new
 * threshold the way a ruling on it does.
 */
export async function setCheckpoints(
  db: Db,
  projectId: string,
  workspaceId: string,
  wanted: Array<{
    name: string;
    approvalsRequired: number;
    excludeRequester: boolean;
    approverMemberIds: string[];
  }>,
): Promise<Array<{ name: string; approvalsRequired: number }>> {
  const active = await activeHumans(db, workspaceId);

  for (const one of wanted) {
    const possible = approversAmong(one, active).length;
    if (one.approverMemberIds.length > 0 && possible !== one.approverMemberIds.length) {
      throw new ORPCError("BAD_REQUEST", {
        message: `The ${one.name} Checkpoint names somebody who is not an active Human here`,
      });
    }
    // A policy nobody could satisfy is a Run that waits for ever, so it is
    // refused when it is written rather than discovered by an Agent at a Gate.
    // Which Human the work will be for is not known until there is a Run, but
    // that one of them will be is, so the exclusion reserves one from the
    // count. Once there is a Gate, `approvalShortfall` counts the real pool.
    const reachable = one.excludeRequester ? possible - 1 : possible;
    if (one.approvalsRequired > Math.max(reachable, 0)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `The ${one.name} Checkpoint wants ${String(one.approvalsRequired)} approvals and only ${String(Math.max(reachable, 0))} Humans could give one`,
      });
    }
  }

  const existing = await db.query.checkpoint.findMany({
    where: { projectId },
    columns: { id: true, name: true, approvalsRequired: true },
    with: { approvers: { columns: { memberId: true } } },
  });
  const named = new Set(wanted.map((one) => one.name));
  const byName = new Map(existing.map((row) => [row.name, row]));

  // A removed Checkpoint's open Gates lose their link (`ON DELETE SET NULL`)
  // and want the default's one approval, which is what a ruling on them and
  // `passLoweredGates` read too.
  const removed = existing.filter((row) => !named.has(row.name)).map((row) => row.id);
  if (removed.length > 0) {
    await db.delete(checkpointTable).where(inArray(checkpointTable.id, removed));
  }
  // Who may rule is replaced whole, like the list: cleared where it was set.
  const naming = existing
    .filter((row) => named.has(row.name) && row.approvers.length > 0)
    .map((row) => row.id);
  if (naming.length > 0) {
    await db.delete(checkpointApprover).where(inArray(checkpointApprover.checkpointId, naming));
  }

  const approvers: Array<{ checkpointId: string; memberId: string }> = [];
  const added: Array<{ id: string; name: string }> = [];
  for (const one of wanted) {
    const kept = byName.get(one.name);
    const id = kept?.id ?? newId("checkpoint");
    if (kept) {
      await db
        .update(checkpointTable)
        .set({
          approvalsRequired: one.approvalsRequired,
          excludeRequester: one.excludeRequester,
          updatedAt: new Date(),
        })
        .where(eq(checkpointTable.id, id));
    } else {
      await db.insert(checkpointTable).values({
        id,
        projectId,
        name: one.name,
        approvalsRequired: one.approvalsRequired,
        excludeRequester: one.excludeRequester,
      });
      added.push({ id, name: one.name });
    }
    for (const memberId of one.approverMemberIds) approvers.push({ checkpointId: id, memberId });
  }
  if (approvers.length > 0) await db.insert(checkpointApprover).values(approvers);

  // A Gate asked at a name nobody had configured links nothing; once the name
  // is a Checkpoint, its open Gates are measured against it, so they link it.
  for (const one of added) {
    await db
      .update(gateRequestTable)
      .set({ checkpointId: one.id })
      .where(
        and(
          eq(gateRequestTable.projectId, projectId),
          eq(gateRequestTable.checkpoint, one.name),
          eq(gateRequestTable.status, "open"),
          isNull(gateRequestTable.checkpointId),
        ),
      );
  }

  return existing.map((row) => ({ name: row.name, approvalsRequired: row.approvalsRequired }));
}

export const CheckpointPolicySchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  approvalsRequired: z.number().int(),
  excludeRequester: z.boolean(),
  approverMemberIds: z.array(z.string()),
});

export interface RulingStanding {
  /** Who is reading, and whether they are a Human at all. */
  viewerId: string;
  viewerKind: "human" | "agent";
  /** The Human this Run is for, which a four-eyes policy excludes from approving. */
  requesterId: string | null;
  /** Whether this Human has already ruled on this request. */
  hasRuled: boolean;
  status: "open" | "approved" | "rejected" | "superseded";
}

/** Why a Ruling is refused, and the error it is refused with. */
export interface RulingRefusal {
  code: "CONFLICT" | "FORBIDDEN";
  message: string;
}

/**
 * Why this Human may not make this Ruling on this Gate, or null when they may.
 *
 * The rules `recordRuling` enforces, and the words it refuses in, so a screen
 * can say what will happen before somebody clicks and the two can never drift:
 * a disabled button with a different reason than the refusal behind it is
 * worse than no reason at all.
 *
 * A rejection is refused only where any Ruling would be. An approval is also
 * refused to the Human the Run is for where the Checkpoint excludes them, who
 * may still reject: they are told they cannot also be the agreement, not
 * silenced (ADR-0020).
 */
export function rulingRefusal(
  policy: CheckpointPolicy,
  standing: RulingStanding,
  decision: "approved" | "rejected",
): RulingRefusal | null {
  if (standing.status !== "open") {
    return { code: "CONFLICT", message: `This Gate was already ${standing.status}` };
  }
  if (standing.viewerKind !== "human") {
    return { code: "FORBIDDEN", message: "Only a Human can rule on a Gate" };
  }
  if (
    policy.approverMemberIds.length > 0 &&
    !policy.approverMemberIds.includes(standing.viewerId)
  ) {
    return {
      code: "FORBIDDEN",
      message: `Only the Humans named on the ${policy.name} Checkpoint can rule on this`,
    };
  }
  if (
    decision === "approved" &&
    policy.excludeRequester &&
    standing.requesterId === standing.viewerId
  ) {
    return {
      code: "FORBIDDEN",
      message: `The ${policy.name} Checkpoint wants somebody other than the Human this Run is for to approve it; you may still reject it`,
    };
  }
  if (standing.hasRuled) {
    return { code: "CONFLICT", message: "You have already ruled on this Gate" };
  }
  return null;
}

/** An open Gate wanting more approvals than the Humans left could give it. */
export interface ApprovalShortfall {
  /** Approvals this visit still wants before it settles. */
  wanted: number;
  /** Humans who could still give one. */
  couldApprove: number;
  /** Both numbers and an admin's way out, in the words a screen shows. */
  why: string;
}

/**
 * Whether an open Gate is left short, and by how much (ADR-0020).
 *
 * `setCheckpoints` refuses a policy nobody could meet when it is saved, but
 * suspending a Member afterwards can still leave an open Gate wanting more
 * approvals than anybody left could give. The Humans who could still approve
 * this visit are the ones who may rule under its policy (`approversAmong`),
 * less the Human the work is for where it excludes them, less whoever has
 * already approved. Fewer of them than the approvals still wanted is said,
 * never guessed around: lowering the threshold on somebody's behalf would be
 * deevy deciding what the Workspace meant.
 *
 * An open Gate always wants at least one more: lowering the threshold to the
 * approvals it already has passes it there and then (`passLoweredGates`), so
 * an open Gate that already meets its count is not one a reader can see.
 * Lowering **Approvals** helps wherever there is an approval to pass it with or
 * somebody left to give one; with neither, no threshold an admin could set
 * helps, and the way out names only reinstating.
 */
export function approvalShortfall(
  policy: CheckpointPolicy,
  gate: {
    status: RulingStanding["status"];
    requesterId: string | null;
    /** The Members who approved this visit. */
    approvedBy: readonly string[];
  },
  active: ReadonlySet<string>,
): ApprovalShortfall | null {
  if (gate.status !== "open") return null;
  const approved = new Set(gate.approvedBy);
  const couldApprove = approversAmong(policy, active).filter(
    (id) => !approved.has(id) && !(policy.excludeRequester && id === gate.requesterId),
  ).length;
  const wanted = Math.max(policy.approvalsRequired - approved.size, 1);
  if (couldApprove >= wanted) return null;

  const who = couldApprove === 0 ? "nobody" : `only ${plural(couldApprove, "Human")}`;
  const lowering = approved.size > 0 || couldApprove > 0;
  const lower = lowering ? `lower Approvals on the ${policy.name} Checkpoint, or ` : "";
  return {
    wanted,
    couldApprove,
    why: `This Gate still wants ${plural(wanted, "approval")} and ${who} can still give one. An admin can ${lower}reinstate a suspended Member.`,
  };
}

/** A count and its noun, "1 approval" or "2 approvals". */
export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The Checkpoints whose Approvals a save lowered, by name, from what to what.
 *
 * Only the threshold: turning the exclusion off or naming other Humans settles
 * nothing, because what counts is the approvals a Gate already has, and a
 * Ruling that was refused was never one. A Checkpoint the save leaves out of
 * the list falls back to the default, which wants one approval, so taking off
 * a Checkpoint that wanted two lowers it too.
 */
export function loweredApprovals(
  before: ReadonlyArray<{ name: string; approvalsRequired: number }>,
  after: ReadonlyArray<{ name: string; approvalsRequired: number }>,
): Map<string, { from: number; to: number }> {
  const now = new Map(after.map((one) => [one.name, one.approvalsRequired]));
  const lowered = new Map<string, { from: number; to: number }>();
  for (const was of before) {
    const to = now.get(was.name) ?? defaultPolicy(was.name).approvalsRequired;
    if (to < was.approvalsRequired) lowered.set(was.name, { from: was.approvalsRequired, to });
  }
  return lowered;
}
