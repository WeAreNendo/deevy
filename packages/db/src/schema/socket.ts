import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
 * Removed rather than deleted: the projections and Runs under a Socket keep
 * reading after somebody disconnects it, and a row that is gone takes an Issue's
 * history with it.
 */
export const socketStatuses = ["active", "paused", "removed"] as const;

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
