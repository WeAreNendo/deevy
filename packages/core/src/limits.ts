import { delivery, invitation, type Db, type deliveryTargets } from "@deevy/db";
import { and, count, desc, eq, gt, inArray, sql } from "drizzle-orm";

/**
 * What one Workspace may do in a day, when the deployment that runs it says
 * (docs/plans/hosted.md, "Beta guardrails"). Configuration an entry passes,
 * like `live`, and never a branch on which deployment this is: the image and
 * the Worker pass none and nothing is counted, while the many-Workspaces
 * Worker passes each Workspace's own, because every Workspace there sends
 * through one shared sender whose quota and reputation are everybody's.
 *
 * An absent field is no limit. Every window is the last 24 hours, rolling, so
 * there is no midnight for a burst to straddle.
 */
export interface WorkspaceLimits {
  /** Invitations its admins may create in any 24 hours; past it, `invitations.create` refuses. */
  invitationsPerDay?: number;
  /**
   * Emails the sweep may send for it in any 24 hours — what waits on a Human,
   * what a team address is routed, invitations. Past it, what is owed waits in
   * its row, neither failed nor given up, and goes as the window opens.
   */
  emailsPerDay?: number;
}

/** How far back every limit looks. */
export const limitWindowMs = 24 * 60 * 60_000;

/** The outbox's arms that mail somebody, which are what `emailsPerDay` counts. */
export const emailTargets: Array<(typeof deliveryTargets)[number]> = [
  "email_member",
  "email",
  "invitation",
];

/**
 * Whether a delivery mails somebody, put so that SQLite cannot answer it from
 * an index. `target` leads `delivery_event_uidx`, and to the planner an
 * equality there looks narrower than a window on `deliveredAt`, though it is
 * every email the Workspace ever sent; the unary plus keeps every query below
 * on `delivery_due_idx`, which reads only what landed in the window.
 */
export function mailsSomebody() {
  return inArray(sql`+${delivery.target}`, emailTargets);
}

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
 * Emails the outbox sent for the Workspace since `since`: a range on
 * `delivery_due_idx`, whose first column is `deliveredAt`.
 */
export async function emailsSince(db: Db, workspaceId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(delivery)
    .where(
      and(gt(delivery.deliveredAt, since), eq(delivery.workspaceId, workspaceId), mailsSomebody()),
    );
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

/** When the next email may go, by the same reckoning, or null when one may now. */
export async function nextEmailAt(
  db: Db,
  workspaceId: string,
  perDay: number,
  now: Date,
): Promise<Date | null> {
  const [nth] = await db
    .select({ at: delivery.deliveredAt })
    .from(delivery)
    .where(
      and(
        gt(delivery.deliveredAt, limitWindowStart(now)),
        eq(delivery.workspaceId, workspaceId),
        mailsSomebody(),
      ),
    )
    .orderBy(desc(delivery.deliveredAt))
    .limit(1)
    .offset(Math.max(0, perDay - 1));
  return nth?.at ? new Date(nth.at.getTime() + limitWindowMs) : null;
}

/** How many more emails may go now: the limit less what went in the last day. */
export async function emailRoom(
  db: Db,
  workspaceId: string,
  perDay: number,
  now: Date,
): Promise<number> {
  return Math.max(0, perDay - (await emailsSince(db, workspaceId, limitWindowStart(now))));
}
