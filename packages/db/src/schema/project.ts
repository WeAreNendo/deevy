import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { socket } from "./socket.ts";
import { member, workspace } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * A scope of work bound to a Socket (CONTEXT.md, ADR-0024): where its Issues
 * live, which Agent gets a record nobody named, and how a record names an
 * Agent. It holds no Issues of its own and no Workflow.
 */
export const project = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** The URL handle, derived from the container it is bound to: `acme-deevy`, `eng`. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Where this Project's Issues come from. A Project without one has nothing to work. */
    trackerSocketId: text("tracker_socket_id")
      .notNull()
      .references(() => socket.id, { onDelete: "restrict" }),
    /** Which container inside that Socket: a repository, a Linear team, a Notion database. */
    trackerScope: text("tracker_scope", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    /**
     * `scopeKeyOf(scope)` stored, so an inbound delivery finds its Project in
     * one indexed read rather than by comparing JSON.
     */
    trackerScopeKey: text("tracker_scope_key").notNull(),
    /** Who gets an open record no label and no mention named. */
    defaultAgentMemberId: text("default_agent_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    /**
     * The chat channel this Project's Gates are posted in, each with Approve and
     * Reject and changed as Rulings land (docs/plans/simplify.md, slice 8): a
     * chat Socket, and the channel's own id there (`C0123ABCD` in Slack). Both
     * or neither; a Socket removed takes the binding with it.
     */
    chatSocketId: text("chat_socket_id").references(() => socket.id, { onDelete: "set null" }),
    chatChannel: text("chat_channel"),
    /** How a record says which Agent it is for: a label prefix, a mention, or neither. */
    routing: text("routing", { mode: "json" })
      .$type<{ labelPrefix: string; mention: boolean }>()
      .notNull()
      .default(sql`'{"labelPrefix":"agent:","mention":true}'`),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("project_slug_uidx").on(table.workspaceId, table.slug),
    /** One container is one Project, and the inbound route's lookup. */
    uniqueIndex("project_tracker_uidx").on(table.trackerSocketId, table.trackerScopeKey),
    index("project_workspaceId_idx").on(table.workspaceId),
  ],
);
