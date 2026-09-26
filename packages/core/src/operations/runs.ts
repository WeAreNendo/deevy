import { and, asc, desc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  activity as activityTable,
  agentActivityKinds,
  run as runTable,
  runStatuses,
  runUsage as runUsageTable,
} from "@deevy/db";
import { issue as issueTable, member as memberTable, project as projectTable } from "@deevy/db";
import { alias } from "drizzle-orm/sqlite-core";
import { ORPCError } from "@orpc/server";
import { appendEvent } from "../events.ts";
import {
  ActivitySchema,
  RunDetailSchema,
  RunSchema,
  assertFinishable,
  openStatuses,
  setRunStatus,
  statusAfterActivity,
  statusAfterAnswer,
} from "../runs.ts";
import { defineOperation } from "./registry.ts";
import {
  MAX_REPORTS_PER_RUN,
  REPORT_GRACE_MS,
  ReportUsageInput,
  UsageDetailSchema,
  UsageSchema,
  noUsage,
  toMicroUsd,
  usageDetailOf,
  usageOf,
} from "../usage.ts";
import type { Activity, Run } from "@deevy/db";
import {
  assertOwnRun,
  parseRunCursor,
  QueryFlag,
  resolveIssueRef,
  forgeBindingOf,
  requireRun,
  requireSponsoredAgent,
  runView,
} from "./shared.ts";
import { branchFor } from "../forge.ts";
import { requireForge, requireSocket, socketModuleFor } from "../sockets/registry.ts";

/** The Agent working a Run, joined so "mine" can ask who sponsors it. */
const agentMember = alias(memberTable, "agent_member");
import { newId } from "../ids.ts";

