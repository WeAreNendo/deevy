import { eq } from "drizzle-orm";
import { z } from "zod";
import { workspace as workspaceTable } from "@deevy/db";
import { slugify } from "../handles.ts";
import { WorkspaceSchema } from "../schemas.ts";
import { appendEvent } from "../events.ts";
import { NoInput, defineOperation } from "./registry.ts";

export const workspace = {
  get: defineOperation({
    name: "workspace.get",
    summary: "The Workspace this instance serves",
    method: "GET",
    path: "/workspace",
    auth: "member",
    input: NoInput,
    output: WorkspaceSchema,
    handler: async ({ context }) => context.workspace,
  }),

  update: defineOperation({
    name: "workspace.update",
    summary: "Rename the Workspace this instance serves, and set what an Agent may not go past",
    method: "PATCH",
    path: "/workspace",
    auth: "admin",
    input: z.object({
      name: z.string().trim().min(1).max(120).optional(),
      /**
       * The three ceilings on delegation (docs/plans/sub-issue-delegation.md).
       * Left out, each keeps what it has: a client written before they existed
       * cannot widen one by saving the Workspace, the way a Gate's threshold is
       * kept from widening by accident.
       */
      maxChildrenPerIssue: z.number().int().min(1).max(500).optional(),
      maxDelegationDepth: z.number().int().min(1).max(20).optional(),
      maxOpenDescendants: z.number().int().min(1).max(2_000).optional(),
    }),
    output: WorkspaceSchema,
    handler: async ({ input, context }) => {
      const renamed = input.name !== undefined && input.name !== context.workspace.name;
      const limits = {
        ...(input.maxChildrenPerIssue === undefined
          ? {}
          : { maxChildrenPerIssue: input.maxChildrenPerIssue }),
        ...(input.maxDelegationDepth === undefined
          ? {}
          : { maxDelegationDepth: input.maxDelegationDepth }),
        ...(input.maxOpenDescendants === undefined
          ? {}
          : { maxOpenDescendants: input.maxOpenDescendants }),
      };
      if (!renamed && Object.keys(limits).length === 0) return context.workspace;

      const [row] = await context.db
        .update(workspaceTable)
        .set({
          ...(renamed && input.name ? { name: input.name, slug: slugify(input.name) } : {}),
          ...limits,
        })
        .where(eq(workspaceTable.id, context.workspace.id))
        .returning();
      await appendEvent(context, {
        kind: "workspace.updated",
        subjectType: "workspace",
        subjectId: context.workspace.id,
        payload: {
          ...(renamed ? { from: context.workspace.name, to: input.name } : {}),
          ...limits,
        },
      });
      return row ?? context.workspace;
    },
  }),
};
