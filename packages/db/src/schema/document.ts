import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { issue } from "./issue.ts";
import { member } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * A named, versioned markdown text on an Issue, such as its intent, spec or
 * plan (CONTEXT.md). The template comes from the State that asks for it.
 */
export const document = sqliteTable(
  "document",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    /** `intent`, `spec`, `plan`: the name the Workflow State asked for. */
    name: text("name").notNull(),
    currentVersion: integer("current_version").default(1).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [uniqueIndex("document_name_uidx").on(table.issueId, table.name)],
);

/**
 * What a room currently holds, between versions (ADR-0021). The Yjs state is
 * the live truth while Members are typing; markdown is what every version is
 * made of. Scratch, in the sense that losing a row costs the words typed since
 * the last version and nothing else: a room with no row opens from that
 * version's markdown.
 *
 * Keyed by the room rather than by a Document, because an Issue's description
 * is a room too and has no Document row. `base64` rather than a blob: the two
 * runtimes hand binary back differently — a Buffer on node:sqlite, an
 * ArrayBuffer on D1 — and a schema that is read by both should not have to know
 * which. A third longer on disk, for one representation instead of two.
 */
export const roomState = sqliteTable(
  "room_state",
  {
    /** `document:<documentId>` or `description:<issueId>`: ids, so renaming a Project moves nothing. */
    room: text("room").primaryKey().notNull(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    /** Null for an Issue's description, which is not a Document. */
    documentId: text("document_id").references(() => document.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [index("room_state_issueId_idx").on(table.issueId)],
);

/** Writes are append-only: a new version, never an overwrite. */
export const documentVersion = sqliteTable(
  "document_version",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    authorMemberId: text("author_member_id").references(() => member.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [
    uniqueIndex("document_version_uidx").on(table.documentId, table.version),
    index("document_version_documentId_idx").on(table.documentId),
  ],
);

/**
 * Everybody whose keystrokes are in a version. A version cut from a room is
 * written by whoever was typing in it, which is regularly more than one Member
 * (ADR-0021) — `authorMemberId` above stays as the one who cut it, and this is
 * who it belongs to. The Activity reads from here: "Ada and Planner wrote spec
 * v4".
 */
export const documentVersionAuthor = sqliteTable(
  "document_version_author",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => documentVersion.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.memberId] }),
    index("document_version_author_memberId_idx").on(table.memberId),
  ],
);
