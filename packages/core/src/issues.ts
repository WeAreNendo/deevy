import { issue as issueTable, type Db, type Issue } from "@deevy/db";
import { and, eq, sql } from "drizzle-orm";
import type { ExternalIssue } from "./sockets/port.ts";
import { newId } from "./ids.ts";

/**
 * An Issue is a projection of a record in a tracker Socket (ADR-0024). It has
 * no key of deevy's own: what a Human reads is the tracker's key, and what is
 * canonical is the URL.
 */

/** How long a body snapshot may be. The record is the tracker's; this is a copy. */
export const MAX_BODY = 64 * 1024;

/** The three ways a caller may name an Issue, told apart by shape alone. */
export type IssueRef =
  | { by: "id"; id: string }
  | { by: "url"; url: string }
  | { by: "key"; key: string };

/**
 * Which of the three a string is.
 *
 * The URL is canonical because it is what a Human pastes and what a delivery
 * carries; the key is what a Human reads and may be ambiguous across two
 * Sockets, which is the caller's problem to disambiguate and this function's to
 * not hide (`resolveIssueRef` refuses rather than guessing).
 */
export function parseIssueRef(ref: string): IssueRef {
  const trimmed = ref.trim();
  if (/^iss_[0-9a-z]{12}$/.test(trimmed)) return { by: "id", id: trimmed };
  if (/^https?:\/\//i.test(trimmed)) return { by: "url", url: trimmed };
  return { by: "key", key: trimmed };
}

export interface ProjectionInput {
  projectId: string;
  socketId: string;
  external: ExternalIssue;
  /** deevy's own parent row, where the parent has been projected. */
  parentId?: string | null;
}

export interface ProjectionResult {
  issue: Issue;
  /** Whether this delivery is the first sight of the record. */
  created: boolean;
  /** False when a newer snapshot was already stored, which is a reordered delivery. */
  applied: boolean;
}

/**
 * Writes what the tracker last said, in one statement.
 *
 * The guard is the whole point: providers redeliver and reorder, so an older
 * snapshot must not overwrite a newer one. `external_updated_at` is the
 * provider's own clock and the only thing that can order two deliveries, so the
 * update is conditional on it rather than on the order they arrived in.
 */
export async function upsertProjection(db: Db, input: ProjectionInput): Promise<ProjectionResult> {
  const { external } = input;
  const closedAt = external.state === "closed" ? new Date() : null;
  const values = {
    id: newId("issue"),
    projectId: input.projectId,
    socketId: input.socketId,
    externalId: external.externalId,
    externalKey: external.key,
    url: external.url,
    title: external.title,
    body: external.body == null ? null : external.body.slice(0, MAX_BODY),
    state: external.state,
    stateName: external.stateName,
    assignees: external.assignees,
    labels: external.labels,
    parentExternalId: external.parentExternalId,
    parentId: input.parentId ?? null,
    externalUpdatedAt: external.updatedAt,
    lastSyncedAt: new Date(),
    updatedAt: new Date(),
    closedAt,
  };

  const [row] = await db
    .insert(issueTable)
    .values(values)
    .onConflictDoUpdate({
      target: [issueTable.socketId, issueTable.externalId],
      set: {
        externalKey: values.externalKey,
        url: values.url,
        title: values.title,
        // A list that did not read the content leaves the body deevy had.
        ...(external.body === undefined ? {} : { body: values.body }),
        state: values.state,
        stateName: values.stateName,
        assignees: values.assignees,
        labels: values.labels,
        parentExternalId: values.parentExternalId,
        externalUpdatedAt: values.externalUpdatedAt,
        lastSyncedAt: values.lastSyncedAt,
        updatedAt: values.updatedAt,
        // `closedAt` is reconciled with the state rather than stamped again, so
        // a record that was already closed keeps the moment it closed. Bound as
        // a number: a `Date` inside a raw fragment is not something SQLite's
        // driver will take, and the column is a `timestamp_ms` either way.
        closedAt: sql`case when ${issueTable.state} = 'closed' then ${issueTable.closedAt} else ${closedAt === null ? null : closedAt.getTime()} end`,
      },
      // The reordering guard. Equal is allowed through: a provider that stamps
      // whole seconds says nothing about two edits inside one, and the later
      // delivery is the better guess.
      setWhere: sql`${issueTable.externalUpdatedAt} <= ${external.updatedAt.getTime()}`,
    })
    .returning();

  if (row) return { issue: row, created: row.id === values.id, applied: true };

  // No row came back, so the guard refused the update: the stored snapshot is
  // newer than this delivery. Read what is there and say it was not applied.
  const stored = await db.query.issue.findFirst({
    where: { socketId: input.socketId, externalId: external.externalId },
  });
  if (!stored) throw new Error("upsertProjection: neither written nor found");
  return { issue: stored, created: false, applied: false };
}

/** Sets the Member deevy routed this Issue to, and says whether it changed. */
export async function routeIssueTo(
  db: Db,
  issueId: string,
  memberId: string | null,
): Promise<boolean> {
  const [row] = await db
    .update(issueTable)
    .set({ assigneeMemberId: memberId, updatedAt: new Date() })
    .where(
      and(
        eq(issueTable.id, issueId),
        memberId === null
          ? sql`${issueTable.assigneeMemberId} is not null`
          : sql`${issueTable.assigneeMemberId} is null or ${issueTable.assigneeMemberId} <> ${memberId}`,
      ),
    )
    .returning({ id: issueTable.id });
  return Boolean(row);
}
