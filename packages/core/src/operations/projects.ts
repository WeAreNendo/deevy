import { eq } from "drizzle-orm";
import { z } from "zod";
import { project as projectTable } from "@deevy/db";
import { createProject } from "../projects.ts";
import { ProjectSchema } from "../schemas.ts";
import { requireSocket, scopeKeyOf, socketModuleFor } from "../sockets/registry.ts";
import { ORPCError } from "@orpc/server";
import { appendEvent } from "../events.ts";
import { defineOperation } from "./registry.ts";
import {
  ProjectSlug,
  ProjectSlugLookup,
  QueryFlag,
  loadProject,
  requireProject,
  requireProjectOrAdmin,
} from "./shared.ts";

/** A binding as a caller states one: a Socket, and the container inside it. */
const BindingInput = z.object({
  socketId: z.string(),
  /** The container the provider's own `listContainers` offered. */
  scope: z.record(z.string(), z.unknown()),
});

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
    summary: "One Project by its slug: where its Issues come from and where its code is",
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
    summary: "Rename a Project, or change how much deevy says back in its tracker",
    method: "PATCH",
    path: "/projects/{slug}",
    auth: "member",
    input: z.object({
      slug: ProjectSlugLookup,
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().max(4000).nullish(),
      /** Who gets an open record no label and no mention named. */
      defaultAgentMemberId: z.string().nullish(),
      mirror: z.enum(["off", "gates", "runs"]).optional(),
      /**
       * Where its code is, or null to say it has none here. The tracker
       * binding is not changeable: a Project is the container its records come
       * from, and pointing it at another one would orphan every projection
       * under it (ADR-0024).
       */
      forge: BindingInput.nullish(),
      /** How a record says which Agent it is for: a label prefix, a mention, or neither. */
      routing: z
        .object({
          labelPrefix: z.string().trim().max(40),
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
      if (
        input.defaultAgentMemberId !== undefined &&
        input.defaultAgentMemberId !== found.defaultAgentMemberId
      ) {
        changes.defaultAgentMemberId = {
          from: found.defaultAgentMemberId,
          to: input.defaultAgentMemberId ?? null,
        };
      }
      if (input.mirror !== undefined && input.mirror !== found.mirror) {
        changes.mirror = { from: found.mirror, to: input.mirror };
      }
      if (input.forge !== undefined) {
        // A forge Socket has to exist and be connected before a Run is sent to
        // clone from it.
        if (input.forge) await requireSocket(context, input.forge.socketId);
        changes.forge = {
          from: found.forgeSocketId,
          to: input.forge?.socketId ?? null,
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
          ...(input.mirror === undefined ? {} : { mirror: input.mirror }),
          ...(input.forge === undefined
            ? {}
            : input.forge
              ? { forgeSocketId: input.forge.socketId, forgeScope: input.forge.scope }
              : { forgeSocketId: null, forgeScope: null }),
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
      /** Where its code is, when an Agent working it should have a checkout. */
      forge: BindingInput.optional(),
      docs: BindingInput.optional(),
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
      if (input.forge) await requireSocket(context, input.forge.socketId);
      if (input.docs) await requireSocket(context, input.docs.socketId);

      const created = await createProject(context.db, {
        workspaceId: context.workspace.id,
        slug: input.slug,
        name: input.name,
        description: input.description,
        trackerSocketId: socket.id,
        trackerScope: input.tracker.scope,
        trackerScopeKey,
        forgeSocketId: input.forge?.socketId ?? null,
        forgeScope: input.forge?.scope ?? null,
        docsSocketId: input.docs?.socketId ?? null,
        docsScope: input.docs?.scope ?? null,
        defaultAgentMemberId: input.defaultAgentMemberId,
      });
      await appendEvent(context, {
        kind: "project.created",
        subjectType: "project",
        subjectId: created.id,
        projectId: created.id,
        payload: { slug: created.slug, name: created.name, trackerScopeKey },
      });
      return loadProject(context.db, created.id);
    },
  }),
};
