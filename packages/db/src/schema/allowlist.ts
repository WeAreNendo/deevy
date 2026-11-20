import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { member, workspace } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const allowlistRuleKinds = ["email_domain"] as const;

/**
 * M1 admits teammates by rule rather than by invitation (docs/plans/m1.md): a
 * sign-in that matches any rule joins the Workspace as a Member. `kind` is an
 * enum SQLite carries no CHECK for, which is why `github_org` and
 * `gitlab_group` left it as a type change and no migration
 * (docs/plans/simplify.md, slice 10): an address's domain is the one rule.
 */
export const allowlistRule = sqliteTable(
  "allowlist_rule",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: allowlistRuleKinds }).notNull(),
    /** An email domain (`example.com`), lowercased; `AllowlistValue` in the core validates it. */
    value: text("value").notNull(),
    createdBy: text("created_by").references(() => member.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [
    uniqueIndex("allowlist_rule_uidx").on(table.workspaceId, table.kind, table.value),
    index("allowlist_rule_workspaceId_idx").on(table.workspaceId),
  ],
);
