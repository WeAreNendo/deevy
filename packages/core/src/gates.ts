import {
  gateDecision as gateDecisionTable,
  gateRequest as gateRequestTable,
  identityVerifications,
  type GateDecision,
  type GateRequest,
  type Member,
  type Run,
} from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  approvalShortfall,
  CheckpointPolicySchema,
  policyFor,
  requesterFor,
  rulingRefusal,
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
  // Only an approval asks who the Run is for: the Human a four-eyes policy
  // excludes may still reject (ADR-0020), so a rejection never needs to know.
  const requesterId =
    policy.excludeRequester && input.decision === "approved"
      ? await requesterFor(db, request.run)
      : null;
  const refusal = rulingRefusal(
    policy,
    {
      viewerId: member.id,
      viewerKind: member.kind,
      requesterId,
      hasRuled: request.decisions.some((row) => row.memberId === member.id),
      status: request.status,
    },
    input.decision,
  );
  if (refusal) throw new ORPCError(refusal.code, { message: refusal.message });

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
  const decided = await settleGate(
    source,
    request,
    {
      status,
      approvals,
      required: policy.approvalsRequired,
      via: recorded.via,
      note: recorded.note,
    },
    request.run,
  );
  return { request: decided ?? request, approvals, settled };
}

/**
 * Passes the open Gates a save of the Project's Checkpoints lowered Approvals
 * under, wherever the approvals they already have now meet it — the way each
 * would have passed had the threshold been that low when the last of those
 * approvals landed (ADR-0020's way out for a Gate left short).
 *
 * Only what was given counts: a Ruling that was refused was never recorded, so
 * turning the exclusion off in the same save adds nothing to the count. The
 * actor is the admin who saved, and the Event says the threshold was lowered,
 * so nobody's history claims a Ruling they did not make. One read of the open
 * Gates of the lowered Checkpoints, with their Rulings and Runs, whatever their
 * number; a Gate that passes then pays only for its own writes.
 */
export async function passLoweredGates(
  source: EventSource & { member: Pick<Member, "id" | "handle"> },
  projectId: string,
  lowered: ReadonlyMap<string, { from: number; to: number }>,
): Promise<number> {
  if (lowered.size === 0) return 0;
  const open = await source.db.query.gateRequest.findMany({
    where: { projectId, status: "open", checkpoint: { in: [...lowered.keys()] } },
    with: { decisions: true, run: true },
  });
  let passed = 0;
  for (const request of open) {
    const change = lowered.get(request.checkpoint);
    const approvals = request.decisions.filter((one) => one.decision === "approved").length;
    if (!change || approvals < change.to) continue;
    const decided = await settleGate(
      source,
      request,
      {
        status: "approved",
        approvals,
        required: change.to,
        // Where the admin decided it, which is deevy's own screen or its API.
        via: "web",
        note: null,
        loweredFrom: change.from,
      },
      request.run,
    );
    if (decided) passed += 1;
  }
  return passed;
}

/** How a Gate settled, as its Event says it. */
interface Settlement {
  status: "approved" | "rejected";
  approvals: number;
  required: number;
  via: GateDecision["via"];
  note: string | null;
  /** The threshold an admin lowered, where lowering it is what passed the Gate. */
  loweredFrom?: number;
}

/**
 * Ends an open Gate: its status, the Event that says how, and the Run carrying
 * on with `run.answered`.
 *
 * The one tail every way a Gate settles goes through — the Ruling that decides
 * it, and an admin lowering Approvals to what it already has — so the tracker's
 * comment, the chat messages, the webhooks and the Agent's inbox, which all
 * read those Events, hear about each the same way. Only a row still open is
 * settled, so two settling it at once settle it once, and the one that loses
 * appends nothing.
 */
async function settleGate(
  source: EventSource,
  request: GateRequest,
  settlement: Settlement,
  run?: Run | null,
): Promise<GateRequest | null> {
  const [decided] = await source.db
    .update(gateRequestTable)
    .set({ status: settlement.status, decidedAt: new Date() })
    .where(and(eq(gateRequestTable.id, request.id), eq(gateRequestTable.status, "open")))
    .returning();
  if (!decided) return null;

  await appendEvent(source, {
    kind: settlement.status === "approved" ? "gate.approved" : "gate.rejected",
    subjectType: "gate",
    subjectId: request.id,
    projectId: request.projectId,
    payload: {
      issueId: request.issueId,
      runId: request.runId,
      checkpoint: request.checkpoint,
      approvals: settlement.approvals,
      required: settlement.required,
      via: settlement.via,
      ...(settlement.note ? { note: settlement.note } : {}),
      ...(settlement.loweredFrom === undefined ? {} : { loweredFrom: settlement.loweredFrom }),
    },
  });
  await resumeGateRun(source, decided as GateRequest, settlement, run);
  return decided as GateRequest;
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
 * `run.answered` is what reaches its inbox and its webhook (ADR-0003), and
 * `gates_get` is where it reads which way it went and what the Human wrote.
 * Nothing is written in the Run's feed: that is what the Agent narrated, and
 * the Ruling is the Gate's own row (docs/plans/simplify.md, slice 5).
 */
async function resumeGateRun(
  source: EventSource,
  request: GateRequest,
  answer: Pick<Settlement, "status" | "note" | "loweredFrom">,
  known?: Run | null,
): Promise<void> {
  // Read with the Gate where the caller had it, so a page of Gates passing at
  // once is not a read of each one's Run.
  const run = known ?? (await source.db.query.run.findFirst({ where: { id: request.runId } }));
  if (!run || !isOpen(run.status)) return;

  const lowered = answer.loweredFrom === undefined ? {} : { loweredFrom: answer.loweredFrom };
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
      decision: answer.status,
      ...(answer.note ? { note: answer.note } : {}),
      ...lowered,
    },
  });
}

