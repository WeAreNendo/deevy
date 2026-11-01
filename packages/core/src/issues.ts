import { issue as issueTable, type Db, type Issue } from "@deevy/db";
import { and, eq, sql } from "drizzle-orm";
import type { EventInput } from "./events.ts";
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

/**
 * The one ceiling left on sub-issues (docs/plans/simplify.md, slice 6): how
 * deep a tree may go before deevy stops handing its records to Agents. The
 * Agent opens sub-issues in the tracker, where deevy cannot refuse one, so
 * what it refuses is the Run. Answers the ceiling this record is past, or null
 * where it is within it.
 *
 * A record with no parent is at the top and costs nothing to ask about. One
 * with a parent costs the Workspace's ceiling and one walk up its ancestors,
 * which stops one past the ceiling: how far past it does not change the
 * answer, and a tree the tracker tied into a loop still ends.
 */
export async function pastDepthCeiling(
  db: Db,
  issue: { id: string; parentId: string | null },
  workspaceId: string,
): Promise<number | null> {
  if (!issue.parentId) return null;
  const found = await db.query.workspace.findFirst({
    where: { id: workspaceId },
    columns: { maxDelegationDepth: true },
  });
  if (!found) return null;
  const ceiling = found.maxDelegationDepth;
  const [walked] = (await db.all(sql`
    with recursive ancestor(id, parent_id, level) as (
      select id, parent_id, 0 from issue where id = ${issue.id}
      union all
      select i.id, i.parent_id, a.level + 1
        from issue i join ancestor a on i.id = a.parent_id
       where a.level <= ${ceiling}
    )
    select max(level) as depth from ancestor
  `)) as Array<{ depth: number | null }>;
  return Number(walked?.depth ?? 0) > ceiling ? ceiling : null;
}

/** What the log says when a record past the ceiling would have gone to `to`. */
/** Why a record past the ceiling gets no Run, as a failed Run's summary and a refused start say it. */
export function tooDeep(allowed: number): string {
  return `Sub-issues may go only ${String(allowed)} ${allowed === 1 ? "level" : "levels"} deep in this Workspace, and this record is deeper.`;
}

export function delegationRefused(
  issue: { id: string; projectId: string | null; externalKey: string },
  allowed: number,
  to: string,
): EventInput {
  return {
    kind: "delegation.refused",
    subjectType: "issue",
    subjectId: issue.id,
    projectId: issue.projectId,
    payload: { limit: "depth", allowed, to, key: issue.externalKey },
  };
}

/**
 * The record a Gate's Event is about, as its tool knows it: what an adapter
 * hearing the Event on a webhook needs to say something there, since an
 * Event's `issueId` is deevy's own and the tool has never heard of it
 * (docs/plans/simplify.md, slice 7). Every Gate Event carries it, however the
 * Gate settled. `issueSocketId` is the Socket the record is in, so an adapter
 * hearing every Gate in the Workspace says only its own tool's; a payload's
 * `socketId`, where there is one, is the Socket a Ruling came through.
 */
export function recordOf(issue: {
  socketId: string;
  externalId: string;
  externalKey: string;
  url: string;
}) {
  return {
    issueSocketId: issue.socketId,
    issueExternalId: issue.externalId,
    issueKey: issue.externalKey,
    issueUrl: issue.url,
  };
}

/** The columns `recordOf` reads, for a query that loads them beside what it was reading anyway. */
export const recordColumns = {
  socketId: true,
  externalId: true,
  externalKey: true,
  url: true,
} as const;
