import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { project } from "./project.ts";
import { member, workspace } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/*
 * Every table in this file is unused since docs/plans/simplify.md, slice 8:
 * a Human's attention is the Gates they may rule on, in deevy and in the one
 * chat channel a Project binds (`project.chat_socket_id`), so there are no
 * Channels, no routing rules, no preferences and no email sender. Nothing
 * reads or writes them, and they are dropped when the migration history
 * starts afresh (slice 12), because a dropped table is what ADR-0031's guard
 * refuses. The enums below are what the columns held, for the record.
 */

/** The kinds a Human was once sent, which a rule and a preference named. */
const retiredKinds = ["mention", "assignment", "gate_awaiting", "run_finished"] as const;

/** An incoming webhook, a room in a Slack app, a team address, and the inbox. */
const channelKinds = ["inbox", "slack", "slack_app", "email"] as const;

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
    notificationKind: text("notification_kind", { enum: retiredKinds }),
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
    kind: text("kind", { enum: retiredKinds }).notNull(),
    inbox: integer("inbox", { mode: "boolean" }).default(true).notNull(),
    slack: integer("slack", { mode: "boolean" }).default(true).notNull(),
    /**
     * A direct message from the Slack app, for a Human whose Slack account is
     * linked (ADR-0025). Nothing is sent to one who has not linked one, so the
     * default only matters once they have.
     */
    slackDm: integer("slack_dm", { mode: "boolean" }).default(true).notNull(),
    /**
     * By email, at the address their sign-in verified
     * (docs/plans/email-channel.md). Null is the kind's default — on for what
     * waits on them, off for the rest — so a default that changes reaches
     * everybody who never chose.
     */
    email: integer("email", { mode: "boolean" }),
  },
  (table) => [primaryKey({ columns: [table.memberId, table.kind] })],
);

/**
 * The email sender an admin chose under Settings › Email
 * (docs/plans/email-channel.md, slice 3). One per Workspace, and it wins over
 * the environment's while it exists. `credentials` is sealed under
 * `DEEVY_SECRET` like a Socket's; `config` holds what is not secret (a region,
 * a Mailgun domain, a Postmark stream).
 */
export const emailSender = sqliteTable("email_sender", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .notNull()
    .references(() => workspace.id, { onDelete: "cascade" }),
  sender: text("sender").notNull(),
  from: text("from").notNull(),
  config: text("config", { mode: "json" }).$type<Record<string, string>>().notNull(),
  credentials: text("credentials").notNull(),
  updatedBy: text("updated_by").references(() => member.id, { onDelete: "set null" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(now).notNull(),
});
