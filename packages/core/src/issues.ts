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
  /** Set only where deevy created the record, which is delegation. */
  createdBy?: string | null;
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
    body: external.body === null ? null : external.body.slice(0, MAX_BODY),
    state: external.state,
    stateName: external.stateName,
    assignees: external.assignees,
    labels: external.labels,
    parentExternalId: external.parentExternalId,
    parentId: input.parentId ?? null,
    createdBy: input.createdBy ?? null,
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
        body: values.body,
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
 * Whether `candidate` is `issueId` itself or one of its descendants. Walked
 * upward from the candidate, so the query count is the depth of the tree
 * rather than its size.
 */
export async function isSelfOrDescendant(
  db: Db,
  issueId: string,
  candidate: string,
): Promise<boolean> {
  let at: string | null = candidate;
  const seen = new Set<string>();
  while (at) {
    if (at === issueId) return true;
    if (seen.has(at)) return false;
    seen.add(at);
    const parent: { parentId: string | null } | undefined = await db.query.issue.findFirst({
      where: { id: at },
      columns: { parentId: true },
    });
    at = parent?.parentId ?? null;
  }
  return false;
}

/** What a Workspace will not let an Agent go past when it cuts work up. */
export interface DelegationLimits {
  maxChildrenPerIssue: number;
  maxDelegationDepth: number;
  maxOpenDescendants: number;
}

/** Which ceiling a delegation hit, for the refusal and for the Event. */
export type DelegationLimitName = "children" | "depth" | "open";

export interface DelegationRefusal {
  limit: DelegationLimitName;
  allowed: number;
}

/**
 * Everything the three ceilings need, in two statements rather than nine.
 *
 * This is the only raw SQL in `packages/core`, and it earns the exception:
 * `issues.create` is the busiest write deevy has, and walking the tree a row at
 * a time put it over D1's fifty-statement cap on the deepest tree the default
 * ceilings allow (`budget.test.ts`). A recursive CTE is plain SQLite, which is
 * what both runtimes are, and the depth ceiling bounds the recursion in the
 * query itself rather than in a loop that has to remember to stop.
 *
 * Upward first — the parent's own ancestors, which gives its depth and the root
 * of its tree — then downward from that root, counting what nobody has
 * finished. Both are capped: the walk stops at the ceiling because how far past
 * a limit a tree is does not change the answer.
 */
async function treeAround(
  db: Db,
  parentId: string,
  depthLimit: number,
): Promise<{ depth: number; open: number }> {
  // `level` counts hops from the parent, so the parent itself is 0 and the last
  // row of the chain is the root. One row per ancestor, at most `depthLimit`+1.
  const chain = (await db.all(sql`
    with recursive ancestor(id, parent_id, level) as (
      select id, parent_id, 0 from issue where id = ${parentId}
      union all
      select i.id, i.parent_id, a.level + 1
        from issue i join ancestor a on i.id = a.parent_id
       where a.level < ${depthLimit + 1}
    )
    select id, level from ancestor order by level desc limit 1
  `)) as Array<{ id: string; level: number }>;
  const top = chain[0];
  const root = top?.id ?? parentId;
  const depth = top?.level ?? 0;

  // Open is the tracker's word now: an Issue is closed when the record is.
  const counted = (await db.all(sql`
    with recursive descendant(id, level) as (
      select id, 0 from issue where id = ${root}
      union all
      select i.id, d.level + 1
        from issue i join descendant d on i.parent_id = d.id
       where d.level < ${depthLimit + 1}
    )
    select count(*) as open
      from descendant d
      join issue i on i.id = d.id
     where d.level > 0 and i.state <> 'closed'
  `)) as Array<{ open: number }>;

  return { depth, open: Number(counted[0]?.open ?? 0) };
}

/**
 * Whether this Agent may put one more Issue under `parentId`, and which ceiling
 * says otherwise. The root of the tree is what the open count is measured
 * against, so a wide tree and a deep one are bounded by the same number.
 */
export async function refusesDelegation(
  db: Db,
  parentId: string,
  limits: DelegationLimits,
): Promise<DelegationRefusal | null> {
  const children = await db.query.issue.findMany({
    where: { parentId },
    columns: { id: true },
    limit: limits.maxChildrenPerIssue + 1,
  });
  if (children.length >= limits.maxChildrenPerIssue) {
    return { limit: "children", allowed: limits.maxChildrenPerIssue };
  }

  const { depth, open } = await treeAround(db, parentId, limits.maxDelegationDepth);
  // The parent's own depth plus the child about to sit under it.
  if (depth + 1 > limits.maxDelegationDepth) {
    return { limit: "depth", allowed: limits.maxDelegationDepth };
  }
  if (open >= limits.maxOpenDescendants) {
    return { limit: "open", allowed: limits.maxOpenDescendants };
  }
  return null;
}

/** What the refusal says, in the vocabulary a reader of CONTEXT.md expects. */
export function delegationRefusalMessage(refusal: DelegationRefusal, parentKey: string): string {
  if (refusal.limit === "children") {
    return `${parentKey} already has ${String(refusal.allowed)} sub-issues, which is this Workspace's limit. Finish some before opening more.`;
  }
  if (refusal.limit === "depth") {
    return `Sub-issues may go ${String(refusal.allowed)} deep in this Workspace, and ${parentKey} is already at the bottom. Work this one rather than splitting it again.`;
  }
  return `This tree already has ${String(refusal.allowed)} open sub-issues, which is this Workspace's limit. Finish some before opening more.`;
}
