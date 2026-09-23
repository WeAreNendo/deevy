import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { appendEvent } from "../events.ts";
import { branchFor, pullBody, titleFor } from "../forge.ts";
import { IssueLinkSchema } from "../schemas.ts";
import { requireForge, requireSocket, socketModuleFor } from "../sockets/registry.ts";
import { defineOperation } from "./registry.ts";
import { addIssueLink, assertOwnRun, requireForgeBinding, requireRun } from "./shared.ts";

/**
 * Opening the pull request (ADR-0014, ADR-0024).
 *
 * deevy opens it, not the Agent's own session. The credential a Run clones
 * with reaches one repository and expires in an hour; it is not a credential
 * that could open a pull request, and it should not be. What the Agent does is
 * push a branch and say so.
 *
 * It is its own operation rather than something `links.add` does on the side:
 * a write to a third party hidden inside a link operation is the opposite of
 * saying what a tool does.
 */
export const pulls = {
  open: defineOperation({
    name: "pulls.open",
    summary: "Open the pull request for your Run's branch, and attach it to the record",
    method: "POST",
    path: "/runs/{runId}/pull",
    auth: "member",
    agents: true,
    agentsOnly: true,
    mcp: true,
    input: z.object({
      runId: z.string(),
      /** The branch you pushed. Left out, the one `runs.checkout` named. */
      head: z.string().trim().min(1).max(255).optional(),
      /** What you did, in a line or two. It becomes the title and the body. */
      summary: z.string().trim().max(10_000).optional(),
      /** Overrides the title deevy would have written from the summary. */
      title: z.string().trim().min(1).max(200).optional(),
      /** Overrides the body. `Closes <url>` and the Run id are appended either way. */
      body: z.string().trim().max(60_000).optional(),
    }),
    output: z.object({
      url: z.string(),
      number: z.number().int(),
      link: IssueLinkSchema,
    }),
    handler: async ({ input, context }) => {
      const { run, issue, project, key } = await requireRun(context, input.runId);
      assertOwnRun(context, run);
      const binding = requireForgeBinding(project);

      /*
       * One pull request per Run, whoever asks. Two callers reach here on the
       * same Run by design: the Agent is told to open it
       * (apps/agent/src/instructions.md), and the supervisor opens one for a
       * branch a session pushed and left (apps/agent/src/work.ts). A second
       * pull request for one attempt is noise a reviewer has to resolve, and
       * asking twice is not a mistake worth a refusal — so the one that exists
       * is the answer.
       */
      const already = await context.db.query.issueLink.findFirst({
        where: { runId: run.id, kind: "pull_request" },
      });
      if (already) {
        // Read back out of the title deevy wrote below rather than off the
        // URL, whose shape is the provider's and not deevy's to rely on.
        return {
          url: already.url,
          number: Number(/#(\d+)/.exec(already.title ?? "")?.[1] ?? 0),
          link: already,
        };
      }

      const socket = await requireSocket(context, binding.socketId);
      const forge = requireForge(await socketModuleFor(context, socket));
      const opened = await forge.openPullRequest(binding.scope, {
        head: input.head ?? branchFor(key, run.id),
        base: binding.baseBranch,
        title: input.title ?? titleFor(key, input.summary),
        body:
          input.body === undefined
            ? pullBody({ summary: input.summary, issueUrl: issue.url, runId: run.id })
            : `${input.body}\n\nCloses ${issue.url}\n\nOpened by a deevy Agent · Run ${run.id}`,
      });
      if (!opened.url) {
        throw new ORPCError("BAD_GATEWAY", { message: "The forge opened no pull request" });
      }

      // The same path `links.add` takes, so evidence looks the same whoever
      // attached it, and the Event carries the Run that produced it.
      const link = await addIssueLink(context, {
        issue,
        project,
        url: opened.url,
        title: `Pull request #${String(opened.number)}`,
        kind: "pull_request",
        runId: run.id,
      });

      await appendEvent(context, {
        kind: "run.pull_request_opened",
        subjectType: "run",
        subjectId: run.id,
        projectId: project.id,
        payload: { issueId: issue.id, url: opened.url, number: opened.number },
      });
      return { url: opened.url, number: opened.number, link };
    },
  }),
};
