import { eq } from "drizzle-orm";
import { z } from "zod";
import { project as projectTable } from "@deevy/db";
import { createProject } from "../projects.ts";
import { ProjectSchema } from "../schemas.ts";
import { requireSocket, scopeKeyOf, socketModuleFor } from "../sockets/registry.ts";
import { ORPCError } from "@orpc/server";
import { appendEvent } from "../events.ts";
import { defineOperation, type ContextFor } from "./registry.ts";
import {
  ProjectSlug,
  ProjectSlugLookup,
  QueryFlag,
  grantProject,
  loadProject,
  requireProject,
  requireProjectOrAdmin,
} from "./shared.ts";

/** A binding as a caller states one: a Socket, and the container inside it. */
const BindingInput = z.object({
  socketId: z.string(),
  /**
   * The container: one the provider's own `listContainers` offered, or, for a
   * tool that lists none, `{ scopeKey }` with the key an admin typed.
   */
  scope: z.record(z.string(), z.unknown()),
});

/**
 * An Agent of this Workspace, or nobody: a record routed to a Human or to a
 * stranger by default would be one nothing ever picks up.
 */
async function requireDefaultAgent(context: ContextFor<"member">, memberId: string) {
  const agent = await context.db.query.member.findFirst({
    where: { id: memberId, workspaceId: context.workspace.id, kind: "agent" },
    columns: { id: true },
  });
  if (!agent) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The default has to be one of this Workspace's Agents",
    });
  }
}

