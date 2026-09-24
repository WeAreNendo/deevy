import { eq } from "drizzle-orm";
import { z } from "zod";
import { socket as socketTable, socketProviders } from "@deevy/db";
import { SocketSchema } from "../schemas.ts";
import { requireSocket, socketModuleFor } from "../sockets/registry.ts";
import { appendEvent } from "../events.ts";
import { newId } from "../ids.ts";
import { defineOperation } from "./registry.ts";

/**
 * Connecting a tool (ADR-0024).
 *
 * Slice 0 carries no credentials: the only provider it can speak is the stub,
 * which is in-process and holds nothing. Sealing, the webhook secret and the
 * providers that need both arrive with `secrets.ts` in the next slice, and
 * until they do there is no window where a secret sits in the database in
 * plaintext — because there is no secret.
 */
export const sockets = {
  list: defineOperation({
    name: "sockets.list",
    summary: "The tools this Workspace is connected to",
    method: "GET",
    path: "/sockets",
    auth: "admin",
    input: z.object({}),
    output: z.object({ sockets: z.array(SocketSchema) }),
    handler: async ({ context }) => {
      const rows = await context.db.query.socket.findMany({
        where: { workspaceId: context.workspace.id, status: { ne: "removed" } },
        orderBy: { createdAt: "asc" },
      });
      return { sockets: rows };
    },
  }),

  connect: defineOperation({
    name: "sockets.connect",
    summary: "Connect a tool, proving the connection by asking who deevy is there",
    method: "POST",
    path: "/sockets",
    auth: "admin",
    input: z.object({
      provider: z.enum(socketProviders),
      name: z.string().trim().min(1).max(120),
      /** Everything about the connection that is not a secret. */
      config: z.record(z.string(), z.unknown()).default({}),
    }),
    output: SocketSchema,
    handler: async ({ input, context }) => {
      // Built before the row exists, so a credential that does not work is a
      // refusal rather than a Socket nobody can use.
      const module = socketModuleFor(context, {
        provider: input.provider,
        config: input.config,
      });
      const identity = await module.identity();

      const [row] = await context.db
        .insert(socketTable)
        .values({
          id: newId("socket"),
          workspaceId: context.workspace.id,
          provider: input.provider,
          capabilities: [...module.capabilities],
          name: input.name,
          identity,
          config: input.config,
          installedBy: context.member.id,
        })
        .returning();
      if (!row) throw new Error("sockets.connect: the insert returned no row");

      await appendEvent(context, {
        kind: "socket.connected",
        subjectType: "socket",
        subjectId: row.id,
        payload: { provider: row.provider, name: row.name, login: identity.login },
      });
      return row;
    },
  }),

  remove: defineOperation({
    name: "sockets.remove",
    summary: "Disconnect a tool, leaving what it projected readable",
    method: "POST",
    path: "/sockets/{socketId}/remove",
    auth: "admin",
    input: z.object({ socketId: z.string() }),
    output: SocketSchema,
    handler: async ({ input, context }) => {
      const found = await requireSocket(context, input.socketId);
      const [row] = await context.db
        .update(socketTable)
        .set({ status: "removed", updatedAt: new Date() })
        .where(eq(socketTable.id, found.id))
        .returning();
      if (!row) throw new Error("sockets.remove: the update returned no row");

      await appendEvent(context, {
        kind: "socket.removed",
        subjectType: "socket",
        subjectId: row.id,
        payload: { provider: row.provider, name: row.name },
      });
      return row;
    },
  }),
};
