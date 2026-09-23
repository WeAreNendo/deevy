import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { member, workspace } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * The tools deevy can be connected to. `stub` is not a tool: it is the
 * in-process provider the tests and the seed play, so every rule about inbound,
 * routing and mirroring is proved without a network (docs/plans/sockets.md).
 */
export const socketProviders = ["github", "linear", "gitlab", "notion", "slack", "stub"] as const;

/**
 * What a Socket can be asked for. A provider module implements whichever it
 * can, and a Project's binding names one Socket per capability it uses.
 */
export const socketCapabilities = ["tracker", "forge", "docs", "chat"] as const;

/**
 * `pending` is a Socket that exists before it has a credential: connecting a
 * GitHub App sends the operator to GitHub and back, and the row is what they
 * come back to (ADR-0024). `removed` rather than deleted, because the
 * projections and Runs under a Socket keep reading after somebody disconnects
 * it, and a row that is gone takes an Issue's history with it.
 */
export const socketStatuses = ["pending", "active", "paused", "removed"] as const;

/** One connected external tool under one identity (CONTEXT.md, ADR-0024). */
export const socket = sqliteTable(
  "socket",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: socketProviders }).notNull(),
    capabilities: text("capabilities", { mode: "json" })
      .$type<(typeof socketCapabilities)[number][]>()
      .notNull(),
    name: text("name").notNull(),
    /**
     * Who this Socket is on the tool's side, as `identity()` answered at
     * connect. The inbound loop guard reads it: a comment by this login is
     * deevy's own and rules nothing (ADR-0025).
     */
    identity: text("identity", { mode: "json" })
      .$type<{ login: string; id: string; mentionHandle: string }>()
      .notNull(),
    /** Everything about the connection that is not a secret: app ids, installations, an API base. */
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    /**
     * Sealed by `sealSecret` under `DEEVY_SECRET` (ADR-0024). Never in an output
     * schema: `secrets.test.ts` seeds a sentinel and greps every response for it.
     */
    credentials: text("credentials"),
    /** Sealed beside the credentials; what the provider signs its deliveries with. */
    webhookSecret: text("webhook_secret"),
    /**
     * The one it replaced, sealed, and when. A tool whose operator rotates its
     * secret in the tool's own settings — Slack's signing secret — goes on
     * signing with the old one until the new one is pasted here, and for a day
     * after, both are taken (ADR-0025).
     */
    previousWebhookSecret: text("previous_webhook_secret"),
    webhookSecretChangedAt: integer("webhook_secret_changed_at", { mode: "timestamp_ms" }),
    installedBy: text("installed_by").references(() => member.id, { onDelete: "set null" }),
    status: text("status", { enum: socketStatuses }).notNull().default("active"),
    /** When a delivery last arrived, which is what the catch-up poll reads. */
    lastInboundAt: integer("last_inbound_at", { mode: "timestamp_ms" }),
    /** Set to poll this Socket on a schedule rather than waiting to be told. */
    pollMinutes: integer("poll_minutes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [index("socket_workspaceId_status_idx").on(table.workspaceId, table.status)],
);

/**
 * What became of one delivery. `received` is the moment it was written down,
 * before deevy had decided anything; a row left in it is a crash mid-apply.
 */
export const inboundStatuses = ["received", "applied", "skipped", "failed"] as const;

/**
 * One delivery from a tool, written down before it is acted on (ADR-0024).
 *
 * The provider's own delivery id is what makes a redelivery a no-op: every
 * provider retries, GitHub has a button for it, and a record arriving twice
 * must not open two Runs. Hence the unique index rather than a status check —
 * the insert is the claim.
 *
 * It is also the only place a delivery that went wrong is recorded, because
 * the route answers 200 either way: a provider that collects failures disables
 * the hook, which is a worse outcome than deevy failing to place one record.
 */
export const inboundDelivery = sqliteTable(
  "inbound_delivery",
  {
    id: text("id").primaryKey(),
    socketId: text("socket_id")
      .notNull()
      .references(() => socket.id, { onDelete: "cascade" }),
    /** The provider's id for it: `x-github-delivery`, `Linear-Delivery`, a poll's own. */
    deliveryId: text("delivery_id").notNull(),
    /** The provider's name for what happened, which `normalize` switches on. */
    eventName: text("event_name").notNull(),
    status: text("status", { enum: inboundStatuses }).notNull().default("received"),
    /** Why it meant nothing, or what went wrong. Never a credential. */
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [
    uniqueIndex("inbound_delivery_uidx").on(table.socketId, table.deliveryId),
    /** The sweep that forgets deliveries older than a month. */
    index("inbound_delivery_createdAt_idx").on(table.createdAt),
  ],
);
