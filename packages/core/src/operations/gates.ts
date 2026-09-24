import {
  activity as activityTable,
  gateRequest as gateRequestTable,
  issue as issueTable,
  project as projectTable,
  type GateRequest,
} from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { appendEvent } from "../events.ts";
import {
  CheckpointPolicySchema,
  defaultPolicy,
  policyFor,
  policyOf,
  requesterFor,
  setCheckpoints,
  type CheckpointPolicy,
} from "../checkpoints.ts";
import {
  GateLinkSchema,
  GateRequestSchema,
  gateView,
  recordRuling,
  type GateDecisionRow,
} from "../gates.ts";
import { newId } from "../ids.ts";
import { isOpen, setRunStatus, statusAfterActivity } from "../runs.ts";
import { defineOperation } from "./registry.ts";
import type { ContextFor } from "./registry.ts";
import {
  assertProjectVisible,
  linkOrigin,
  requireProjectOrAdmin,
  requireRun,
  ProjectSlugLookup,
} from "./shared.ts";

/**
 * Asking a Human, and being told (ADR-0024, ADR-0020).
 *
 * An Agent that reaches a Checkpoint stops and asks, carrying the Proposal a
 * Human rules on. The policy itself lives in `gates.ts`, because a Ruling can
 * arrive from the tracker or from Slack as well as from here and all three
 * doors have to mean the same thing (ADR-0025).
 *
 * `gates.approve` and `gates.reject` are `sessionOnly`: a Human present in
 * deevy, not a token they delegated to something else. ADR-0010's rule, on the
 * operation that now carries it.
 */

/** Everything a Gate's view needs, read once. */
async function gateFor(context: ContextFor<"member">, requestId: string) {
  const found = await context.db.query.gateRequest.findFirst({
    where: { id: requestId },
    with: {
      decisions: { with: { socket: true } },
      issue: true,
      run: true,
      checkpointPolicy: { with: { approvers: true } },
    },
  });
  if (!found || found.issue.projectId !== found.projectId) {
    throw new ORPCError("NOT_FOUND", { message: "No such Gate" });
  }
  assertProjectVisible(context, found.projectId);
  const policy = found.checkpointPolicy
    ? policyOf(
        found.checkpointPolicy,
        found.checkpointPolicy.approvers.map((row) => row.memberId),
      )
    : await policyFor(context.db, found.projectId, found.checkpoint);
  // Only where it can change the answer: a Checkpoint that excludes nobody
  // needs no lookup of who the Run is for.
  const requesterId = policy.excludeRequester ? await requesterFor(context.db, found.run) : null;
  return {
    request: found,
    policy,
    decisions: found.decisions,
    issueKey: found.issue.externalKey,
    requesterId,
  };
}

function viewOf(
  context: ContextFor<"member">,
  parts: {
    request: GateRequest;
    policy: CheckpointPolicy;
    decisions: GateDecisionRow[];
    issueKey: string;
    requesterId?: string | null;
  },
) {
  return gateView({
    ...parts,
    requesterId: parts.requesterId ?? null,
    origin: linkOrigin(context),
    viewer: { id: context.member.id, kind: context.member.kind },
  });
}

