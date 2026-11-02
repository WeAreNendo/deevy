import { invitation, type Db } from "@deevy/db";
import { and, count, desc, eq, gt } from "drizzle-orm";

/**
 * What one Workspace may do in a day, when the deployment that runs it says
 * (docs/plans/hosted.md, "Beta guardrails"). Configuration an entry passes,
 * like `live`, and never a branch on which deployment this is: the image
 * passes none and nothing is counted, while the many-Workspaces Worker passes
 * each Workspace's own.
 *
 * An absent field is no limit. Every window is the last 24 hours, rolling, so
 * there is no midnight for a burst to straddle. Emails were counted here too,
 * until deevy stopped sending any (docs/plans/simplify.md, slice 8).
 */
export interface WorkspaceLimits {
  /** Invitations its admins may create in any 24 hours; past it, `invitations.create` refuses. */
  invitationsPerDay?: number;
}

/** How far back every limit looks. */
export const limitWindowMs = 24 * 60 * 60_000;

/** The start of the window every limit counts from. */
export function limitWindowStart(now: Date): Date {
  return new Date(now.getTime() - limitWindowMs);
}

/** Invitations the Workspace created since `since`, revoked and accepted ones included. */
export async function invitationsSince(db: Db, workspaceId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(invitation)
    .where(and(eq(invitation.workspaceId, workspaceId), gt(invitation.createdAt, since)));
  return row?.n ?? 0;
}

/**
 * When the Workspace may next create an invitation, or null when it may now.
 * The `perDay`th newest invitation of the last day is the one that has to age
 * out of the window before there is room, so this is one statement whatever
 * the count; with none that old, there is room already. `perDay` is at least
 * one: a limit of nought has no window to open, and the caller says so.
 */
export async function nextInvitationAt(
  db: Db,
  workspaceId: string,
  perDay: number,
  now: Date,
): Promise<Date | null> {
  const [nth] = await db
    .select({ at: invitation.createdAt })
    .from(invitation)
    .where(
      and(eq(invitation.workspaceId, workspaceId), gt(invitation.createdAt, limitWindowStart(now))),
    )
    .orderBy(desc(invitation.createdAt))
    .limit(1)
    .offset(Math.max(0, perDay - 1));
  return nth ? new Date(nth.at.getTime() + limitWindowMs) : null;
}
