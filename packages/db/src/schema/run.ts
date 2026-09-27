import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { issue } from "./issue.ts";
import { member } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** What made deevy ask an Agent to work (PLAN.md's four triggers, plus by hand). */
export const runTriggers = [
  "assignment",
  "mention",
  "schedule",
  "manual",
  /**
   * The last sub-issue of this Issue closed, so the Agent that opened them is
   * asked to pick the work back up (docs/plans/sub-issue-delegation.md). A
   * delegating Run finishes rather than waiting, and this is how it is woken.
   */
  "children_done",
  /**
   * A Human asked for a fresh attempt after one failed or went stale: the
   * Agent's Sponsor or an admin, from the Run's page (`runs.retry`).
   */
  "retry",
] as const;

/**
 * The shape Linear and Plane converged on, so an existing agent ports with a
 * thin adapter (docs/plans/m2.md). `stale` is recoverable, never terminal.
 */
export const runStatuses = [
  "pending",
  "active",
  "awaiting_input",
  "completed",
  "failed",
  "stale",
] as const;

/** One attempt by one Agent on one Issue (CONTEXT.md). */
export const run = sqliteTable(
  "run",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issue.id, { onDelete: "cascade" }),
    agentMemberId: text("agent_member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    /** The Member that triggered it: the accountable Human is one hop away. */
    triggeredByMemberId: text("triggered_by_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    trigger: text("trigger", { enum: runTriggers }).notNull(),
    status: text("status", { enum: runStatuses }).notNull().default("pending"),
    summary: text("summary"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    /** What the stale sweep reads; set on create and by every Activity. */
    lastActivityAt: integer("last_activity_at", { mode: "timestamp_ms" }).default(now).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
    /**
     * How long the Run has waited on a Human in waits that are over, and when
     * the one it is in began (docs/plans/run-usage.md). `setRunStatus` keeps
     * both, in the update it already issues, so the feed reads a Run's time
     * off its row rather than out of the Event log.
     */
    waitingMs: integer("waiting_ms").notNull().default(0),
    waitingSince: integer("waiting_since", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("run_issueId_idx").on(table.issueId, table.createdAt),
    /**
     * The Workspace-wide feed `/runs` draws, newest first. The pair is the
     * cursor: two Runs can share a millisecond (operations/runs.ts).
     */
    index("run_createdAt_idx").on(table.createdAt, table.id),
    index("run_agent_status_idx").on(table.agentMemberId, table.status),
    /** The sweep's one indexed scan: open Runs ordered by silence. */
    index("run_status_lastActivityAt_idx").on(table.status, table.lastActivityAt),
    /**
     * At most one *open* Run per (Issue, Agent), enforced by the database
     * rather than by everybody who inserts one remembering to look first
     * (`runs.ts`). The rule was only ever true single-threaded: every path
     * reads and then inserts, and two sub-issues of one parent finishing at the
     * same moment is the ordinary ending of a fan-out, not a rare interleaving
     * (docs/plans/sub-issue-delegation.md). Partial, because a finished Run is
     * not a second attempt at anything and an Issue may have any number of them.
     */
    uniqueIndex("run_open_per_issue_agent_uidx")
      .on(table.issueId, table.agentMemberId)
      .where(sql`${table.status} in ('pending', 'active', 'awaiting_input', 'stale')`),
  ],
);

/**
 * What an Agent narrates, plus `prompt`, which only a Human writes: their
 * answer to an elicitation. Linear splits them the same way, so an agent
 * ported to deevy never confuses its own output with a Human's words
 * (docs/research/landscape-agent-aware-trackers.md).
 */
export const activityKinds = [
  "thought",
  "action",
  "elicitation",
  "response",
  "error",
  "prompt",
] as const;

/** The kinds an Agent may post. `prompt` is the Human's word, so it is not here. */
export const agentActivityKinds = [
  "thought",
  "action",
  "elicitation",
  "response",
  "error",
] as const;

/** One entry an Agent posts to its Run while working (CONTEXT.md). */
export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: activityKinds }).notNull(),
    body: text("body").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [index("activity_runId_idx").on(table.runId, table.createdAt)],
);

/** The price table a harness says it priced a model at (Claude Code's `costBasis`). */
export const usageCostBases = ["list", "managed", "unknown"] as const;

/**
 * What one session of a Run's Agent spent on one model, as the client that ran
 * it reported (docs/plans/run-usage.md). deevy never runs an Agent, so this is
 * the client's word, and deevy never prices tokens itself: a null cost is a
 * cost nobody reported, not a zero.
 *
 * A report is the client's key for one session. It replaces the rows it wrote
 * before, because a harness's totals are running totals and a retried call is
 * the same report, so `(run_id, report, model)` is unique. Money is whole
 * micro-dollars: a sum of floats drifts.
 */
export const runUsage = sqliteTable(
  "run_usage",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    report: text("report").notNull(),
    /** `claude-code`, `opencode`, `cursor`, `copilot`, or a client's own word. */
    harness: text("harness").notNull(),
    /** Null where the harness did not say which model. */
    model: text("model"),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costMicroUsd: integer("cost_micro_usd"),
    costBasis: text("cost_basis", { enum: usageCostBases }),
    reportedAt: integer("reported_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [
    index("run_usage_runId_idx").on(table.runId),
    uniqueIndex("run_usage_report_model_uidx").on(table.runId, table.report, table.model),
  ],
);