export const GateDecisionSchema = z.object({
  id: z.string(),
  memberId: z.string(),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().nullable(),
  via: z.enum(["web", "socket", "slack"]),
  /**
   * The tool it came through, where it came through one. A screen says "via
   * GitHub" from this rather than from the Socket list, which is an admin's
   * (ADR-0025).
   */
  socket: z.object({ id: z.string(), provider: z.string(), name: z.string() }).nullable(),
  /**
   * How deevy knew the Human behind a Ruling made outside it, or null for one
   * made in deevy. `email` is the weak one, and a screen says so wherever the
   * Ruling is shown (ADR-0025).
   */
  verifiedBy: z.enum(identityVerifications).nullable(),
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
  /**
   * Where the Human reading this stands: whether they may rule, whether they
   * already have, and why not when they may not — decided by the same rules
   * that would refuse the Ruling itself (checkpoints.ts).
   */
  you: z.object({
    /** Whether they may make a Ruling here at all: reject it, and approve it where `mayApprove` says so. */
    mayRule: z.boolean(),
    /**
     * Whether an approval from them would count. False wherever `mayRule` is,
     * and for the Human the Run is for at a Checkpoint that excludes them, who
     * may still reject.
     */
    mayApprove: z.boolean(),
    hasRuled: z.boolean(),
    /** Why they may not rule at all, or null when they may. */
    why: z.string().nullable(),
    /** Why they may not approve, or null when they may: `why`, where they may not rule at all. */
    whyNotApprove: z.string().nullable(),
  }),
  /**
   * Said while the Gate is open and the Humans who could still approve it —
   * active, named where the Checkpoint names any, not the Human the Run is for
   * where it excludes them, and not already approved — are fewer than the
   * approvals it still wants. Null otherwise. The same for every reader: it is
   * the Gate's standing, not theirs (ADR-0020).
   */
  shortfall: z
    .object({
      /** Approvals this visit still wants before it settles: at least one, while it is open. */
      wanted: z.number().int(),
      /** Humans who could still give one. */
      couldApprove: z.number().int(),
      /** Both numbers and what an admin can do, as a screen shows it where Approve is. */
      why: z.string(),
    })
    .nullable(),
});

export type GateRequestView = z.infer<typeof GateRequestSchema>;

/** What a Ruling from outside recorded about how its author was known (sockets/rulings.ts). */
function verifiedByOf(ref: unknown): (typeof identityVerifications)[number] | null {
  const said = (ref as { verifiedBy?: unknown } | null)?.verifiedBy;
  return identityVerifications.find((one) => one === said) ?? null;
}

/** A Ruling, with the tool it came through where it came through one. */
export type GateDecisionRow = GateDecision & {
  socket?: { id: string; provider: string; name: string } | null;
};

export interface GateViewInput {
  request: GateRequest;
  policy: CheckpointPolicy;
  decisions: GateDecisionRow[];
  issueKey: string;
  origin: string;
  /** Who is reading, so the view can say where they stand. */
  viewer: { id: string; kind: "human" | "agent" };
  /** The Human this Run is for, read off the Run (`requesterFor`). */
  requesterId: string | null;
  /**
   * The Workspace's active Humans (`activeHumans`), which is what says whether
   * an open Gate is left short. A Gate that is no longer open needs none.
   */
  active: ReadonlySet<string> | null;
}

export function gateView({
  request,
  policy,
  decisions,
  issueKey,
  origin,
  viewer,
  requesterId,
  active,
}: GateViewInput): GateRequestView {
  const hasRuled = decisions.some((row) => row.memberId === viewer.id);
  const standing = {
    viewerId: viewer.id,
    viewerKind: viewer.kind,
    requesterId,
    hasRuled,
    status: request.status,
  };
  // A rejection is refused only where any Ruling would be, so its refusal is
  // the answer to "may they rule at all".
  const why = rulingRefusal(policy, standing, "rejected")?.message ?? null;
  const whyNotApprove = rulingRefusal(policy, standing, "approved")?.message ?? null;
  const approvedBy = decisions
    .filter((row) => row.decision === "approved")
    .map((row) => row.memberId);
  const shortfall = active
    ? approvalShortfall(policy, { status: request.status, requesterId, approvedBy }, active)
    : null;
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
      socket: row.socket
        ? { id: row.socket.id, provider: row.socket.provider, name: row.socket.name }
        : null,
      verifiedBy: verifiedByOf(row.externalRef),
      createdAt: row.createdAt,
    })),
    approvals: approvedBy.length,
    run: { id: request.runId, issueKey },
    you: {
      mayRule: why === null,
      mayApprove: whyNotApprove === null,
      hasRuled,
      why,
      whyNotApprove,
    },
    shortfall,
  };
}
