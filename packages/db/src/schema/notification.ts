import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { event } from "./event.ts";
import { issue } from "./issue.ts";
import { member } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * What an Agent is told (docs/plans/simplify.md, slice 8): the record it was
 * assigned, a comment that mentions it, and a Ruling on the Gate it stopped
 * at. ADR-0003 says an Agent without a webhook polls its inbox over MCP, and
 * these are what it polls for.
 *
 * A Human is sent nothing: what needs them is the Gates they may rule on,
 * derived for Needs me and posted in a Project's chat channel, and the
 * tracker tells them the rest. Rows of the kinds a Human was once sent
 * (`gate_awaiting`, `run_finished`, and before those `run_awaiting_input` and
 * `delegation`) no longer read; slice 12's empty database clears them.
 */
export const notificationKinds = ["assignment", "mention", "run_answered"] as const;

export type NotificationKind = (typeof notificationKinds)[number];

/**
 * A message to an Agent derived from Events (CONTEXT.md). Derived rather than
 * stored twice, so the Event log stays the only source of what happened; this
 * table is the index that makes an Agent's inbox one query.
 */
export const notification = sqliteTable(
  "notification",
  {
    id: text("id").primaryKey(),
    recipientMemberId: text("recipient_member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: notificationKinds }).notNull(),
    /** The Event's seq, so a Notification can always be traced back to it. */
    eventId: integer("event_id")
      .notNull()
      .references(() => event.seq, { onDelete: "cascade" }),
    issueId: text("issue_id").references(() => issue.id, { onDelete: "cascade" }),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [
    index("notification_recipient_idx").on(table.recipientMemberId, table.readAt),
    index("notification_eventId_idx").on(table.eventId),
    /**
     * One inbox row per Member per kind per Event, enforced here rather than
     * respected by the one caller (docs/plans/m3.md). The kind is part of the
     * key because one Event can owe the same Human two different things.
     */
    uniqueIndex("notification_event_uidx").on(table.recipientMemberId, table.kind, table.eventId),
  ],
);
