import { z } from "zod";
import { resolveMentions } from "../mentions.ts";
import { ExternalCommentSchema } from "../schemas.ts";
import { requireSocket, requireTracker, socketModuleFor } from "../sockets/registry.ts";
import { appendEvent } from "../events.ts";
import { defineOperation } from "./registry.ts";
import { resolveIssueRef } from "./shared.ts";

/**
 * Saying something where the work lives (ADR-0024).
 *
 * deevy stores no comments. A comment goes to the tracker and the thread is
 * read back from it, so the conversation stays in one place and the people who
 * are not in deevy still see it. What deevy keeps is the Event, because a
 * mention is a trigger and the log is the record of what happened.
 *
 * The comment is signed with the Member who wrote it, because the tracker shows
 * the Socket's own account as the author and a reader should not have to guess
 * which Agent spoke.
 */
export const comments = {
  create: defineOperation({
    name: "comments.create",
    summary: "Say something on the record in the tracker it lives in",
    method: "POST",
    path: "/issues/{issue}/comments",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({
      issue: z.string().trim().min(1),
      body: z.string().trim().min(1).max(100_000),
    }),
    output: ExternalCommentSchema,
    handler: async ({ input, context }) => {
      const { issue, project } = await resolveIssueRef(context, input.issue);
      const row = await requireSocket(context, project.trackerSocketId);
      const tracker = requireTracker(socketModuleFor(context, row));

      const signature = `— ${context.member.handle ?? context.member.id} · via deevy`;
      const ref = await tracker.createComment(
        project.trackerScope,
        { externalId: issue.externalId, url: issue.url },
        `${input.body}\n\n${signature}`,
      );

      // Resolved here rather than from the delivery that echoes this back,
      // because the echo is dropped by the loop guard: a mention deevy wrote is
      // still a mention (`triggersFor`).
      const mentionedMemberIds = await resolveMentions(
        context.db,
        context.workspace.id,
        input.body,
      );
      await appendEvent(context, {
        kind: "comment.created",
        subjectType: "issue",
        subjectId: issue.id,
        projectId: issue.projectId,
        payload: {
          externalCommentId: ref.externalId,
          url: ref.url,
          body: input.body,
          mentionedMemberIds: mentionedMemberIds.filter((id) => id !== context.member.id),
        },
      });

      return {
        externalId: ref.externalId,
        url: ref.url,
        body: input.body,
        author: { login: row.identity.login, id: row.identity.id, isBot: true },
        createdAt: new Date(),
      };
    },
  }),
};
