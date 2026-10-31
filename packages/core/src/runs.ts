import type { Db, Run } from "@deevy/db";
import { activityKinds, run as runTable } from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

export type RunStatus = Run["status"];

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
 * Where an Activity leaves the Run. Every kind is work, so the Run runs: only
 * a Gate makes it wait (docs/plans/simplify.md, slice 5). Posting to a
 * finished Run is refused rather than silently reopening it.
 *
 * A Run that is already waiting keeps waiting, whatever is said to it. Only a
 * Ruling on its Gate un-waits one, because a Run moved back to `active` is a
 * Run the stale sweep may take, and a Gate that went stale would strand the
 * Ruling a Human was about to make (docs/plans/sockets.md). A loop may well
 * write an Activity after the session that asked for the Gate has ended.
 */
export function statusAfterActivity(current: RunStatus): RunStatus {
  if (!isOpen(current)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `This Run is ${current}; start another to carry on`,
    });
  }
  return current === "awaiting_input" ? "awaiting_input" : "active";
}

/** Only an open Run can finish, and it finishes exactly once. */
export function assertFinishable(current: RunStatus): void {
  if (!isOpen(current)) {
    throw new ORPCError("BAD_REQUEST", { message: `This Run already ${current}` });
  }
}

/**
 * How long a Run took, derived from its own row: the time before it started,
 * the time it worked, and the time it waited on a Human. A stale Run's
 * silence is working time, since nobody was waiting on a Human through it.
 */
export const TimingSchema = z.object({
  queuedMs: z.number().int(),
  workingMs: z.number().int(),
  waitingMs: z.number().int(),
});

export function timingOf(row: Run, at = Date.now()): z.infer<typeof TimingSchema> {
  const end = row.finishedAt?.getTime() ?? at;
  const created = row.createdAt.getTime();
  if (!row.startedAt) {
    return { queuedMs: Math.max(0, end - created), workingMs: 0, waitingMs: 0 };
  }
  const started = row.startedAt.getTime();
  const waitingMs =
    row.waitingMs + (row.waitingSince ? Math.max(0, end - row.waitingSince.getTime()) : 0);
  return {
    queuedMs: Math.max(0, started - created),
    workingMs: Math.max(0, end - started - waitingMs),
    waitingMs,
  };
}

export const RunSchema = z.object({
  id: z.string(),
  issueKey: z.string(),
  agentMemberId: z.string(),
  triggeredByMemberId: z.string().nullable(),
  trigger: z.enum(["assignment", "mention", "schedule", "manual", "children_done", "retry"]),
  status: z.enum(["pending", "active", "awaiting_input", "completed", "failed", "stale"]),
  summary: z.string().nullable(),
  startedAt: z.date().nullable(),
  lastActivityAt: z.date(),
  finishedAt: z.date().nullable(),
  createdAt: z.date(),
  timing: TimingSchema,
});

export const ActivitySchema = z.object({
  id: z.string(),
  runId: z.string(),
  kind: z.enum(activityKinds),
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
  // Waiting on a Human is counted as it happens: a wait that begins stamps
  // when, and one that ends — ruled on, or the Run finished while it waited —
  // adds itself to the total (docs/plans/run-usage.md).
  const begins = status === "awaiting_input" && current.status !== "awaiting_input";
  const ends = current.status === "awaiting_input" && status !== "awaiting_input";
  await db
    .update(runTable)
    .set({
      status,
      ...(begins ? { waitingSince: now } : {}),
      ...(ends
        ? {
            waitingSince: null,
            waitingMs:
              current.waitingMs +
              (current.waitingSince ? now.getTime() - current.waitingSince.getTime() : 0),
          }
        : {}),
      // The first Activity is what starts a Run working, so that is when the
      // clock starts, not when the trigger created it. A Run whose first act
      // is a Gate has started too: it is waiting, not idle.
      startedAt:
        current.startedAt ?? (status === "active" || status === "awaiting_input" ? now : null),
      ...(extra.touchActivity ? { lastActivityAt: now } : {}),
      ...(extra.summary === undefined ? {} : { summary: extra.summary }),
      finishedAt: status === "completed" || status === "failed" ? now : null,
    })
    .where(eq(runTable.id, current.id));
}