export const projects = {
  list: defineOperation({
    name: "projects.list",
    summary: "The Projects in this Workspace, and what each is bound to",
    method: "GET",
    path: "/projects",
    auth: "member",
    agents: true,
    input: z.object({
      /** Archived Projects are left out unless asked for. */
      includeArchived: QueryFlag.default(false),
    }),
    output: z.object({ projects: z.array(ProjectSchema) }),
    handler: async ({ input, context }) => {
      const rows = await context.db.query.project.findMany({
        where: {
          workspaceId: context.workspace.id,
          ...(input.includeArchived ? {} : { archivedAt: { isNull: true } }),
          ...(context.grantedProjectIds ? { id: { in: context.grantedProjectIds } } : {}),
        },
        orderBy: { createdAt: "asc" },
      });
      return { projects: rows };
    },
  }),

  get: defineOperation({
    name: "projects.get",
    summary: "One Project by its slug: where its Issues come from and who works them",
    method: "GET",
    path: "/projects/{slug}",
    auth: "member",
    agents: true,
    // A tool so an Agent can learn what it is bound to without asking a Human.
    mcp: true,
    input: z.object({ slug: ProjectSlugLookup }),
    output: ProjectSchema,
    handler: async ({ input, context }) => {
      // Through requireProject rather than a query of its own: the grant check
      // lives there, and an operation that reads the table directly is how an
      // ungranted Project becomes readable (docs/plans/m2.md).
      const found = await requireProject(context, input.slug);
      return loadProject(context.db, found.id);
    },
  }),

  update: defineOperation({
    name: "projects.update",
    summary: "Rename a Project, or change who gets its work and how a record names an Agent",
    method: "PATCH",
    path: "/projects/{slug}",
    auth: "member",
    input: z.object({
      slug: ProjectSlugLookup,
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().max(4000).nullish(),
      /** Who gets an open record no label and no mention named. */
      defaultAgentMemberId: z.string().nullish(),
      /*
       * The tracker binding is not changeable: a Project is the container its
       * records come from, and pointing it at another one would orphan every
       * projection under it (ADR-0024). Where its code and its documents are,
       * deevy does not hold (ADR-0034, docs/plans/simplify.md slice 4), and
       * what it says in the tracker is a Gate and its Ruling, always.
       */
      /** How a record says which Agent it is for: a label prefix, a mention, or neither. */
      routing: z
        .object({
          labelPrefix: z.string().trim().max(40),
          /** Whether a comment that mentions an Agent starts its work (`triggersFor`). */
          mention: z.boolean(),
        })
        .optional(),
    }),
    output: ProjectSchema,
    handler: async ({ input, context }) => {
      const found = await requireProjectOrAdmin(context, input.slug);

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (input.name !== undefined && input.name !== found.name) {
        changes.name = { from: found.name, to: input.name };
      }
      if (input.description !== undefined && input.description !== found.description) {
        changes.description = { from: found.description, to: input.description ?? null };
      }
      if (input.defaultAgentMemberId) {
        await requireDefaultAgent(context, input.defaultAgentMemberId);
      }
      if (
        input.defaultAgentMemberId !== undefined &&
        input.defaultAgentMemberId !== found.defaultAgentMemberId
      ) {
        changes.defaultAgentMemberId = {
          from: found.defaultAgentMemberId,
          to: input.defaultAgentMemberId ?? null,
        };
      }
      if (input.routing !== undefined) {
        changes.routing = { from: found.routing, to: input.routing };
      }
      if (Object.keys(changes).length === 0) return loadProject(context.db, found.id);

      await context.db
        .update(projectTable)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description ?? null }),
          ...(input.defaultAgentMemberId === undefined
            ? {}
            : { defaultAgentMemberId: input.defaultAgentMemberId ?? null }),
          ...(input.routing === undefined ? {} : { routing: input.routing }),
        })
        .where(eq(projectTable.id, found.id));
      await appendEvent(context, {
        kind: "project.updated",
        subjectType: "project",
        subjectId: found.id,
        projectId: found.id,
        payload: changes,
      });
      // Choosing an Agent as the default is letting it see the Project: after
      // the change, so the log reads in the order it happened.
      if (input.defaultAgentMemberId && changes.defaultAgentMemberId) {
        await grantProject(context, input.defaultAgentMemberId, found);
      }
      return loadProject(context.db, found.id);
    },
  }),

  archive: defineOperation({
    name: "projects.archive",
    summary: "Close a Project down; it stays readable and keeps what it projected",
    method: "POST",
    path: "/projects/{slug}/archive",
    auth: "admin",
    input: z.object({ slug: ProjectSlugLookup }),
    output: ProjectSchema,
    handler: async ({ input, context }) => {
      const found = await requireProject(context, input.slug);
      if (found.archivedAt) return loadProject(context.db, found.id);

      await context.db
        .update(projectTable)
        .set({ archivedAt: new Date() })
        .where(eq(projectTable.id, found.id));
      await appendEvent(context, {
        kind: "project.archived",
        subjectType: "project",
        subjectId: found.id,
        projectId: found.id,
        payload: { slug: found.slug },
      });
      return loadProject(context.db, found.id);
    },
  }),

  create: defineOperation({
    name: "projects.create",
    summary: "Bind a container in a Socket to a Project an Agent can be granted",
    method: "POST",
    path: "/projects",
    auth: "admin",
    input: z.object({
      slug: ProjectSlug,
      name: z.string().trim().min(1).max(120),
      description: z.string().max(4000).nullish(),
      /** Where this Project's Issues come from. Without one it has nothing to work. */
      tracker: BindingInput,
      defaultAgentMemberId: z.string().nullish(),
    }),
    output: ProjectSchema,
    handler: async ({ input, context }) => {
      const taken = await context.db.query.project.findFirst({
        where: { workspaceId: context.workspace.id, slug: input.slug },
      });
      if (taken) {
        throw new ORPCError("CONFLICT", { message: `Another Project already uses ${input.slug}` });
      }

      const socket = await requireSocket(context, input.tracker.socketId);
      const module = await socketModuleFor(context, socket);
      if (!module.tracker) {
        throw new ORPCError("BAD_REQUEST", {
          message: `The ${socket.name} Socket is not a tracker`,
        });
      }
      const trackerScopeKey = scopeKeyOf(socket.provider, input.tracker.scope);
      const bound = await context.db.query.project.findFirst({
        where: { trackerSocketId: socket.id, trackerScopeKey },
      });
      if (bound) {
        throw new ORPCError("CONFLICT", {
          message: `${bound.name} is already bound to that container`,
        });
      }
      if (input.defaultAgentMemberId) {
        await requireDefaultAgent(context, input.defaultAgentMemberId);
      }

      const created = await createProject(context.db, {
        workspaceId: context.workspace.id,
        slug: input.slug,
        name: input.name,
        description: input.description,
        trackerSocketId: socket.id,
        trackerScope: input.tracker.scope,
        trackerScopeKey,
        defaultAgentMemberId: input.defaultAgentMemberId,
      });
      await appendEvent(context, {
        kind: "project.created",
        subjectType: "project",
        subjectId: created.id,
        projectId: created.id,
        payload: { slug: created.slug, name: created.name, trackerScopeKey },
      });
      // As in `projects.update`: a default is granted the Project, after the
      // Event that made it, or every record routed to it would wait forever.
      if (input.defaultAgentMemberId) {
        await grantProject(context, input.defaultAgentMemberId, created);
      }
      return loadProject(context.db, created.id);
    },
  }),
};
