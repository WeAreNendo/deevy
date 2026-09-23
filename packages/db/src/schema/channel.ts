import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { humanNotificationKinds } from "./notification.ts";
import { project } from "./project.ts";
import { member, workspace } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Where Notifications are delivered (CONTEXT.md). The inbox always exists.
 * `slack` is an incoming webhook: it posts a link and takes no click. `slack_app`
 * is a room in a Slack Socket's workspace, where a Gate is posted with its two
 * buttons and updated when somebody rules (ADR-0025).
 */
export const channelKinds = ["inbox", "slack", "slack_app"] as const;

export const channel = sqliteTable(
  "channel",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: channelKinds }).notNull(),
    name: text("name").notNull(),
    /** Slack's incoming-webhook URL lives here; the inbox needs nothing. */
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>(),
    createdBy: text("created_by").references(() => member.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [index("channel_workspaceId_idx").on(table.workspaceId)],
);

/**
 * A Workspace rule: this kind of Notification, for this Project, goes to this
 * Channel. A null kind or Project means "any" (PLAN.md).
 */
export const routingRule = sqliteTable(
  "routing_rule",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    notificationKind: text("notification_kind", { enum: humanNotificationKinds }),
    projectId: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [index("routing_rule_workspaceId_idx").on(table.workspaceId)],
);

/** What one Human wants to hear about, and where. Routing is rules and this together. */
export const notificationPreference = sqliteTable(
  "notification_preference",
  {
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: humanNotificationKinds }).notNull(),
    inbox: integer("inbox", { mode: "boolean" }).default(true).notNull(),
    slack: integer("slack", { mode: "boolean" }).default(true).notNull(),
    /**
     * A direct message from the Slack app, for a Human whose Slack account is
     * linked (ADR-0025). Nothing is sent to one who has not linked one, so the
     * default only matters once they have.
     */
    slackDm: integer("slack_dm", { mode: "boolean" }).default(true).notNull(),
  },
  (table) => [primaryKey({ columns: [table.memberId, table.kind] })],
);
