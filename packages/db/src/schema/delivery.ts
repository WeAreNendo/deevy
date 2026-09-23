import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { event } from "./event.ts";
import { member, workspace } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Where an outbound attempt is headed: a subscriber's URL, a Slack Channel, the
 * tool a Project's records come from — deevy saying back where the work lives,
 * which is what `socket` is (ADR-0024) — or a chat tool's room (`chat`, a
 * `slack_app` Channel) or one Human's direct messages there (`chat_dm`, their
 * linked Identity), where a Gate carries its buttons (ADR-0025).
 */
export const deliveryTargets = ["webhook", "slack", "socket", "chat", "chat_dm"] as const;

/**
 * One outbound attempt, and the only record that it is owed.
 *
 * Rows are derived from the Event log as Events are appended (ADR-0003), so
 * nothing is lost when the process dies and the job queue is only ever a hint
 * that work is waiting. The payload is rendered from the Event at send time and
 * never copied here: the Event is the source, and a row that carried its own
 * copy would be a second one.
 *
 * Webhook subscriptions and Slack Channels share this table on purpose, so
 * there is one claim query, one backoff, and one bounded sweep to keep inside
 * Cloudflare Cron's budget in M3.
 */
export const delivery = sqliteTable(
  "delivery",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    target: text("target", { enum: deliveryTargets }).notNull(),
    /** The webhook_subscription or channel it is for; two tables, so no foreign key. */
    targetId: text("target_id").notNull(),
    eventSeq: integer("event_seq")
      .notNull()
      .references(() => event.seq, { onDelete: "cascade" }),
    /** The Human it is for, when the destination is a person. Null for a room. */
    recipientMemberId: text("recipient_member_id").references(() => member.id, {
      onDelete: "cascade",
    }),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }).default(now).notNull(),
    /** Held briefly by whoever is sending it, since D1 has no transactions. */
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
    /** Set once it lands. Null and out of attempts means it was given up on. */
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [
    /** The sweep's one scan: what is owed and due. Read in this order, no sort. */
    index("delivery_due_idx").on(table.deliveredAt, table.nextAttemptAt),
    index("delivery_target_idx").on(table.targetId, table.eventSeq),
    /**
     * One outbound attempt owed per destination per Event (docs/plans/m3.md).
     * The derivation is the only writer, but the invariant belongs here: a
     * derivation that runs twice — a retried request, a queue message
     * delivered again — must not owe a destination the same Event twice.
     */
    uniqueIndex("delivery_event_uidx").on(table.target, table.targetId, table.eventSeq),
  ],
);
