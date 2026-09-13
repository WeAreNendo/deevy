import { and, asc, desc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  activity as activityTable,
  agentActivityKinds,
  run as runTable,
  runStatuses,
} from "@deevy/db";
import { issue as issueTable, project as projectTable } from "@deevy/db";
import { issueKey } from "../issues.ts";
import { ORPCError } from "@orpc/server";
import { appendEvent } from "../events.ts";
import {
  ActivitySchema,
  GateApprovalSchema,
  RunDetailSchema,
  RunSchema,
  assertFinishable,
  gateApproversView,
  isOpen,
  lastGateRequest,
  openStatuses,
  setRunStatus,
  statusAfterActivity,
  statusAfterAnswer,
} from "../runs.ts";
import { gateApprovers, gateUrl } from "../workflow.ts";
import { defineOperation } from "./registry.ts";
import type { Activity, Run } from "@deevy/db";
import {
  assertOwnRun,
  linkOrigin,
  parseRunCursor,
  requireIssue,
  requireRun,
  runView,
} from "./shared.ts";
import { newId } from "../ids.ts";

export const runs = {
  start: defineOperation({
    name: "runs.start",
    summary: "Begin a Run on an Issue, pending until the Agent posts its first Activity",
    method: "POST",
    path: "/issues/{issueKey}/runs",
    auth: "member",
    agents: true,
    agentsOnly: true,
    mcp: true,
    input: z.object({ issueKey: z.string() }),
    output: RunSchema,
    handler: async ({ input, context }) => {
      const { issue, project } = await requireIssue(context, input.issueKey);
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
      return runView(row, input.issueKey);
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
      // Event: that is what a Notification and the live feed hang off.
      if (status === "awaiting_input") {
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

  requestApproval: defineOperation({
    name: "runs.requestApproval",
    summary: "Ask the Humans who decide this Gate to rule on it, and wait for them",
    method: "POST",
    path: "/runs/{runId}/request-approval",
    auth: "member",
    agents: true,
    agentsOnly: true,
    mcp: true,
    input: z.object({ runId: z.string() }),
    output: GateApprovalSchema,
    handler: async ({ input, context }) => {
      const { run, issue, project, key } = await requireRun(context, input.runId);
      assertOwnRun(context, run);
      if (!isOpen(run.status)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `This Run already ${run.status}; start another to carry on`,
        });
      }

      const states = await context.db.query.workflowState.findMany({
        where: { projectId: project.id },
        orderBy: { position: "asc" },
      });
      const current = states.find((state) => state.id === issue.stateId);
      const asked = await lastGateRequest(context.db, run.id);
      // An open question comes first: a Run that asked about the Plan Gate is
      // owed that ruling even after a rejection has put the Issue back into the
      // Spec Gate. With nothing outstanding the Gate in question is simply the
      // one the Issue is in, and, when the Issue is past every Gate, the last
      // one this Run asked about, so a second retry gets the same answer.
      const outstanding = asked && !asked.answered ? asked : null;
      const pinned = outstanding ?? asked;
      const gate =
        outstanding || current?.isGate !== true
          ? states.find((state) => state.id === pinned?.request.gateStateId)
          : current;
      if (!gate) {
        throw new ORPCError("BAD_REQUEST", {
          message: `${key} is not in a Gate; move it instead`,
        });
      }

      // Only a ruling made since this Run asked answers it. An older one
      // belongs to an earlier trip through the same Gate.
      const since = asked && asked.request.gateStateId === gate.id ? asked.askedAt : run.createdAt;
      const decisions = await context.db.query.gateDecision.findMany({
        where: { issueId: issue.id, stateId: gate.id },
        orderBy: { createdAt: "desc" },
        limit: 1,
      });
      const latest = decisions.find((row) => row.createdAt >= since) ?? null;
      // An approval only answers when it opened the Gate. A Gate that wants two
      // Humans has one approval on the record after the first of them, and the
      // Issue still sitting in it: the Agent is owed "awaiting" until it moves
      // (docs/plans/four-eyes-gates.md). A rejection answers whatever the
      // threshold is, since one is enough to end it.
      const opened = issue.stateId !== gate.id;
      const decided = latest && (latest.decision === "rejected" || opened) ? latest : null;
      const approvers = gateApproversView(await gateApprovers(context.db, gate.id));
      const url = gateUrl(linkOrigin(context), key, gate.id);

      if (decided) {
        // The ruling joins the feed as a `prompt`, the same word a Human's own
        // answer arrives as (`runs.answer`): the Agent reads its answers in one
        // place, and the question is closed, so the next Gate is a new one.
        if (outstanding) {
          const id = newId("activity");
          await context.db.insert(activityTable).values({
            id,
            runId: run.id,
            kind: "prompt",
            body: `The ${gate.name} Gate on ${key} was ${decided.decision}${
              decided.note ? `: ${decided.note}` : ""
            }`,
            payload: {
              gateStateId: gate.id,
              decision: decided.decision,
              decidedByMemberId: decided.memberId,
            },
          });
          await appendEvent(context, {
            kind: "run.activity",
            subjectType: "run",
            subjectId: run.id,
            projectId: project.id,
            payload: { issueId: issue.id, activityId: id, activityKind: "prompt" },
          });
        }
        const settled = (await context.db.query.run.findFirst({ where: { id: run.id } })) as Run;
        return {
          run: runView(settled, key),
          status: decided.decision === "approved" ? ("approved" as const) : ("rejected" as const),
          stateId: gate.id,
          stateName: gate.name,
          url,
          approvers,
          decidedByMemberId: decided.memberId,
          note: decided.note,
        };
      }

      // Asking twice is one question. A polling Agent with no elicitation
      // support calls this in a loop, and a feed of identical questions would
      // be a worse record of what happened, not a better one.
      const alreadyAsking =
        run.status === "awaiting_input" && outstanding?.request.gateStateId === gate.id;
      if (!alreadyAsking) {
        const id = newId("activity");
        await context.db.insert(activityTable).values({
          id,
          runId: run.id,
          kind: "elicitation",
          body: `Waiting for a Human to decide the ${gate.name} Gate on ${key}`,
          payload: { gateStateId: gate.id, url },
        });
        await setRunStatus(context.db, run, "awaiting_input", { touchActivity: true });
        await appendEvent(context, {
          kind: "run.activity",
          subjectType: "run",
          subjectId: run.id,
          projectId: project.id,
          payload: { issueId: issue.id, activityId: id, activityKind: "elicitation" },
        });
        // The Gate, not the Run, decides who hears about this: the Event
        // carries the State so `deriveNotifications` can ask the Gate who its
        // approvers are (docs/plans/m2.md).
        await appendEvent(context, {
          kind: "run.awaiting_input",
          subjectType: "run",
          subjectId: run.id,
          projectId: project.id,
          payload: {
            issueId: issue.id,
            activityId: id,
            gateStateId: gate.id,
            state: gate.name,
            url,
            question: `${key} is in the ${gate.name} Gate`,
          },
        });
      }

      const waiting = (await context.db.query.run.findFirst({ where: { id: run.id } })) as Run;
      return {
        run: runView(waiting, key),
        status: "awaiting" as const,
        stateId: gate.id,
        stateName: gate.name,
        url,
        approvers,
        decidedByMemberId: null,
        note: null,
      };
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
      issueKey: z.string().optional(),
      agentMemberId: z.string().optional(),
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
      if (!input.issueKey && !agentMemberId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Say whose Runs you want: an Issue key or an Agent",
        });
      }
      const onIssue = input.issueKey ? await requireIssue(context, input.issueKey) : null;
      const cursor = input.before ? parseRunCursor(input.before) : null;
      const granted = context.grantedProjectIds;

      const rows = await context.db
        .select({ run: runTable, number: issueTable.number, projectKey: projectTable.key })
        .from(runTable)
        .innerJoin(issueTable, eq(runTable.issueId, issueTable.id))
        .innerJoin(projectTable, eq(issueTable.projectId, projectTable.id))
        .where(
          and(
            eq(projectTable.workspaceId, context.workspace.id),
            granted ? inArray(issueTable.projectId, granted) : undefined,
            onIssue ? eq(runTable.issueId, onIssue.issue.id) : undefined,
            agentMemberId === undefined ? undefined : eq(runTable.agentMemberId, agentMemberId),
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
      return {
        runs: rows.map((row) => ({
          ...runView(row.run, issueKey(row.projectKey, row.number)),
          lastActivities: trailing.get(row.run.id)?.rows ?? [],
          activityCount: trailing.get(row.run.id)?.total ?? 0,
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
    output: RunDetailSchema,
    handler: async ({ input, context }) => {
      const { run, key } = await requireRun(context, input.runId);
      const activities = await context.db.query.activity.findMany({
        where: { runId: run.id },
        orderBy: { createdAt: "asc" },
      });
      return { ...runView(run, key), activities };
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
