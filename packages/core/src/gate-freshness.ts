import { issue as issueTable, type Db, type Issue } from "@deevy/db";
import { eq } from "drizzle-orm";
import { appendEvent, type EventSource } from "./events.ts";
import { approvalsWithNotes } from "./workflow.ts";

/**
 * A Document has just changed. If its Issue is sitting at a Gate that wants
 * more than one Human and somebody has already approved, those approvals are
 * cleared and the log says so.
 *
 * Only where a threshold is still open: a Gate of one is already through, the
 * Issue has moved on, and editing a Document afterwards is ordinary work rather
 * than a withdrawal. Nothing is deleted either way — the rulings stay in the
 * log, the version pin stays on the words that were approved, and what starts
 * again is the counting.
 */
export async function clearApprovalsIfGated(
  db: Db,
  log: Omit<EventSource, "db"> | undefined,
  issue: Pick<Issue, "id" | "stateId" | "stateEnteredAt" | "projectId" | "approvalsClearedAt">,
  documentName: string,
): Promise<void> {
  const state = await db.query.workflowState.findFirst({ where: { id: issue.stateId } });
  if (!state?.isGate || state.approvalsRequired < 2) return;

  const standing = await approvalsWithNotes(db, issue, state.id);
  const given = issue.approvalsClearedAt
    ? standing.filter((one) => one.at > issue.approvalsClearedAt!)
    : standing;
  if (given.length === 0) return;

  const at = new Date();
  await db.update(issueTable).set({ approvalsClearedAt: at }).where(eq(issueTable.id, issue.id));
  if (!log) return;
  await appendEvent(
    { db, ...log, member: null },
    {
      kind: "gate.approvals_cleared",
      subjectType: "issue",
      subjectId: issue.id,
      projectId: issue.projectId,
      payload: { state: state.name, name: documentName, cleared: given.length },
    },
  );
}
