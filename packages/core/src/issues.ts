import { issue as issueTable, project as projectTable, type Db, type Issue } from "@deevy/db";
import { eq, sql } from "drizzle-orm";
import { newId } from "./ids.ts";

/** `DEV-42`: the Project's key and the Issue's number, derived and never stored twice. */
export function issueKey(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}

const KEY_PATTERN = /^([A-Za-z]{2,6})-(\d+)$/;

/** Splits `DEV-42` into its Project key and number, or null when it is not a key at all. */
export function parseIssueKey(key: string): { projectKey: string; number: number } | null {
  const match = KEY_PATTERN.exec(key.trim());
  if (!match) return null;
  return { projectKey: match[1]!.toUpperCase(), number: Number(match[2]) };
}

/**
 * Hands out the next Issue number for a Project. One statement, so it is safe
 * on D1 and under concurrency without a transaction (docs/plans/m1.md); a read
 * followed by a write would hand the same number to two callers.
 */
export async function nextIssueNumber(db: Db, projectId: string): Promise<number> {
  const [row] = await db
    .update(projectTable)
    .set({ nextIssueNumber: sql`${projectTable.nextIssueNumber} + 1` })
    .where(eq(projectTable.id, projectId))
    .returning({ number: projectTable.nextIssueNumber });
  if (!row) throw new Error("nextIssueNumber: no such Project");
  return row.number - 1;
}

export interface CreateIssueInput {
  projectId: string;
  number: number;
  title: string;
  description?: string | null;
  stateId: string;
  assigneeMemberId?: string | null;
  parentId?: string | null;
  createdBy: string;
}

export async function insertIssue(db: Db, input: CreateIssueInput): Promise<Issue> {
  const [row] = await db
    .insert(issueTable)
    .values({
      id: newId("issue"),
      projectId: input.projectId,
      number: input.number,
      title: input.title,
      description: input.description ?? null,
      stateId: input.stateId,
      assigneeMemberId: input.assigneeMemberId ?? null,
      parentId: input.parentId ?? null,
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) throw new Error("insertIssue: the insert returned no row");
  return row;
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
      join workflow_state s on s.id = i.state_id
     where d.level > 0 and s.category <> 'done'
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
