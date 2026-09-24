import {
  activity as activityTable,
  gateDecision as gateDecisionTable,
  gateRequest as gateRequestTable,
  type GateDecision,
  type GateRequest,
  type Member,
} from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  CheckpointPolicySchema,
  policyFor,
  requesterFor,
  type CheckpointPolicy,
} from "./checkpoints.ts";
import { appendEvent, type EventSource } from "./events.ts";
import { newId } from "./ids.ts";
import { isOpen, setRunStatus } from "./runs.ts";

/**
 * A Gate is a Run's request to pass a Checkpoint (ADR-0024, amending ADR-0020).
 *
 * One function decides every Ruling, whichever door it came through: deevy's
 * own screen, a comment on the tracker, a button in Slack. That is the whole
 * reason this module exists rather than the logic living in the operation — a
 * second door with its own copy of the arithmetic is how four-eyes quietly
 * stops being true (ADR-0025).
 *
 * **A visit is a request.** Approvals are counted on one row and a rejection
 * ends it; asking again is a new row one visit later. Nothing clears stale
 * approvals, because nothing accumulates across visits.
 */

export interface RulingInput {
  requestId: string;
  /** The Human ruling. Resolved by the caller: a session, an Identity, a Slack user. */
  memberId: string;
  decision: GateDecision["decision"];
  note?: string | null;
  via?: GateDecision["via"];
  /** The Socket a Ruling from outside arrived through (ADR-0025). */
  socketId?: string | null;
  externalRef?: Record<string, unknown> | null;
}

/** What one Ruling did: the request as it now stands, and whether it settled it. */
export interface RulingResult {
  request: GateRequest;
  approvals: number;
  settled: boolean;
}

/**
 * Records one Ruling, or refuses it. The one policy function all three doors
 * call (ADR-0025).
 */
export async function recordRuling(source: EventSource, input: RulingInput): Promise<RulingResult> {
  const { db } = source;
  const request = await db.query.gateRequest.findFirst({
    where: { id: input.requestId },
    with: { decisions: true, run: true },
  });
  if (!request) throw new ORPCError("NOT_FOUND", { message: "No such Gate" });
  if (request.status !== "open") {
    throw new ORPCError("CONFLICT", {
      message: `This Gate was already ${request.status}`,
    });
  }

  const member = await db.query.member.findFirst({ where: { id: input.memberId } });
  assertMayRule(member);
  const policy = await policyFor(db, request.projectId, request.checkpoint);
  if (policy.approverMemberIds.length > 0 && !policy.approverMemberIds.includes(member.id)) {
    throw new ORPCError("FORBIDDEN", {
      message: `Only the Humans named on the ${request.checkpoint} Checkpoint can rule on this`,
    });
  }
  if (policy.excludeRequester) {
    const requester = await requesterFor(db, request.run);
    if (requester === member.id) {
      throw new ORPCError("FORBIDDEN", {
        message: `The ${request.checkpoint} Checkpoint wants somebody other than the Human this Run is for`,
      });
    }
  }
  if (request.decisions.some((row) => row.memberId === member.id)) {
    throw new ORPCError("CONFLICT", { message: "You have already ruled on this Gate" });
  }

  const [recorded] = await db
    .insert(gateDecisionTable)
    .values({
      id: newId("gateDecision"),
      gateRequestId: request.id,
      memberId: member.id,
      decision: input.decision,
      note: input.note ?? null,
      via: input.via ?? "web",
      socketId: input.socketId ?? null,
      externalRef: input.externalRef ?? null,
    })
    // Two doors at once is the race this is about: the second loses and is
    // told what the first already said rather than counting twice.
    .onConflictDoNothing()
    .returning();
  if (!recorded)
    throw new ORPCError("CONFLICT", { message: "You have already ruled on this Gate" });

  const approvals =
    request.decisions.filter((row) => row.decision === "approved").length +
    (input.decision === "approved" ? 1 : 0);
  const settled = input.decision === "rejected" || approvals >= policy.approvalsRequired;

  if (!settled) {
    await appendEvent(source, {
      kind: "gate.approval",
      subjectType: "gate",
      subjectId: request.id,
      projectId: request.projectId,
      payload: {
        issueId: request.issueId,
        runId: request.runId,
        checkpoint: request.checkpoint,
        approvals,
        required: policy.approvalsRequired,
        via: recorded.via,
        ...(input.note ? { note: input.note } : {}),
      },
    });
    return { request, approvals, settled };
  }

  const status = input.decision === "approved" ? "approved" : "rejected";
  const [decided] = await db
    .update(gateRequestTable)
    .set({ status, decidedAt: new Date() })
    .where(eq(gateRequestTable.id, request.id))
    .returning();
  const settledRow = (decided as GateRequest | undefined) ?? request;

  await appendEvent(source, {
    kind: status === "approved" ? "gate.approved" : "gate.rejected",
    subjectType: "gate",
    subjectId: request.id,
    projectId: request.projectId,
    payload: {
      issueId: request.issueId,
      runId: request.runId,
      checkpoint: request.checkpoint,
      approvals,
      required: policy.approvalsRequired,
      via: recorded.via,
      ...(input.note ? { note: input.note } : {}),
    },
  });
  await resumeGateRun(source, settledRow, recorded, member);
  return { request: settledRow, approvals, settled };
}

