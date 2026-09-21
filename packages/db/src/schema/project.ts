import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { socket } from "./socket.ts";
import { member, workspace } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** How much deevy says back in the tracker it took the work from. */
export const projectMirrors = ["off", "gates", "runs"] as const;

/**
 * A scope of work bound to Sockets (CONTEXT.md, ADR-0024): where its Issues
 * live, where its code lives, which Agent gets a record nobody named, and how
 * much deevy says back. It holds no Issues of its own and no Workflow.
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
    /** Where this Project's code lives, when an Agent working it should have a checkout. */
    forgeSocketId: text("forge_socket_id").references(() => socket.id, { onDelete: "set null" }),
    /** The repository and the base branch a Run is cut from. */
    forgeScope: text("forge_scope", { mode: "json" }).$type<Record<string, unknown>>(),
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
    mirror: text("mirror", { enum: projectMirrors }).notNull().default("gates"),
    /**
     * When deevy last asked this Project's tracker what changed. Polling is
     * what keeps an instance no tool can reach working, and this is what makes
     * one pass ask about one Project rather than all of them (work.ts).
     */
    lastPolledAt: integer("last_polled_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("project_slug_uidx").on(table.workspaceId, table.slug),
    /** One container is one Project, and the inbound route's lookup. */
    uniqueIndex("project_tracker_uidx").on(table.trackerSocketId, table.trackerScopeKey),
    index("project_workspaceId_idx").on(table.workspaceId),
    /** The poll's own scan: the Project that has gone longest without asking. */
    index("project_lastPolledAt_idx").on(table.lastPolledAt),
  ],
);
