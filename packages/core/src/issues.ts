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
 * How far below the root an Issue sits. Walked upward and **stopped at the
 * ceiling**, because the only question anybody asks is whether the limit is
 * passed: a walk whose length is the height of the tree is a walk whose length
 * nobody bounded, and D1 counts statements (docs/plans/sub-issue-delegation.md).
 */
async function depthOf(db: Db, issueId: string, stopAt: number): Promise<number> {
  let at: string | null = issueId;
  let depth = 0;
  const seen = new Set<string>();
  while (at && depth <= stopAt) {
    if (seen.has(at)) return depth;
    seen.add(at);
    const row: { parentId: string | null } | undefined = await db.query.issue.findFirst({
      where: { id: at },
      columns: { parentId: true },
    });
    at = row?.parentId ?? null;
    if (at) depth++;
  }
  return depth;
}

/**
 * The Issues under this root that nobody has finished, counted breadth-first
 * and **stopped at the ceiling** for the same reason as above: how far past the
 * limit a tree is does not change the answer and is nobody's business.
 */
async function openUnder(db: Db, rootId: string, stopAt: number): Promise<number> {
  let frontier = [rootId];
  const seen = new Set(frontier);
  let open = 0;
  while (frontier.length > 0 && open <= stopAt) {
    const rows = await db.query.issue.findMany({
      where: { parentId: { in: frontier } },
      columns: { id: true },
      with: { state: { columns: { category: true } } },
    });
    frontier = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      frontier.push(row.id);
      if (row.state.category !== "done") open++;
    }
  }
  return open;
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

  // The parent's own depth plus the child about to sit under it.
  const depth = await depthOf(db, parentId, limits.maxDelegationDepth);
  if (depth + 1 > limits.maxDelegationDepth) {
    return { limit: "depth", allowed: limits.maxDelegationDepth };
  }

  const root = await rootOf(db, parentId, limits.maxDelegationDepth);
  const open = await openUnder(db, root, limits.maxOpenDescendants);
  if (open >= limits.maxOpenDescendants) {
    return { limit: "open", allowed: limits.maxOpenDescendants };
  }
  return null;
}

/** The top of this Issue's tree, bounded by the depth ceiling for the same reason. */
async function rootOf(db: Db, issueId: string, stopAt: number): Promise<string> {
  let at = issueId;
  const seen = new Set([at]);
  for (let step = 0; step <= stopAt; step++) {
    const row: { parentId: string | null } | undefined = await db.query.issue.findFirst({
      where: { id: at },
      columns: { parentId: true },
    });
    const parent = row?.parentId;
    if (!parent || seen.has(parent)) return at;
    seen.add(parent);
    at = parent;
  }
  return at;
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
