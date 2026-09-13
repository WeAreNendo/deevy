import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { event } from "./event.ts";
import { issue } from "./issue.ts";
import { member } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * The kinds a Human is sent. These are what the preference matrix offers, what
 * a Workspace routing rule may name, and what a Slack message can say.
 */
export const humanNotificationKinds = [
  "mention",
  "assignment",
  "gate_awaiting",
  /** An Agent asked its Run's Human a question, and the Run waits (docs/plans/m2.md). */
  "run_awaiting_input",
  /** A Run ended, completed or failed. */
  "run_finished",
  /**
   * An Agent this Human sponsors split work into sub-issues, or finished all of
   * them (docs/plans/sub-issue-delegation.md). One line per parent per wave
   * rather than one per sub-issue: forty of them that make an inbox useless
   * have cost more than they bought.
   */
  "delegation",
] as const;

/**
 * The kinds an Agent is sent. ADR-0003 says an Agent without a webhook polls
 * its inbox over MCP, and until `run_answered` existed the one thing it waits
 * for — a Human's ruling on the Gate it stopped at — never arrived there
 * (docs/plans/m3.md).
 */
export const agentNotificationKinds = ["run_answered"] as const;

/**
 * Every kind, which is those two audiences and nothing else.
 *
 * Derived from them rather than written a third time. Adding `run_answered` to
 * a single flat list broke two surfaces at once — the inbox page's labels and
 * the Slack headlines both key off every kind — and neither failure was
 * visible until the typechecker said so. A kind now has to be classified to
 * exist at all, and each surface takes the audience it actually serves.
 */
export const notificationKinds = [...humanNotificationKinds, ...agentNotificationKinds] as const;

export type HumanNotificationKind = (typeof humanNotificationKinds)[number];
export type AgentNotificationKind = (typeof agentNotificationKinds)[number];

/**
 * A message to a Human derived from Events (CONTEXT.md): a mention, an
 * assignment, a Gate awaiting them. Derived rather than stored twice, so the
 * Event log stays the only source of what happened; this table is the index
 * that makes "what needs me" one query.
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