export const gates = {
  request: defineOperation({
    name: "gates.request",
    summary: "Ask the Humans to let this Run past a Checkpoint, with what you intend to do",
    method: "POST",
    path: "/runs/{runId}/gates",
    auth: "member",
    agents: true,
    agentsOnly: true,
    mcp: true,
    input: z.object({
      runId: z.string(),
      /** The Checkpoint's name: `plan`, `ship`, or whatever this Project calls it. */
      checkpoint: z
        .string()
        .trim()
        .min(1)
        .max(60)
        .regex(/^[a-z0-9][a-z0-9-]*$/, "A Checkpoint is named in lower case, with hyphens"),
      /** Markdown: what you intend to do, or what you did. This is what a Human rules on. */
      proposal: z.string().trim().min(1).max(100_000),
      links: z.array(GateLinkSchema).max(20).default([]),
    }),
    output: GateRequestSchema,
    handler: async ({ input, context }) => {
      const { run, issue, project, key } = await requireRun(context, input.runId);
      if (run.agentMemberId !== context.member.id) {
        throw new ORPCError("FORBIDDEN", { message: "This Run belongs to another Agent" });
      }
      if (!isOpen(run.status)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `This Run is ${run.status}; start another to ask again`,
        });
      }

      const policy = await policyFor(context.db, project.id, input.checkpoint);
      const standing = await context.db.query.gateRequest.findFirst({
        where: { runId: run.id, checkpoint: input.checkpoint, status: "open" },
        with: { decisions: true },
      });

      // Asking twice is one question. An Agent that lost its answer, or a
      // client that retried, must not start a second count.
      if (standing && standing.proposal === input.proposal) {
        return viewOf(context, {
          request: standing,
          policy,
          decisions: standing.decisions,
          issueKey: key,
        });
      }

      if (standing) {
        // A changed Proposal is a different question, so the old one ends
        // rather than being edited under the Humans already reading it.
        await context.db
          .update(gateRequestTable)
          .set({ status: "superseded", decidedAt: new Date() })
          .where(eq(gateRequestTable.id, standing.id));
        await appendEvent(context, {
          kind: "gate.superseded",
          subjectType: "gate",
          subjectId: standing.id,
          projectId: project.id,
          payload: { issueId: issue.id, runId: run.id, checkpoint: standing.checkpoint },
        });
      }

      const previous = await context.db.query.gateRequest.findFirst({
        where: { runId: run.id, checkpoint: input.checkpoint },
        orderBy: { visit: "desc" },
        columns: { visit: true },
      });
      const id = newId("gateRequest");
      const [created] = await context.db
        .insert(gateRequestTable)
        .values({
          id,
          runId: run.id,
          issueId: issue.id,
          projectId: project.id,
          checkpoint: input.checkpoint,
          checkpointId: policy.id,
          proposal: input.proposal,
          links: input.links,
          requestedBy: context.member.id,
          visit: (previous?.visit ?? 0) + 1,
        })
        .returning();
      if (!created) throw new ORPCError("CONFLICT", { message: "Somebody else asked first" });

      const request = created as GateRequest;
      const url = `${linkOrigin(context)}/gates/${request.id}`;
      // The ask joins the Run's own feed, because that feed is the Run: a
      // Human reading it should see where the Agent stopped and why.
      const activityId = newId("activity");
      await context.db.insert(activityTable).values({
        id: activityId,
        runId: run.id,
        kind: "elicitation",
        body: input.proposal,
        payload: { gateRequestId: request.id, checkpoint: request.checkpoint, url },
      });
      await setRunStatus(context.db, run, statusAfterActivity(run.status, "elicitation"), {
        touchActivity: true,
      });

      await appendEvent(context, {
        kind: "gate.requested",
        subjectType: "gate",
        subjectId: request.id,
        projectId: project.id,
        payload: {
          issueId: issue.id,
          runId: run.id,
          checkpoint: request.checkpoint,
          visit: request.visit,
          required: policy.approvalsRequired,
        },
      });
      // And `run.awaiting_input` is what asks: the inbox, the Slack rules and
      // the reminder all read it, and the `gateRequestId` is what makes it a
      // Gate rather than a question (notifications.ts).
      await appendEvent(context, {
        kind: "run.awaiting_input",
        subjectType: "run",
        subjectId: run.id,
        projectId: project.id,
        payload: {
          issueId: issue.id,
          activityId,
          gateRequestId: request.id,
          checkpoint: request.checkpoint,
          question: input.proposal.slice(0, 2000),
        },
      });

      return viewOf(context, { request, policy, decisions: [], issueKey: key });
    },
  }),

  get: defineOperation({
    name: "gates.get",
    summary: "What has been ruled on a Gate, for an Agent waiting or a Human reading",
    method: "GET",
    path: "/gates/{requestId}",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({ requestId: z.string() }),
    output: GateRequestSchema,
    handler: async ({ input, context }) => viewOf(context, await gateFor(context, input.requestId)),
  }),

  list: defineOperation({
    name: "gates.list",
    summary: "Gates in this Workspace: open ones, or the ones waiting on you",
    method: "GET",
    path: "/gates",
    auth: "member",
    agents: true,
    input: z.object({
      /** Only the ones this Human could rule on right now. */
      mine: z.union([z.boolean(), z.stringbool()]).optional(),
      /** Every Gate one Run has asked for, which is what a Run's page shows. */
      runId: z.string().optional(),
      /** Every Gate ever asked on one record, which is what a Work item shows. */
      issueId: z.string().optional(),
      status: z.enum(["open", "approved", "rejected", "superseded"]).optional(),
      projectSlug: ProjectSlugLookup.optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    output: z.object({ gates: z.array(GateRequestSchema) }),
    handler: async ({ input, context }) => {
      const project = input.projectSlug
        ? await requireProjectOrAdmin(context, input.projectSlug)
        : null;
      const granted = context.grantedProjectIds;

      // One page, off `(project_id, status)`, scoped to this Workspace by the
      // same join every other list uses. Three statements whatever it returns:
      // the page, its Rulings, and the policies of the Projects on it.
      const rows = await context.db
        .select({ gate: gateRequestTable, externalKey: issueTable.externalKey })
        .from(gateRequestTable)
        .innerJoin(issueTable, eq(gateRequestTable.issueId, issueTable.id))
        .innerJoin(projectTable, eq(gateRequestTable.projectId, projectTable.id))
        .where(
          and(
            eq(projectTable.workspaceId, context.workspace.id),
            granted ? inArray(gateRequestTable.projectId, granted) : undefined,
            project ? eq(gateRequestTable.projectId, project.id) : undefined,
            input.runId === undefined ? undefined : eq(gateRequestTable.runId, input.runId),
            input.issueId === undefined ? undefined : eq(gateRequestTable.issueId, input.issueId),
            input.mine ? eq(gateRequestTable.status, "open") : undefined,
            input.status === undefined ? undefined : eq(gateRequestTable.status, input.status),
          ),
        )
        .orderBy(desc(gateRequestTable.askedAt))
        .limit(input.limit);
      if (rows.length === 0) return { gates: [] };

      const ids = rows.map((row) => row.gate.id);
      const decisions = await context.db.query.gateDecision.findMany({
        where: { gateRequestId: { in: ids } },
        with: { socket: true },
      });
      // Only the Projects on this page, and only when a policy there excludes
      // the requester: otherwise the Runs behind the page are never read.
      const configured = await context.db.query.checkpoint.findMany({
        where: { projectId: { in: [...new Set(rows.map((row) => row.gate.projectId))] } },
        with: { approvers: true },
      });
      const policies = new Map(
        configured.map((row) => [
          `${row.projectId}:${row.name}`,
          policyOf(
            row,
            row.approvers.map((one) => one.memberId),
          ),
        ]),
      );

      // The Runs behind the page, for the Checkpoints that exclude the Human
      // the work is for: one query, and none at all where no policy asks.
      const excluding = rows.filter(
        ({ gate }) =>
          policies.get(`${gate.projectId}:${gate.checkpoint}`)?.excludeRequester === true,
      );
      const requesters = new Map<string, string | null>();
      if (excluding.length > 0) {
        const runs = await context.db.query.run.findMany({
          where: { id: { in: excluding.map(({ gate }) => gate.runId) } },
          columns: { id: true, triggeredByMemberId: true, agentMemberId: true },
        });
        for (const one of runs) requesters.set(one.id, await requesterFor(context.db, one));
      }

      const gatesOut = [];
      for (const { gate, externalKey } of rows) {
        const policy =
          policies.get(`${gate.projectId}:${gate.checkpoint}`) ?? defaultPolicy(gate.checkpoint);
        const ruled = decisions.filter((one) => one.gateRequestId === gate.id);
        const view = viewOf(context, {
          request: gate,
          policy,
          decisions: ruled,
          issueKey: externalKey,
          requesterId: requesters.get(gate.runId) ?? null,
        });
        // "Waiting on me" is the whole question a home page asks, and it is
        // the same question the ruling screen answers: a Gate this Human may
        // rule on right now.
        if (input.mine && !view.you.mayRule) continue;
        gatesOut.push(view);
      }
      return { gates: gatesOut };
    },
  }),

  approve: defineOperation({
    name: "gates.approve",
    summary: "Let this Run past the Checkpoint it stopped at",
    method: "POST",
    path: "/gates/{requestId}/approve",
    auth: "member",
    // A Human present in deevy, not a token they delegated to a client
    // (ADR-0010). The middleware refuses the credential before the handler.
    sessionOnly: true,
    input: z.object({ requestId: z.string(), note: z.string().trim().max(10_000).optional() }),
    output: GateRequestSchema,
    handler: async ({ input, context }) => {
      await recordRuling(context, {
        requestId: input.requestId,
        memberId: context.member.id,
        decision: "approved",
        note: input.note ?? null,
        via: "web",
      });
      return viewOf(context, await gateFor(context, input.requestId));
    },
  }),

  reject: defineOperation({
    name: "gates.reject",
    summary: "Send this Run back from the Checkpoint it stopped at, with what to change",
    method: "POST",
    path: "/gates/{requestId}/reject",
    auth: "member",
    sessionOnly: true,
    input: z.object({ requestId: z.string(), note: z.string().trim().max(10_000).optional() }),
    output: GateRequestSchema,
    handler: async ({ input, context }) => {
      await recordRuling(context, {
        requestId: input.requestId,
        memberId: context.member.id,
        decision: "rejected",
        note: input.note ?? null,
        via: "web",
      });
      return viewOf(context, await gateFor(context, input.requestId));
    },
  }),
};

const CheckpointInput = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "A Checkpoint is named in lower case, with hyphens"),
  approvalsRequired: z.number().int().min(1).max(20).default(1),
  /** Four eyes: the Human this Run is for may not be one of the approvals. */
  excludeRequester: z.boolean().default(false),
  /** Empty means every active Human may rule at this Checkpoint. */
  approverMemberIds: z.array(z.string()).max(50).default([]),
});

