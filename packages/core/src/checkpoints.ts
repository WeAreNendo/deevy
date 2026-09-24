import {
  checkpoint as checkpointTable,
  checkpointApprover,
  type Checkpoint,
  type Db,
  type Run,
} from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
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
 * Who is asked to rule: the Humans the Checkpoint names, or every active Human
 * where it names nobody. The empty list has always meant "anybody" and now
 * says so in one place rather than in each reader of it.
 */
export async function gateApprovers(
  db: Db,
  workspaceId: string,
  policy: CheckpointPolicy,
): Promise<string[]> {
  if (policy.approverMemberIds.length > 0) {
    const named = await db.query.member.findMany({
      where: {
        id: { in: policy.approverMemberIds },
        workspaceId,
        kind: "human",
        suspendedAt: { isNull: true },
      },
      columns: { id: true },
    });
    return named.map((row) => row.id);
  }
  const everyone = await db.query.member.findMany({
    where: { workspaceId, kind: "human", suspendedAt: { isNull: true } },
    columns: { id: true },
  });
  return everyone.map((row) => row.id);
}

/** Replaces a Project's Checkpoints, refusing a threshold nobody could meet. */
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
): Promise<void> {
  const humans = await db.query.member.findMany({
    where: { workspaceId, kind: "human", suspendedAt: { isNull: true } },
    columns: { id: true },
  });
  const active = new Set(humans.map((row) => row.id));

  for (const one of wanted) {
    const named = one.approverMemberIds.filter((id) => active.has(id));
    if (one.approverMemberIds.length > 0 && named.length !== one.approverMemberIds.length) {
      throw new ORPCError("BAD_REQUEST", {
        message: `The ${one.name} Checkpoint names somebody who is not an active Human here`,
      });
    }
    // A policy nobody could satisfy is a Run that waits for ever, so it is
    // refused when it is written rather than discovered by an Agent at a Gate.
    const possible = one.approverMemberIds.length > 0 ? named.length : active.size;
    const reachable = one.excludeRequester ? possible - 1 : possible;
    if (one.approvalsRequired > Math.max(reachable, 0)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `The ${one.name} Checkpoint wants ${String(one.approvalsRequired)} approvals and only ${String(Math.max(reachable, 0))} Humans could give one`,
      });
    }
  }

  // Replaced rather than merged: the list is the policy, so a Checkpoint left
  // out of it is one the Project no longer has.
  await db.delete(checkpointTable).where(eq(checkpointTable.projectId, projectId));
  for (const one of wanted) {
    const id = newId("checkpoint");
    await db.insert(checkpointTable).values({
      id,
      projectId,
      name: one.name,
      approvalsRequired: one.approvalsRequired,
      excludeRequester: one.excludeRequester,
    });
    if (one.approverMemberIds.length > 0) {
      await db
        .insert(checkpointApprover)
        .values(one.approverMemberIds.map((memberId) => ({ checkpointId: id, memberId })));
    }
  }
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
  /** The Human this Run is for, which a four-eyes policy excludes. */
  requesterId: string | null;
  /** Whether this Human has already ruled on this request. */
  hasRuled: boolean;
  status: "open" | "approved" | "rejected" | "superseded";
}

/**
 * Why this Human may not rule on this Gate, or null when they may.
 *
 * The same rules `recordRuling` enforces, in the same words, so a screen can
 * say what will happen before somebody clicks and the two can never drift: a
 * disabled button with a different reason than the refusal behind it is worse
 * than no reason at all.
 */
export function rulingRefusal(policy: CheckpointPolicy, standing: RulingStanding): string | null {
  if (standing.status !== "open") return `This Gate was already ${standing.status}`;
  if (standing.viewerKind !== "human") return "Only a Human can rule on a Gate";
  if (standing.hasRuled) return "You have already ruled on this Gate";
  if (
    policy.approverMemberIds.length > 0 &&
    !policy.approverMemberIds.includes(standing.viewerId)
  ) {
    return `Only the Humans named on the ${policy.name} Checkpoint can rule on this`;
  }
  if (policy.excludeRequester && standing.requesterId === standing.viewerId) {
    return `The ${policy.name} Checkpoint wants somebody other than the Human this Run is for`;
  }
  return null;
}
