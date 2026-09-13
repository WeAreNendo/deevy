import type { Activity, Db, Run } from "@deevy/db";
import { run as runTable } from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { appendEvent, type EventSource } from "./events.ts";

export type RunStatus = Run["status"];
export type ActivityKind = Activity["kind"];

/**
 * A Run is open while the Agent may still act on it. `stale` counts: a silent
 * Agent that speaks again carries on where it left off, which is what
 * "recoverable, never terminal" means (docs/plans/m2.md).
 */
export const openStatuses = ["pending", "active", "awaiting_input", "stale"] as const;

export function isOpen(status: RunStatus): boolean {
  return (openStatuses as readonly string[]).includes(status);
}

/**
 * At most one open Run per (Issue, Agent): a second one is two attempts
 * claiming one outcome (docs/plans/m2.md). Every path that creates a Run asks
 * this first — `runs.start` refuses with CONFLICT, a trigger simply does not
 * fire — so the rule is written once and nothing double-fires.
 */
export async function openRunFor(
  db: Db,
  issueId: string,
  agentMemberId: string,
): Promise<{ id: string } | undefined> {
  return db.query.run.findFirst({
    where: { issueId, agentMemberId, status: { in: [...openStatuses] } },
    columns: { id: true },
  });
}

/**
 * Where an Activity of each kind leaves the Run. An elicitation is the Agent
 * asking a Human something, so the Run waits; everything else is work, so it
 * runs. Posting to a finished Run is refused rather than silently reopening it.
 */
export function statusAfterActivity(current: RunStatus, kind: ActivityKind): RunStatus {
  if (!isOpen(current)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `This Run is ${current}; start another to carry on`,
    });
  }
  return kind === "elicitation" ? "awaiting_input" : "active";
}

/** A Human's answer un-blocks a waiting Run, and nothing else. */
export function statusAfterAnswer(current: RunStatus): RunStatus {
  if (current !== "awaiting_input") {
    throw new ORPCError("BAD_REQUEST", { message: "This Run is not waiting for an answer" });
  }
  return "active";
}

/** Only an open Run can finish, and it finishes exactly once. */
export function assertFinishable(current: RunStatus): void {
  if (!isOpen(current)) {
    throw new ORPCError("BAD_REQUEST", { message: `This Run already ${current}` });
  }
}

export const RunSchema = z.object({
  id: z.string(),
  issueKey: z.string(),
  agentMemberId: z.string(),
  triggeredByMemberId: z.string().nullable(),
  trigger: z.enum(["assignment", "mention", "state_rule", "schedule", "manual", "children_done"]),
  status: z.enum(["pending", "active", "awaiting_input", "completed", "failed", "stale"]),
  summary: z.string().nullable(),
  startedAt: z.date().nullable(),
  lastActivityAt: z.date(),
  finishedAt: z.date().nullable(),
  createdAt: z.date(),
});

export const ActivitySchema = z.object({
  id: z.string(),
  runId: z.string(),
  kind: z.enum(["thought", "action", "elicitation", "response", "error", "prompt"]),
  body: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
});

export const RunDetailSchema = RunSchema.extend({ activities: z.array(ActivitySchema) });

/** Moves a Run and stamps the clocks that go with the move. */
export async function setRunStatus(
  db: Db,
  current: Run,
  status: RunStatus,
  extra: { summary?: string | null; touchActivity?: boolean } = {},
): Promise<void> {
  const now = new Date();
  await db
    .update(runTable)
    .set({
      status,
      // The first Activity is what starts a Run working, so that is when the
      // clock starts, not when the trigger created it. A Run whose first word
      // is a question has started too: it is waiting, not idle.
      startedAt:
        current.startedAt ?? (status === "active" || status === "awaiting_input" ? now : null),
      ...(extra.touchActivity ? { lastActivityAt: now } : {}),
      ...(extra.summary === undefined ? {} : { summary: extra.summary }),
      finishedAt: status === "completed" || status === "failed" ? now : null,
    })
    .where(eq(runTable.id, current.id));
}

/**
 * What a Run is told when it asks a Human to decide the Gate its Issue is in.
 * `awaiting` is the answer while nobody has ruled; after that it carries the
 * ruling itself, so an Agent that lost its elicitation still learns the
 * outcome by asking again (docs/plans/m2.md).
 */
/**
 * Who may rule on a Gate.
 *
 * It was an array of Member ids whose emptiness carried the rule: none named
 * meant every active Human could decide, which is what M1 shipped and what
 * `gateRecipients` still does. Nothing said so on the wire, so an Agent that
 * read `approverMemberIds: []` reported that its request had reached nobody
 * and would sit there for ever, while every Human in the Workspace had in fact
 * been notified. One field cannot carry two rules; this one says which
 * (docs/plans/m3.md).
 */