export const checkpoints = {
  list: defineOperation({
    name: "checkpoints.list",
    summary: "What a Project asks of a Run before it goes past each Checkpoint",
    method: "GET",
    path: "/projects/{projectSlug}/checkpoints",
    auth: "member",
    input: z.object({ projectSlug: ProjectSlugLookup }),
    output: z.object({ checkpoints: z.array(CheckpointPolicySchema) }),
    handler: async ({ input, context }) => {
      const project = await requireProjectOrAdmin(context, input.projectSlug);
      const rows = await context.db.query.checkpoint.findMany({
        where: { projectId: project.id },
        with: { approvers: true },
        orderBy: { name: "asc" },
      });
      return {
        checkpoints: rows.map((row) =>
          policyOf(
            row,
            row.approvers.map((one) => one.memberId),
          ),
        ),
      };
    },
  }),

  set: defineOperation({
    name: "checkpoints.set",
    summary: "Set what a Project asks at each Checkpoint, replacing what it asked before",
    method: "POST",
    path: "/projects/{projectSlug}/checkpoints",
    auth: "admin",
    input: z.object({
      projectSlug: ProjectSlugLookup,
      checkpoints: z.array(CheckpointInput).max(50),
    }),
    output: z.object({ checkpoints: z.array(CheckpointPolicySchema) }),
    handler: async ({ input, context }) => {
      const project = await context.db.query.project.findFirst({
        where: { workspaceId: context.workspace.id, slug: input.projectSlug },
      });
      if (!project) throw new ORPCError("NOT_FOUND", { message: "No such Project" });

      const names = new Set(input.checkpoints.map((one) => one.name));
      if (names.size !== input.checkpoints.length) {
        throw new ORPCError("BAD_REQUEST", { message: "Two Checkpoints cannot share a name" });
      }
      await setCheckpoints(context.db, project.id, context.workspace.id, input.checkpoints);

      await appendEvent(context, {
        kind: "project.updated",
        subjectType: "project",
        subjectId: project.id,
        projectId: project.id,
        payload: { slug: project.slug, checkpoints: [...names] },
      });

      const rows = await context.db.query.checkpoint.findMany({
        where: { projectId: project.id },
        with: { approvers: true },
        orderBy: { name: "asc" },
      });
      return {
        checkpoints: rows.map((row) =>
          policyOf(
            row,
            row.approvers.map((one) => one.memberId),
          ),
        ),
      };
    },
  }),
};