/** Nobody but a Human who is still a Member may rule (ADR-0004). */
function assertMayRule(member: Member | undefined): asserts member is Member {
  if (!member) throw new ORPCError("FORBIDDEN", { message: "That is not a Member here" });
  if (member.kind !== "human") {
    throw new ORPCError("FORBIDDEN", { message: "Only a Human can rule on a Gate" });
  }
  if (member.suspendedAt) {
    throw new ORPCError("FORBIDDEN", { message: "That Member is suspended" });
  }
}

/**
 * Lets the Run carry on, and tells the Agent what was decided.
 *
 * The ruling joins the Activity feed as a response for the same reason an
 * answer does: that feed is where the Agent looks, and a decision it cannot
 * read is no decision. `run.answered` is what reaches its inbox (ADR-0003).
 */
export async function resumeGateRun(
  source: EventSource,
  request: GateRequest,
  decision: GateDecision,
  member: Member,
): Promise<void> {
  const run = await source.db.query.run.findFirst({ where: { id: request.runId } });
  if (!run || !isOpen(run.status)) return;

  const who = member.handle ? `@${member.handle}` : "A Human";
  const said = decision.note ? `: ${decision.note}` : "";
  await source.db.insert(activityTable).values({
    id: newId("activity"),
    runId: run.id,
    kind: "prompt",
    body: `${who} ${decision.decision === "approved" ? "approved" : "rejected"} the ${request.checkpoint} Checkpoint${said}`,
    payload: { gateRequestId: request.id, decision: decision.decision },
  });
  if (run.status === "awaiting_input") {
    await setRunStatus(source.db, run, "active", { touchActivity: true });
  }

  await appendEvent(source, {
    kind: "run.answered",
    subjectType: "run",
    subjectId: run.id,
    projectId: request.projectId,
    payload: {
      issueId: request.issueId,
      gateRequestId: request.id,
      checkpoint: request.checkpoint,
      decision: decision.decision,
      ...(decision.note ? { note: decision.note } : {}),
    },
  });
}

export const GateDecisionSchema = z.object({
  id: z.string(),
  memberId: z.string(),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().nullable(),
  via: z.enum(["web", "socket", "slack"]),
  createdAt: z.date(),
});

export const GateLinkSchema = z.object({ url: z.string(), title: z.string() });

/** A Gate as every surface shows one: the request, its policy, and its Rulings. */
export const GateRequestSchema = z.object({
  id: z.string(),
  runId: z.string(),
  issueId: z.string(),
  projectId: z.string(),
  checkpoint: z.string(),
  proposal: z.string(),
  links: z.array(GateLinkSchema),
  requestedBy: z.string(),
  visit: z.number().int(),
  status: z.enum(["open", "approved", "rejected", "superseded"]),
  askedAt: z.date(),
  decidedAt: z.date().nullable(),
  /** Where a Human opens it. The one link an Agent hands its client. */
  url: z.string(),
  policy: CheckpointPolicySchema,
  decisions: z.array(GateDecisionSchema),
  /** Approvals so far, which with the policy is the whole arithmetic. */
  approvals: z.number().int(),
  run: z.object({ id: z.string(), issueKey: z.string() }),
});

export type GateRequestView = z.infer<typeof GateRequestSchema>;

export interface GateViewInput {
  request: GateRequest;
  policy: CheckpointPolicy;
  decisions: GateDecision[];
  issueKey: string;
  origin: string;
}

export function gateView({
  request,
  policy,
  decisions,
  issueKey,
  origin,
}: GateViewInput): GateRequestView {
  return {
    id: request.id,
    runId: request.runId,
    issueId: request.issueId,
    projectId: request.projectId,
    checkpoint: request.checkpoint,
    proposal: request.proposal,
    links: request.links,
    requestedBy: request.requestedBy,
    visit: request.visit,
    status: request.status,
    askedAt: request.askedAt,
    decidedAt: request.decidedAt,
    url: `${origin}/gates/${request.id}`,
    policy,
    decisions: decisions.map((row) => ({
      id: row.id,
      memberId: row.memberId,
      decision: row.decision,
      note: row.note,
      via: row.via,
      createdAt: row.createdAt,
    })),
    approvals: decisions.filter((row) => row.decision === "approved").length,
    run: { id: request.runId, issueKey },
  };
}
