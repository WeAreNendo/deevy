import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { socket } from "./socket.ts";
import { member, workspace } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** What `mirror` once held. The column is unused (see below). */
export const projectMirrors = ["off", "gates", "runs"] as const;

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
    /**
     * Unused since deevy stopped holding a Run's code (ADR-0034): read by
     * nothing and written as null. Dropped when the migration history starts
     * afresh (docs/plans/simplify.md, slice 12), because removing a column with
     * a foreign key is a table rebuild that D1 and a Durable Object would run
     * with foreign keys on.
     */
    forgeSocketId: text("forge_socket_id").references(() => socket.id, { onDelete: "set null" }),
    forgeScope: text("forge_scope", { mode: "json" }).$type<Record<string, unknown>>(),
    /**
     * Unused since deevy stopped reading a Project's documents
     * (docs/plans/simplify.md, slice 4): the Agent reads them where the team
     * keeps them. Dropped with the forge columns, for the same reason.
     */
    docsSocketId: text("docs_socket_id").references(() => socket.id, { onDelete: "set null" }),
    docsScope: text("docs_scope", { mode: "json" }).$type<Record<string, unknown>>(),
    /** Who gets an open record no label and no mention named. */
    defaultAgentMemberId: text("default_agent_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    /** How a record says which Agent it is for: a label prefix, a mention, or neither. */
    routing: text("routing", { mode: "json" })
      .$type<{ labelPrefix: string; mention: boolean }>()
      .notNull()
      .default(sql`'{"labelPrefix":"agent:","mention":true}'`),
    /**
     * Unused since a Socket announces a Gate and its Ruling and nothing else,
     * with no setting (docs/plans/simplify.md, slice 4), and `last_polled_at`
     * since deevy stopped asking a tool what changed. Both are read by nothing
     * and dropped when the migration history starts afresh (slice 12).
     */
    mirror: text("mirror", { enum: projectMirrors }).notNull().default("gates"),
    lastPolledAt: integer("last_polled_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("project_slug_uidx").on(table.workspaceId, table.slug),
    /** One container is one Project, and the inbound route's lookup. */
    uniqueIndex("project_tracker_uidx").on(table.trackerSocketId, table.trackerScopeKey),
    index("project_workspaceId_idx").on(table.workspaceId),
    /** What the poll scanned, kept until the clean break with its column. */
    index("project_lastPolledAt_idx").on(table.lastPolledAt),
  ],
);
