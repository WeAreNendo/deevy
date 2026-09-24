import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { requireSocket, socketModuleFor } from "../sockets/registry.ts";
import { defineOperation } from "./registry.ts";
import { ProjectSlugLookup, requireProject } from "./shared.ts";

/**
 * A Project's documents, read where they live (ADR-0024).
 *
 * deevy keeps no Documents: a team's plans stay in their own tool, and the
 * Project's docs binding says which Socket reads them. This is how an Agent
 * reads one — a page named by its URL or its id, answered as markdown — and it
 * sees only what the tool shows deevy, in a Project it was granted.
 */
export const DocPageSchema = z.object({
  title: z.string(),
  markdown: z.string(),
  url: z.string(),
});

export const docs = {
  get: defineOperation({
    name: "docs.get",
    summary: "Read a page from where this Project's documents live, as markdown",
    method: "GET",
    path: "/projects/{project}/docs",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({
      /** The Project whose documents to read from, by its slug. */
      project: ProjectSlugLookup,
      /** The page: its URL, or the tool's own id for it. */
      page: z.string().trim().min(1).max(2000),
    }),
    output: DocPageSchema,
    handler: async ({ input, context }) => {
      const project = await requireProject(context, input.project);
      if (!project.docsSocketId) {
        throw new ORPCError("NOT_FOUND", {
          message: "This Project has no documents bound; an admin binds them in its settings",
        });
      }
      const socket = await requireSocket(context, project.docsSocketId);
      const reader = (await socketModuleFor(context, socket)).docs;
      if (!reader) {
        throw new ORPCError("NOT_FOUND", { message: `${socket.name} cannot read documents` });
      }
      const ref = /^https?:\/\//i.test(input.page)
        ? { url: input.page }
        : { externalId: input.page };
      try {
        return await reader.readPage(ref);
      } catch (error) {
        // Most often a page nobody shared with deevy, which the tool reports as
        // not there: said as the tool said it, for whoever asked to fix.
        throw new ORPCError("NOT_FOUND", {
          message: `${socket.name} would not show that page: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  }),
};
