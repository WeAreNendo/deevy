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
import { project } from "./project.ts";
import { run } from "./run.ts";
import { socket } from "./socket.ts";
import { member } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * A named point in a Project's policy that an Agent has to get past: `plan`,
 * `ship`, `security-review`, whatever a team calls it (CONTEXT.md).
 *
 * A Checkpoint is policy and not a place: an Issue does not enter one and
 * nothing sits in one. It says how many distinct Humans a request to pass it
 * wants, whether the Human behind the work may be one of them (ADR-0020), and
 * which Humans may rule at all. A name no Checkpoint row covers gets the
 * default — one approval, from anybody — so an Agent asking about something
 * nobody configured is answered rather than stranded.
 */
export const checkpoint = sqliteTable(
  "checkpoint",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    approvalsRequired: integer("approvals_required").notNull().default(1),
    /** Four eyes: the Human behind the Run may not be one of the approvals. */
    excludeRequester: integer("exclude_requester", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [uniqueIndex("checkpoint_uidx").on(table.projectId, table.name)],
);

/**
 * Who may rule at this Checkpoint. No rows means every active Human, which is
 * the rule a Workspace starts with; naming anybody narrows it to them.
 */
export const checkpointApprover = sqliteTable(
  "checkpoint_approver",
  {
    checkpointId: text("checkpoint_id")
      .notNull()
      .references(() => checkpoint.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.checkpointId, table.memberId] })],
);

export const gateStatuses = ["open", "approved", "rejected", "superseded"] as const;

/**
 * A Run's request to pass a Checkpoint: the Agent's Proposal, its links, and
 * what was ruled on it (CONTEXT.md, ADR-0024).
 *
 * **A visit is a request.** Approvals are counted on one row; a rejection ends
 * it and nothing on it counts again; asking again is a new row one visit later.
 * That is what makes four-eyes true by construction rather than by a sweep that
 * clears stale approvals, and it is why the Proposal is immutable here: a
 * changed Proposal is a different question, so it supersedes rather than edits.
 */
export const gateRequest = sqliteTable(
  "gate_request",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    issueId: text("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    /** The Checkpoint's name as the Agent asked for it, kept even if the policy is deleted. */
    checkpoint: text("checkpoint").notNull(),
    checkpointId: text("checkpoint_id").references(() => checkpoint.id, { onDelete: "set null" }),
    /** Markdown: what the Agent intends to do, or has done. What a Human rules on. */
    proposal: text("proposal").notNull(),
    links: text("links", { mode: "json" })
      .$type<{ url: string; title: string }[]>()
      .notNull()
      .default(sql`'[]'`),
    /** The Agent that asked. The Human behind it is read off the Run (gates.ts). */
    requestedBy: text("requested_by")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    /** How many times this Run has asked about this Checkpoint, this one included. */
    visit: integer("visit").notNull().default(1),
    status: text("status", { enum: gateStatuses }).notNull().default("open"),
    askedAt: integer("asked_at", { mode: "timestamp_ms" }).default(now).notNull(),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    /**
     * One open question per Run per Checkpoint. Partial, because every visit
     * before this one is still a row and a Run may ask many times.
     */
    uniqueIndex("gate_request_open_uidx")
      .on(table.runId, table.checkpoint)
      .where(sql`${table.status} = 'open'`),
    index("gate_request_issue_idx").on(table.issueId),
    index("gate_request_status_idx").on(table.projectId, table.status),
  ],
);

export const gateDecisions = ["approved", "rejected"] as const;

/** Which door a Ruling came through (ADR-0025). */
export const rulingVias = ["web", "socket", "slack"] as const;

/**
 * One Human's decision on one request, with where they made it.
 *
 * `via` is the column ADR-0025 turns on: a Ruling made on the tracker or in
 * Slack is accepted only because the external system authenticated the Human,
 * and an audit that cannot say which door a decision came through cannot
 * answer for it. One row per Human per request, so nobody counts twice.
 */
export const gateDecision = sqliteTable(
  "gate_decision",
  {
    id: text("id").primaryKey(),
    gateRequestId: text("gate_request_id")
      .notNull()
      .references(() => gateRequest.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    decision: text("decision", { enum: gateDecisions }).notNull(),
    note: text("note"),
    via: text("via", { enum: rulingVias }).notNull().default("web"),
    /** The Socket a Ruling from outside arrived through, for the audit. */
    socketId: text("socket_id").references(() => socket.id, { onDelete: "set null" }),
    /** What it pointed at there: a comment id, a Slack channel and timestamp. */
    externalRef: text("external_ref", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [uniqueIndex("gate_decision_uidx").on(table.gateRequestId, table.memberId)],
);

/** What a mirrored thing is: a comment on the record, a label on it, a message in a room. */
export const socketMirrorKinds = ["comment", "label", "message"] as const;

/**
 * What deevy posted where (ADR-0024).
 *
 * Mirroring is one-way until somebody rules: then the comment deevy wrote
 * about a Gate is out of date, and the Slack message still has buttons on it.
 * This is the note of where those are, so a Ruling from any door can go back
 * and change what it finds.
 */
export const socketMirror = sqliteTable(
  "socket_mirror",
  {
    id: text("id").primaryKey(),
    gateRequestId: text("gate_request_id").references(() => gateRequest.id, {
      onDelete: "cascade",
    }),
    socketId: text("socket_id")
      .notNull()
      .references(() => socket.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: socketMirrorKinds }).notNull(),
    /** Where it landed, in the provider's own words: a comment id, a channel and timestamp. */
    externalRef: text("external_ref", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [index("socket_mirror_gate_idx").on(table.gateRequestId)],
);
