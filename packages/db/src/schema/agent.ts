import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { project } from "./project.ts";
import { member } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * The row that says a Member is an Agent. One per Agent; a Human has none.
 */
export const agent = sqliteTable("agent", {
  memberId: text("member_id")
    .primaryKey()
    .references(() => member.id, { onDelete: "cascade" }),
  // Where deevy delivers to lives on the Agent's webhook_subscription, not
  // here: that is the row delivery reads, and a second copy is how the URL
  // came to read back as saved while nothing was ever sent (docs/plans/m2.md).
  /**
   * These two are unused since deevy dropped schedules (docs/plans/simplify.md,
   * slice 6): routing and the parent wake are what start a Run, and an Agent
   * that wants to look again on a timer keeps its own. Read by nothing;
   * dropped when the migration history starts afresh (slice 12).
   */
  scheduleMinutes: integer("schedule_minutes"),
  scheduleRanAt: integer("schedule_ran_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
});

/**
 * The Projects an Agent may see. A Human is not scoped in v1, so only Agents
 * have rows here; an ungranted Project is NOT_FOUND to the Agent (ADR-0004).
 */
export const projectGrant = sqliteTable(
  "project_grant",
  {
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    grantedBy: text("granted_by").references(() => member.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.projectId] }),
    index("project_grant_projectId_idx").on(table.projectId),
  ],
);
