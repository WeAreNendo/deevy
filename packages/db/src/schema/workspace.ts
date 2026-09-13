import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

// A self-hosted instance serves one Workspace (CONTEXT.md). The row is created when the
// first admin signs in (packages/core/src/auth.ts).
export const workspace = sqliteTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /**
   * What an Agent may not go past when it cuts work into sub-issues
   * (docs/plans/sub-issue-delegation.md). A machine that can start other
   * machines needs a bottom, and these are it: how many children one Issue may
   * have, how deep a tree may go, and how much of one may be open at once. They
   * bind Agents and not Humans. The defaults are deliberately small — twenty
   * children is a large decomposition and three deep is a plan, not a pyramid —
   * and an admin raises them.
   */
  maxChildrenPerIssue: integer("max_children_per_issue").default(20).notNull(),
  maxDelegationDepth: integer("max_delegation_depth").default(3).notNull(),
  maxOpenDescendants: integer("max_open_descendants").default(50).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
});

export const memberRoles = ["admin", "member"] as const;
export const memberKinds = ["human", "agent"] as const;

// Every Member is a Better Auth user (ADR-0007). An Agent carries a Sponsor (ADR-0001).
export const member = sqliteTable(
  "member",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Unique across the Workspace; slice 10 mentions a Member by it. */
    handle: text("handle"),
    role: text("role", { enum: memberRoles }).default("member").notNull(),
    kind: text("kind", { enum: memberKinds }).default("human").notNull(),
    sponsorId: text("sponsor_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
    suspendedAt: integer("suspended_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("member_userId_uidx").on(table.userId),
    uniqueIndex("member_handle_uidx").on(table.handle),
    index("member_workspaceId_idx").on(table.workspaceId),
    index("member_sponsorId_idx").on(table.sponsorId),
  ],
);
