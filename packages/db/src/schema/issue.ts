import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { project } from "./project.ts";
import { socket } from "./socket.ts";
import { member } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** What a tracker says about a record, flattened to the two answers everything asks. */
export const issueStates = ["open", "closed"] as const;

/**
 * The unit of work: a projection of a record in a tracker Socket (CONTEXT.md,
 * ADR-0024). deevy authors none of it. The columns below are what the tracker
 * last said, and `externalUpdatedAt` is the clock that decides whether a
 * delivery arriving out of order may overwrite them.
 */
export const issue = sqliteTable(
  "issue",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    /**
     * Beside the Project's, because the inbound upsert knows the Socket and the
     * external id before it has looked a Project up, and the uniqueness that
     * makes a delivery idempotent is on this pair.
     */
    socketId: text("socket_id")
      .notNull()
      .references(() => socket.id, { onDelete: "cascade" }),
    /** The provider's own stable id: a GitHub node id, a Linear issue id, a Notion page id. */
    externalId: text("external_id").notNull(),
    /** What a Human reads and types: `acme/deevy#42`, `ENG-12`. The tracker's handle, not deevy's. */
    externalKey: text("external_key").notNull(),
    /** Canonical. It is what a Human pastes and what a delivery carries. */
    url: text("url").notNull(),
    title: text("title").notNull(),
    /** A snapshot, capped on the way in. The record is the tracker's; this is what it last said. */
    body: text("body"),
    state: text("state", { enum: issueStates }).notNull(),
    /** The provider's own word for the state: `open`, `Done`, `In Review`. */
    stateName: text("state_name").notNull(),
    /** Who the tracker says is on it, which is a fact deevy mirrors and never writes. */
    assignees: text("assignees", { mode: "json" })
      .$type<{ login: string; id: string }[]>()
      .notNull()
      .default(sql`'[]'`),
    labels: text("labels", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    /**
     * The Member deevy routed this to, by label, by mention, or by the
     * Project's default (CONTEXT.md). Not the tracker's assignee, which is in
     * `assignees`.
     */
    assigneeMemberId: text("assignee_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    parentExternalId: text("parent_external_id"),
    /**
     * deevy's own parent link, resolved from `parentExternalId` when the parent
     * has been projected. Kept even where the tracker could not link the two,
     * which is how a tree survives a provider without sub-issues.
     */
    parentId: text("parent_id"),
    /** Set only where deevy created the record, which is delegation. */
    createdBy: text("created_by").references(() => member.id, { onDelete: "set null" }),
    /** The provider's clock. The upsert refuses to go backwards on it. */
    externalUpdatedAt: integer("external_updated_at", { mode: "timestamp_ms" }).notNull(),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }).default(now).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(now).notNull(),
    /** Reconciled with `state` on every sync, so "open" stays one question. */
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    /** What makes one delivery one row, and the index the inbound upsert reads. */
    uniqueIndex("issue_external_uidx").on(table.socketId, table.externalId),
    /** How a Human's paste and an Agent's `issueKey` are resolved (`resolveIssueRef`). */
    index("issue_externalKey_idx").on(table.externalKey),
    index("issue_url_idx").on(table.url),
    index("issue_projectId_state_idx").on(table.projectId, table.state),
    index("issue_assignee_idx").on(table.assigneeMemberId),
    index("issue_parentId_idx").on(table.parentId),
    /**
     * The Workspace-wide feed orders every visible Project's Issues by
     * `updated_at`; without this it sorts a scan of the table on a temporary
     * b-tree, on every Issue Event that re-runs it.
     */
    index("issue_updatedAt_idx").on(table.updatedAt),
  ],
);
