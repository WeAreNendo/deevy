import { z } from "zod";
import {
  approvalsStanding,
  assertHuman,
  assertNamedApprover,
  enterState,
  gateApprovers,
  nextState,
  previousState,
  requesterFor,
  recordGateDecision,
} from "../workflow.ts";
import { resumeGateRuns } from "../runs.ts";
import { IssueDetailSchema } from "../schemas.ts";
import { ORPCError } from "@orpc/server";
import { appendEvent } from "../events.ts";
import { defineOperation } from "./registry.ts";
import { loadIssue, openStateDocument, requireIssueForMove } from "./shared.ts";

export const gates = {
  approve: defineOperation({
    name: "gates.approve",
    summary: "Let an Issue out of the Gate it is in, into the next State",
    method: "POST",
    path: "/issues/{key}/gate/approve",
    auth: "member",
    sessionOnly: true,
    input: z.object({ key: z.string(), note: z.string().max(4000).nullish() }),
    output: IssueDetailSchema,
    handler: async ({ input, context }) => {
      assertHuman(context.member);
      const { issue, project, states, from } = await requireIssueForMove(context, input.key);
      if (!from.isGate) {
        throw new ORPCError("BAD_REQUEST", {
          message: `${input.key} is not in a Gate; move it instead`,
        });
      }
      const to = nextState(states, from);
      if (!to) {
        throw new ORPCError("BAD_REQUEST", {
          message: `${from.name} is the last State; there is nowhere to approve it to`,
        });
      }
      assertNamedApprover(await gateApprovers(context.db, from.id), context.member.id);

      // A Gate may refuse the Human who put the Issue in front of it. The
      // message names the reason: being the requester is not the same refusal
      // as not being an approver (docs/plans/four-eyes-gates.md).
      if (from.excludeRequester) {
        const requester = await requesterFor(context.db, issue);
        if (requester === context.member.id) {
          throw new ORPCError("FORBIDDEN", {
            message: `You brought ${input.key} to the ${from.name} Gate, and it asks somebody else to agree`,
          });
        }
      }

      // A Gate may want more than one Human, and wants them distinct: approving
      // twice is one Human's opinion twice (docs/plans/four-eyes-gates.md).
      const already = (await approvalsStanding(context.db, issue, from.id)).map(
        (one) => one.memberId,
      );
      const required = from.approvalsRequired;
      if (already.includes(context.member.id)) {
        const wanted = required - already.length;
        throw new ORPCError("CONFLICT", {
          message:
            wanted > 0
              ? `You have already approved the ${from.name} Gate; it wants ${wanted} more ${
                  wanted === 1 ? "Human" : "Humans"
                }`
              : `You have already approved the ${from.name} Gate`,
        });
      }

      await recordGateDecision(context.db, {
        issueId: issue.id,
        stateId: from.id,
        decision: "approved",
        note: input.note,
        memberId: context.member.id,
      });

      // Short of the threshold the Issue stays where it is: no State is entered,
      // no Document is opened, and the Run that asked stays `awaiting_input`.
      const approvals = already.length + 1;
      if (approvals < required) {
        await appendEvent(context, {
          kind: "gate.approval",
          subjectType: "issue",
          subjectId: issue.id,
          projectId: project.id,
          payload: {
            state: from.name,
            note: input.note ?? null,
            approvals,
            required,
            remaining: required - approvals,
          },
        });
        return loadIssue(context, issue.id);
      }

      await enterState(context.db, issue, to);
      await appendEvent(context, {
        kind: "gate.approved",
        subjectType: "issue",
        subjectId: issue.id,
        projectId: project.id,
        payload: { state: from.name, to: to.name, note: input.note ?? null },
      });
      // Whatever Run stopped at this Gate carries on now, the way a Human's
      // answer un-blocks an elicitation (docs/plans/m2.md).
      await resumeGateRuns(context, issue, {
        stateId: from.id,
        state: from.name,
        ruling: "approved",
        note: input.note,
      });
      await openStateDocument(context, issue.id, project.id, to);
      return loadIssue(context, issue.id);
    },
  }),

  reject: defineOperation({
    name: "gates.reject",
    summary: "Send an Issue back from the Gate it is in, to the State before it",
    method: "POST",
    path: "/issues/{key}/gate/reject",
    auth: "member",
    sessionOnly: true,
    input: z.object({ key: z.string(), note: z.string().max(4000).nullish() }),
    output: IssueDetailSchema,
    handler: async ({ input, context }) => {
      assertHuman(context.member);
      const { issue, project, states, from } = await requireIssueForMove(context, input.key);
      if (!from.isGate) {
        throw new ORPCError("BAD_REQUEST", {
          message: `${input.key} is not in a Gate; move it instead`,
        });
      }
      // A rejection in the first State keeps the Issue where it is: there is
      // nowhere further back, and the decision is still worth recording.
      const to = previousState(states, from);
      assertNamedApprover(await gateApprovers(context.db, from.id), context.member.id);

      await recordGateDecision(context.db, {
        issueId: issue.id,
        stateId: from.id,
        decision: "rejected",
        note: input.note,
        memberId: context.member.id,
      });
      if (to.id !== from.id) await enterState(context.db, issue, to);
      await appendEvent(context, {
        kind: "gate.rejected",
        subjectType: "issue",
        subjectId: issue.id,
        projectId: project.id,
        payload: { state: from.name, to: to.name, note: input.note ?? null },
      });
      // A rejection un-blocks the Run that asked just as an approval does: it
      // is a decision, and the Agent needs to hear it (docs/plans/m2.md).
      await resumeGateRuns(context, issue, {
        stateId: from.id,
        state: from.name,
        ruling: "rejected",
        note: input.note,
      });
      await openStateDocument(context, issue.id, project.id, to);
      return loadIssue(context, issue.id);
    },
  }),
};