export const runs = {
  start: defineOperation({
    name: "runs.start",
    summary: "Begin a Run on an Issue, pending until the Agent posts its first Activity",
    method: "POST",
    path: "/issues/{issue}/runs",
    auth: "member",
    agents: true,
    agentsOnly: true,
    mcp: true,
    input: z.object({
      /** An `iss_` id, the record's URL, or the key the tracker wrote. */
      issue: z.string().trim().min(1),
    }),
    output: RunSchema,
    handler: async ({ input, context }) => {
      const { issue, project } = await resolveIssueRef(context, input.issue);
      // An Agent runs as itself, and the registry has already refused a Human
      // (ADR-0016): a Human who wants an Agent to work assigns it the Issue.
      // One attempt at a time: a second open Run on the same Issue by the same
      // Agent is two attempts claiming one outcome (docs/plans/m2.md).
      const already = await context.db.query.run.findFirst({
        where: {
          issueId: issue.id,
          agentMemberId: context.member.id,
          status: { in: [...openStatuses] },
        },
        columns: { id: true },
      });
      if (already) {
        throw new ORPCError("CONFLICT", {
          message: "This Agent already has an open Run on this Issue",
        });
      }
      const id = newId("run");
      // The read above normally answers this, but two calls that read before
      // either inserted would both pass it. The partial unique index is what
      // actually holds the rule, and losing to it is the same refusal rather
      // than a constraint error reaching the caller.
      const [inserted] = await context.db
        .insert(runTable)
        .values({
          id,
          issueId: issue.id,
          agentMemberId: context.member.id,
          triggeredByMemberId: context.member.id,
          trigger: "manual",
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        throw new ORPCError("CONFLICT", {
          message: "This Agent already has an open Run on this Issue",
        });
      }
      const row = inserted as Run;
      await appendEvent(context, {
        kind: "run.started",
        subjectType: "run",
        subjectId: id,
        projectId: project.id,
        payload: { issueId: issue.id, trigger: row.trigger, agentMemberId: context.member.id },
      });
      return runView(row, issue.externalKey);
    },
  }),

  retry: defineOperation({
    name: "runs.retry",
    summary: "Try a failed or stale Run again: a fresh Run for the same Agent on the same record",
    method: "POST",
    path: "/runs/{runId}/retry",
    // A Human's call, the Agent's Sponsor's or an admin's: an Agent starts its
    // own with `runs.start`, and a Run it gave up on is somebody else's to
    // send it back to.
    auth: "member",
    input: z.object({ runId: z.string() }),
    output: RunSchema,
    handler: async ({ input, context }) => {
      const { run, issue, project, key } = await requireRun(context, input.runId);
      await requireSponsoredAgent(context, run.agentMemberId);
      if (run.status !== "failed" && run.status !== "stale") {
        throw new ORPCError("BAD_REQUEST", {
          message: `This Run is ${run.status}; only a failed or stale Run is tried again`,
        });
      }

      // A stale Run still counts as open, and one record has one open Run per
      // Agent, so the old attempt is closed before the new one opens — as a
      // failure, which is what an attempt nobody could get an answer from is.
      if (run.status === "stale") {
        const summary = `Tried again by ${context.session.user.name ?? "a Human"}`;
        await setRunStatus(context.db, run, "failed", { summary });
        await appendEvent(context, {
          kind: "run.failed",
          subjectType: "run",
          subjectId: run.id,
          projectId: project.id,
          payload: { issueId: issue.id, summary },
        });
      }

      const [inserted] = await context.db
        .insert(runTable)
        .values({
          id: newId("run"),
          issueId: issue.id,
          agentMemberId: run.agentMemberId,
          triggeredByMemberId: context.member.id,
          trigger: "retry",
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        throw new ORPCError("CONFLICT", {
          message: "This Agent already has an open Run on this record",
        });
      }
      const row = inserted as Run;
      await appendEvent(context, {
        kind: "run.started",
        subjectType: "run",
        subjectId: row.id,
        projectId: project.id,
        payload: {
          issueId: issue.id,
          trigger: row.trigger,
          agentMemberId: row.agentMemberId,
          retryOf: run.id,
        },
      });
      return runView(row, key);
    },
  }),

  postActivity: defineOperation({
    name: "runs.postActivity",
    summary: "Post one Activity to your Run: a thought, an action, an elicitation, or an error",
    method: "POST",
    path: "/runs/{runId}/activities",
    auth: "member",
    agents: true,
    agentsOnly: true,
    mcp: true,
    input: z.object({
      runId: z.string(),
      kind: z.enum(agentActivityKinds),
      body: z.string().min(1).max(20_000),
      payload: z.record(z.string(), z.unknown()).nullish(),
    }),
    output: z.object({ run: RunSchema, activity: ActivitySchema }),
    handler: async ({ input, context }) => {
      const { run, issue, project, key } = await requireRun(context, input.runId);
      assertOwnRun(context, run);
      const status = statusAfterActivity(run.status, input.kind);

      const id = newId("activity");
      await context.db.insert(activityTable).values({
        id,
        runId: run.id,
        kind: input.kind,
        body: input.body,
        payload: input.payload ?? null,
      });
      await setRunStatus(context.db, run, status, { touchActivity: true });

      await appendEvent(context, {
        kind: "run.activity",
        subjectType: "run",
        subjectId: run.id,
        projectId: project.id,
        payload: { issueId: issue.id, activityId: id, activityKind: input.kind },
      });
      // An elicitation is the Agent asking a Human something, so it is its own
      // Event: that is what a Notification and the live feed hang off. Only
      // where it begins the wait — something said to a Run that is already
      // waiting is not a second question, and a second Notification about one
      // Gate is a Human told twice (apps/agent/src/work.ts).
      if (status === "awaiting_input" && run.status !== "awaiting_input") {
        await appendEvent(context, {
          kind: "run.awaiting_input",
          subjectType: "run",
          subjectId: run.id,
          projectId: project.id,
          payload: { issueId: issue.id, activityId: id, question: input.body },
        });
      }

      const updated = (await context.db.query.run.findFirst({ where: { id: run.id } })) as Run;
      const row = await context.db.query.activity.findFirst({ where: { id } });
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return { run: runView(updated, key), activity: row };
    },
  }),

  answer: defineOperation({
    name: "runs.answer",
    summary: "Answer a Run's elicitation, so the Agent carries on",
    method: "POST",
    path: "/runs/{runId}/answer",
    auth: "member",
    mcp: true,
    input: z.object({ runId: z.string(), body: z.string().min(1).max(20_000) }),
    output: z.object({ run: RunSchema, activity: ActivitySchema }),
    handler: async ({ input, context }) => {
      // No `agents: true`: an elicitation asks a Human, and the registry
      // refuses an Agent this operation without a check of its own. It is a
      // tool all the same, because the Human's own MCP client is one place
      // they read the question (ADR-0016).
      const { run, issue, project, key } = await requireRun(context, input.runId);
      const status = statusAfterAnswer(run.status);

      // The answer joins the Activity feed as a `response`, because that feed
      // is where the Agent looks: an answer it cannot read is no answer.
      const id = newId("activity");
      await context.db.insert(activityTable).values({
        id,
        runId: run.id,
        kind: "prompt",
        body: input.body,
      });
      await setRunStatus(context.db, run, status, { touchActivity: true });

      await appendEvent(context, {
        kind: "run.answered",
        subjectType: "run",
        subjectId: run.id,
        projectId: project.id,
        payload: { issueId: issue.id, activityId: id },
      });

      const updated = (await context.db.query.run.findFirst({ where: { id: run.id } })) as Run;
      const row = await context.db.query.activity.findFirst({ where: { id } });
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return { run: runView(updated, key), activity: row };
    },
  }),

  checkout: defineOperation({
    name: "runs.checkout",
    summary: "The repository, the branch to cut, and a credential to clone with",
    method: "POST",
    path: "/runs/{runId}/checkout",
    auth: "member",
    agents: true,
    agentsOnly: true,
    // Deliberately not a tool. It answers with a credential, and a credential
    // in a model's context is a credential in a transcript (ADR-0014); the
    // supervisor calls this over HTTP and keeps the token to itself. The
    // runtime's own allowlist is the second fence.
    input: z.object({ runId: z.string() }),
    /**
     * Null where the Project is bound to no repository, which is an ordinary
     * Project rather than a mistake: the supervisor asks this of every Run it
     * takes up, and a refusal would put a 404 in an operator's log every pass
     * (apps/agent/src/work.ts).
     */
    output: z
      .object({
        cloneUrl: z.string(),
        /** What to clone from, and what to push back to. */
        baseBranch: z.string(),
        /** The branch this Run works on. deevy names it so nobody invents one. */
        headBranch: z.string(),
        /** The user the token goes with, where the provider wants one. */
        username: z.string(),
        token: z.string(),
        /** When it dies. A Run resumed after a Gate asks again (ADR-0019). */
        expiresAt: z.date().nullable(),
      })
      .nullable(),
    handler: async ({ input, context }) => {
      const { run, project, key } = await requireRun(context, input.runId);
      assertOwnRun(context, run);
      const binding = forgeBindingOf(project);
      if (!binding) return null;

      const socket = await requireSocket(context, binding.socketId);
      const forge = requireForge(await socketModuleFor(context, socket));
      const credential = await forge.credential(binding.scope);

      const headBranch = branchFor(key, run.id);
      // The log says a credential was issued, and never what it was.
      await appendEvent(context, {
        kind: "run.checkout_issued",
        subjectType: "run",
        subjectId: run.id,
        projectId: project.id,
        payload: {
          issueId: run.issueId,
          cloneUrl: credential.cloneUrl,
          baseBranch: binding.baseBranch,
          headBranch,
        },
      });

      return {
        cloneUrl: credential.cloneUrl,
        baseBranch: binding.baseBranch,
        headBranch,
        username: credential.username,
        token: credential.secret,
        expiresAt: credential.expiresAt,
      };
    },
  }),

  finish: defineOperation({
    name: "runs.finish",
    summary: "End your Run, completed or failed, with a summary of what happened",
    method: "POST",
    path: "/runs/{runId}/finish",
    auth: "member",
    agents: true,
    agentsOnly: true,
    mcp: true,
    input: z.object({
      runId: z.string(),
      status: z.enum(["completed", "failed"]),
      summary: z.string().min(1).max(10_000),
    }),
    output: RunSchema,
    handler: async ({ input, context }) => {
      const { run, issue, project, key } = await requireRun(context, input.runId);
      assertOwnRun(context, run);
      assertFinishable(run.status);

      await setRunStatus(context.db, run, input.status, { summary: input.summary });
      await appendEvent(context, {
        kind: input.status === "completed" ? "run.completed" : "run.failed",
        subjectType: "run",
        subjectId: run.id,
        projectId: project.id,
        payload: { issueId: issue.id, summary: input.summary },
      });

      const updated = (await context.db.query.run.findFirst({ where: { id: run.id } })) as Run;
      return runView(updated, key);
    },
  }),

  reportUsage: defineOperation({
    name: "runs.reportUsage",
    summary:
      "Report what one session of your Run spent: tokens by model, and the cost where your harness priced them",
    method: "POST",
    path: "/runs/{runId}/usage",
    auth: "member",
    agents: true,
    agentsOnly: true,
    mcp: true,
    input: ReportUsageInput,
    output: UsageSchema,
    handler: async ({ input, context }) => {
      const { run, issue, project } = await requireRun(context, input.runId);
      assertOwnRun(context, run);
      // The session that finishes a Run reports after it did, so a finished
      // Run still takes reports for a while; after that its usage is closed,
      // and a report is a mistake or somebody else's (docs/plans/run-usage.md).
      if (run.finishedAt && Date.now() - run.finishedAt.getTime() > REPORT_GRACE_MS) {
        throw new ORPCError("CONFLICT", {
          message: "This Run finished more than a day ago; its usage is closed",
        });
      }
      const [others] = await context.db
        .select({ count: sql<number>`count(distinct ${runUsageTable.report})` })
        .from(runUsageTable)
        .where(
          and(eq(runUsageTable.runId, run.id), sql`${runUsageTable.report} <> ${input.report}`),
        );
      if ((others?.count ?? 0) >= MAX_REPORTS_PER_RUN) {
        throw new ORPCError("BAD_REQUEST", {
          message: `A Run takes at most ${String(MAX_REPORTS_PER_RUN)} usage reports`,
        });
      }

      // A report replaces what it said before: a harness's totals run on, and
      // a retried call is the same session, so the latest is the truth.
      await context.db
        .delete(runUsageTable)
        .where(and(eq(runUsageTable.runId, run.id), eq(runUsageTable.report, input.report)));
      await context.db.insert(runUsageTable).values(
        input.models.map((entry) => ({
          id: newId("runUsage"),
          runId: run.id,
          report: input.report,
          harness: input.harness,
          model: entry.model ?? null,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          cacheReadTokens: entry.cacheReadTokens,
          cacheWriteTokens: entry.cacheWriteTokens,
          costMicroUsd:
            entry.costUsd === undefined || entry.costUsd === null
              ? null
              : toMicroUsd(entry.costUsd),
          costBasis: entry.costBasis ?? null,
        })),
      );

      const totals = (await usageOf(context.db, [run.id])).get(run.id) ?? noUsage;
      await appendEvent(context, {
        kind: "run.usage_reported",
        subjectType: "run",
        subjectId: run.id,
        projectId: project.id,
        payload: { issueId: issue.id, report: input.report, harness: input.harness, ...totals },
      });
      return totals;
    },
  }),

  list: defineOperation({
    name: "runs.list",
    summary: "Runs on an Issue or by an Agent, newest first, from a cursor",
    method: "GET",
    path: "/runs",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({
      /** Only this record's Runs, by id, URL or the tracker's key. */
      issue: z.string().trim().min(1).optional(),
      agentMemberId: z.string().optional(),
      /**
       * Only the Runs this Human is behind: the ones they triggered, and the
       * ones their Agents are working. What Home means by "my Agents' Runs".
       */
      mine: QueryFlag.optional(),
      status: z.enum(runStatuses).optional(),
      /** Return Runs older than this position. Pass back the previous page's nextCursor. */
      before: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    output: z.object({
      runs: z.array(
        RunSchema.extend({
          /**
           * The last few Activities, oldest first, so a card can show what a
           * Run did last without one `runs.get` per Run; `runs.get` has the
           * whole feed (docs/plans/ui-redesign.md, review of #8).
           */
          lastActivities: z.array(ActivitySchema),
          /** How many Activities the Run has in all, so a card knows there are more. */
          activityCount: z.number().int(),
          /**
           * The Gate this Run is waiting at, when it is. A feed says "waiting
           * on a ruling" and links to it without a query per row.
           */
          openGateRequestId: z.string().nullable(),
          /** What the Run spent, as reported: one statement for the page. */
          usage: UsageSchema,
        }),
      ),
      /** The position of the last Run returned, or null when the page is empty. */
      nextCursor: z.string().nullable(),
    }),
    handler: async ({ input, context }) => {
      // One of the two indexes carries every query: (issueId, createdAt) or
      // (agentMemberId, status). A Workspace-wide scan is not on offer.
      //
      // An Agent asking for nothing in particular means its own Runs, which is
      // how one with no webhook URL finds its work: it cannot name itself,
      // because it has no way to learn its own Member id (ADR-0003).
      const agentMemberId =
        input.agentMemberId ?? (context.member.kind === "agent" ? context.member.id : undefined);
      // A Human asking for nothing in particular means the Workspace's Runs,
      // which is the feed `/runs` draws: one page off `(created_at, id)`, never
      // a fan-out. An Agent still means its own, because it cannot name itself.
      const mine = input.mine === true && context.member.kind === "human";
      const onIssue = input.issue ? await resolveIssueRef(context, input.issue) : null;
      const cursor = input.before ? parseRunCursor(input.before) : null;
      const granted = context.grantedProjectIds;

      const rows = await context.db
        .select({ run: runTable, externalKey: issueTable.externalKey })
        .from(runTable)
        .innerJoin(issueTable, eq(runTable.issueId, issueTable.id))
        .innerJoin(projectTable, eq(issueTable.projectId, projectTable.id))
        .innerJoin(agentMember, eq(runTable.agentMemberId, agentMember.id))
        .where(
          and(
            eq(projectTable.workspaceId, context.workspace.id),
            granted ? inArray(issueTable.projectId, granted) : undefined,
            onIssue ? eq(runTable.issueId, onIssue.issue.id) : undefined,
            agentMemberId === undefined ? undefined : eq(runTable.agentMemberId, agentMemberId),
            // The Human behind a Run is who triggered it, or the Sponsor of the
            // Agent working it (PLAN.md). Both in one clause, so "mine" is one
            // query rather than a list of my Agents and then their Runs.
            mine
              ? or(
                  eq(runTable.triggeredByMemberId, context.member.id),
                  eq(agentMember.sponsorId, context.member.id),
                )
              : undefined,
            input.status === undefined ? undefined : eq(runTable.status, input.status),
            cursor
              ? or(
                  lt(runTable.createdAt, cursor.at),
                  and(eq(runTable.createdAt, cursor.at), lt(runTable.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(runTable.createdAt), desc(runTable.id))
        .limit(input.limit);

      const last = rows.at(-1);
      const trailing = await trailingActivities(
        context.db,
        rows.map((row) => row.run.id),
      );
      // One query for the page rather than one per Run: a Gate is what a
      // waiting Run is waiting on, and a feed says so on every row.
      const waiting =
        rows.length === 0
          ? []
          : await context.db.query.gateRequest.findMany({
              where: { runId: { in: rows.map((row) => row.run.id) }, status: "open" },
              columns: { id: true, runId: true },
            });
      const gateOf = new Map(waiting.map((row) => [row.runId, row.id]));
      const spent = await usageOf(
        context.db,
        rows.map((row) => row.run.id),
      );
      return {
        runs: rows.map((row) => ({
          ...runView(row.run, row.externalKey),
          lastActivities: trailing.get(row.run.id)?.rows ?? [],
          activityCount: trailing.get(row.run.id)?.total ?? 0,
          openGateRequestId: gateOf.get(row.run.id) ?? null,
          usage: spent.get(row.run.id) ?? noUsage,
        })),
        nextCursor: last ? `${last.run.createdAt.getTime()}:${last.run.id}` : null,
      };
    },
  }),

  get: defineOperation({
    name: "runs.get",
    summary: "One Run with its Activity feed in the order it happened",
    method: "GET",
    path: "/runs/{runId}",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({ runId: z.string() }),
    output: RunDetailSchema.extend({
      /** What the Run spent, as reported, and each model's share. */
      usage: UsageDetailSchema,
    }),
    handler: async ({ input, context }) => {
      const { run, key } = await requireRun(context, input.runId);
      const activities = await context.db.query.activity.findMany({
        where: { runId: run.id },
        orderBy: { createdAt: "asc" },
      });
      return { ...runView(run, key), activities, usage: await usageDetailOf(context.db, run.id) };
    },
  }),
};

/** How many of a Run's Activities a list carries: what a folded card shows. */
export const TRAILING_ACTIVITIES = 3;

/**
 * The last few Activities of each Run, and how many there are, in one query:
 * a window over `activity` ranks each Run's rows newest first and counts
 * them, and only the top of each partition comes back. One statement for the
 * whole page, since D1 budgets per statement (docs/plans/m3.md).
 */
async function trailingActivities(
  db: Parameters<typeof requireRun>[0]["db"],
  runIds: string[],
): Promise<Map<string, { rows: Activity[]; total: number }>> {
  const byRun = new Map<string, { rows: Activity[]; total: number }>();
  if (runIds.length === 0) return byRun;
  const ranked = db
    .select({
      id: activityTable.id,
      runId: activityTable.runId,
      kind: activityTable.kind,
      body: activityTable.body,
      payload: activityTable.payload,
      createdAt: activityTable.createdAt,
      rank: sql<number>`row_number() over (partition by ${activityTable.runId} order by ${activityTable.createdAt} desc, ${activityTable.id} desc)`.as(
        "rank",
      ),
      total: sql<number>`count(*) over (partition by ${activityTable.runId})`.as("total"),
    })
    .from(activityTable)
    .where(inArray(activityTable.runId, runIds))
    .as("ranked");
  const rows = await db
    .select()
    .from(ranked)
    .where(lte(ranked.rank, TRAILING_ACTIVITIES))
    .orderBy(asc(ranked.createdAt), asc(ranked.id));
  for (const { rank: _rank, total, ...row } of rows) {
    const entry = byRun.get(row.runId) ?? { rows: [], total };
    entry.rows.push(row);
    byRun.set(row.runId, entry);
  }
  return byRun;
}
