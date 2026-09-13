import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { project, workflowState } from "./project.ts";
import { member } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * The unit of work (CONTEXT.md). The key a Human reads, `DEV-42`, is the
 * Project's key and this `number`: derived on the way out, never stored twice.
 */
export const issue = sqliteTable(
  "issue",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    /** Handed out by `UPDATE project ... RETURNING`, so it is gapless under concurrency. */
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    stateId: text("state_id")
      .notNull()
      .references(() => workflowState.id),
    stateEnteredAt: integer("state_entered_at", { mode: "timestamp_ms" }).default(now).notNull(),
    /**
     * When the approvals toward this Issue's Gate were last cleared, because a
     * Document under them changed (ADR-0021). A column rather than a question
     * for the Event log: every Issue page asks it, and D1 counts statements.
     * Null is the ordinary case — nothing has been cleared.
     */
    approvalsClearedAt: integer("approvals_cleared_at", { mode: "timestamp_ms" }),
    assigneeMemberId: text("assignee_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    parentId: text("parent_id"),
    createdBy: text("created_by").references(() => member.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(now).notNull(),
    /** Set while the Issue sits in a State whose category is `done`. */
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("issue_number_uidx").on(table.projectId, table.number),
    index("issue_projectId_stateId_idx").on(table.projectId, table.stateId),
    index("issue_assignee_idx").on(table.assigneeMemberId),
    index("issue_parentId_idx").on(table.parentId),
    /**
     * The Workspace-wide feed (`issues.list` with no Project) orders every
     * visible Project's Issues by `updated_at`; without this it sorts a scan
     * of the table on a temporary b-tree, on every Issue Event that re-runs
     * it. A `(project_id, updated_at)` pair would not help: the `IN` over
     * Projects still sorts.
     */
    index("issue_updatedAt_idx").on(table.updatedAt),
  ],
);