export const GateApproversSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("any_human") }),
  // Non-empty by construction: a named list with nothing in it is the state
  // that caused the confusion, and it is now unrepresentable.
  z.object({ kind: z.literal("named"), memberIds: z.array(z.string()).min(1) }),
]);

export type GateApprovers = z.infer<typeof GateApproversSchema>;

/** The rule behind a Gate's named approvers, as the answer states it. */
export function gateApproversView(memberIds: string[]): GateApprovers {
  return memberIds.length > 0 ? { kind: "named", memberIds } : { kind: "any_human" };
}

export const GateApprovalSchema = z.object({
  run: RunSchema,
  status: z.enum(["awaiting", "approved", "rejected"]),
  /** The Gate State in question, which is not where the Issue is once it is decided. */
  stateId: z.string(),
  stateName: z.string(),
  /** The Issue's page with that Gate in focus. */
  url: z.string(),
  /** Who may rule on it, said outright rather than inferred from a list's length. */
  approvers: GateApproversSchema,
  decidedByMemberId: z.string().nullable(),
  note: z.string().nullable(),
});

/** The `elicitation` Activity payload a Gate request writes, and reads back. */
export interface GateRequest {
  gateStateId: string;
  url: string;
}

export function gateRequestOf(payload: unknown): GateRequest | null {
  const found = payload as { gateStateId?: unknown; url?: unknown } | null;
  if (typeof found?.gateStateId !== "string" || typeof found.url !== "string") return null;
  return { gateStateId: found.gateStateId, url: found.url };
}

/** The Gate a Run last asked about, and whether it has since been told the answer. */
export interface AskedGate {
  request: GateRequest;
  askedAt: Date;
  /**
   * A `prompt` Activity came after it, which is how a Human's word reaches a
   * Run's feed (`runs.answer`, and the ruling `runs.requestApproval` relays).
   * An answered question is closed: the Run may ask about another Gate.
   */
  answered: boolean;
}

/**
 * The Gate this Run last asked about, or none. A Run asks by writing an
 * `elicitation` Activity and is answered by a `prompt` one, so the feed is the
 * whole record and nothing is kept twice. Bounded: only the newest few are
 * read, because an Agent that asked twenty questions ago is not still waiting
 * on the first.
 */
export async function lastGateRequest(db: Db, runId: string): Promise<AskedGate | null> {
  const rows = await db.query.activity.findMany({
    where: { runId, kind: { in: ["elicitation", "prompt"] } },
    orderBy: { createdAt: "desc" },
    limit: 20,
  });
  let answered = false;
  for (const row of rows) {
    if (row.kind === "prompt") {
      answered = true;
      continue;
    }
    const request = gateRequestOf(row.payload);
    if (request) return { request, askedAt: row.createdAt, answered };
  }
  return null;
}

/** What a Human decided at a Gate, as the `run.answered` Event carries it. */
export interface GateRuling {
  /** The Gate State ruled on. */
  stateId: string;
  state: string;
  ruling: "approved" | "rejected";
  note?: string | null;
}

/**
 * A decision on a Gate un-blocks whatever Run was waiting on it, the way a
 * Human's answer un-blocks an elicitation (docs/plans/m2.md). Called from
 * `gates.approve` and `gates.reject`: the Human decides in deevy's UI, and the
 * Agent that asked carries on without being told twice. The Event says what
 * was decided, so the inbox and the log can tell an approval from a rejection
 * without reading the Gate again; a plain answer (`runs.answer`) carries none
 * of that.
 */
export async function resumeGateRuns(
  source: EventSource & { db: Db },
  issue: { id: string; projectId: string },
  decided: GateRuling,
): Promise<void> {
  const waiting = await source.db.query.run.findMany({
    where: { issueId: issue.id, status: "awaiting_input" },
  });
  for (const row of waiting) {
    const asked = await lastGateRequest(source.db, row.id);
    if (!asked || asked.answered || asked.request.gateStateId !== decided.stateId) continue;
    await setRunStatus(source.db, row, "active", { touchActivity: true });
    await appendEvent(source, {
      kind: "run.answered",
      subjectType: "run",
      subjectId: row.id,
      projectId: issue.projectId,
      payload: {
        issueId: issue.id,
        gateStateId: decided.stateId,
        ruling: decided.ruling,
        state: decided.state,
        note: decided.note ?? null,
      },
    });
  }
}
