import { ORPCError } from "@orpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  inboundDelivery,
  socket as socketTable,
  socketProviders,
  socketStatuses,
  type Socket,
} from "@deevy/db";
import { InboundDeliverySchema, SocketSchema } from "../schemas.ts";
import { requireSealingSecret, sealSecret } from "../secrets.ts";
import {
  requireSocket,
  requireTracker,
  socketModuleFor,
  type SocketFor,
} from "../sockets/registry.ts";
import { appendEvent } from "../events.ts";
import { newId } from "../ids.ts";
import { defineOperation } from "./registry.ts";
import type { AppContext } from "./registry.ts";

/**
 * Connecting a tool (ADR-0024).
 *
 * Every operation here is an admin's, and none of them is a tool: an Agent
 * never administers (ADR-0004), and connecting a tool is the most administering
 * thing in deevy — it is where a credential enters.
 *
 * The credential goes in sealed and never comes back out. What an operator is
 * told once, at the moment deevy mints it, is the webhook secret, because they
 * have to paste it into the tool; after that deevy will say only that there is
 * one. `secrets.test.ts` holds the read surface to that.
 */

/** Everything a caller may see, plus the two facts about the sealed columns. */
function socketOut(row: Socket) {
  const { credentials, webhookSecret, ...rest } = row;
  return {
    ...rest,
    hasCredentials: credentials !== null,
    hasWebhookSecret: webhookSecret !== null,
  };
}

/**
 * Where the tool knocks. On this instance's own origin rather than the SPA's:
 * a provider posts to deevy's API, and a split-origin deployment would
 * otherwise send every delivery to a static site (`linkOrigin` is the other
 * decision, for links a Human opens).
 */
function inboundUrl(context: Pick<AppContext, "baseURL">, socketId: string): string {
  return `${(context.baseURL ?? "").replace(/\/+$/, "")}/hooks/${socketId}`;
}

/** What a provider signs with, when deevy is the one that decides it. */
function mintWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `whsec_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Seals one value, refusing first when this deployment has no secret to seal with. */
function seal(context: Pick<AppContext, "socketSecret">, value: string): Promise<string> {
  return sealSecret(requireSealingSecret(context.socketSecret), value);
}

const ConnectedSocketSchema = SocketSchema.extend({
  inboundUrl: z.string(),
  /**
   * Said once, and only when deevy minted it: an operator has to paste it into
   * the tool, and after this response deevy will never say it again.
   */
  webhookSecret: z.string().nullable(),
});

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
      return { sockets: rows.map(socketOut) };
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
      /** What this deevy authenticates as. Sealed on the way in, never read back. */
      credentials: z.record(z.string(), z.string()).optional(),
      /** What the tool signs its deliveries with, where the tool decides it. */
      webhookSecret: z.string().trim().min(8).max(500).optional(),
      /** Ask this tool every so often, for an instance the tool cannot reach. */
      pollMinutes: z.number().int().min(1).max(1440).optional(),
    }),
    output: ConnectedSocketSchema,
    handler: async ({ input, context }) => {
      // Built before the row exists, so a credential that does not work is a
      // refusal rather than a Socket nobody can use.
      const module = await socketModuleFor(
        { ...context, socketSecret: context.socketSecret },
        { provider: input.provider, config: input.config },
      );
      const identity = await module.identity();

      const sealed = {
        ...(input.credentials
          ? { credentials: await seal(context, JSON.stringify(input.credentials)) }
          : {}),
        ...(input.webhookSecret ? { webhookSecret: await seal(context, input.webhookSecret) } : {}),
      };

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
          ...(input.pollMinutes === undefined ? {} : { pollMinutes: input.pollMinutes }),
          ...sealed,
        })
        .returning();
      if (!row) throw new Error("sockets.connect: the insert returned no row");

      await appendEvent(context, {
        kind: "socket.connected",
        subjectType: "socket",
        subjectId: row.id,
        payload: { provider: row.provider, name: row.name, login: identity.login },
      });
      return {
        ...socketOut(row),
        inboundUrl: inboundUrl(context, row.id),
        // Nothing to say back: the operator chose this one and already has it.
        webhookSecret: null,
      };
    },
  }),

  update: defineOperation({
    name: "sockets.update",
    summary: "Rename a tool, rest it, or ask it on a schedule",
    method: "POST",
    path: "/sockets/{socketId}",
    auth: "admin",
    input: z.object({
      socketId: z.string(),
      name: z.string().trim().min(1).max(120).optional(),
      /** `paused` keeps everything and stops acting on what the tool says. */
      status: z.enum(socketStatuses).exclude(["removed"]).optional(),
      pollMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    }),
    output: SocketSchema,
    handler: async ({ input, context }) => {
      const found = await context.db.query.socket.findFirst({ where: { id: input.socketId } });
      if (!found || found.status === "removed" || found.workspaceId !== context.workspace.id) {
        throw new ORPCError("NOT_FOUND", { message: "No such Socket" });
      }

      const changes = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.pollMinutes === undefined ? {} : { pollMinutes: input.pollMinutes }),
      };
      const [row] = await context.db
        .update(socketTable)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(socketTable.id, found.id))
        .returning();
      if (!row) throw new Error("sockets.update: the update returned no row");

      await appendEvent(context, {
        kind: "socket.updated",
        subjectType: "socket",
        subjectId: row.id,
        payload: { name: row.name, ...changes },
      });
      return socketOut(row);
    },
  }),

  rotate: defineOperation({
    name: "sockets.rotate",
    summary: "Mint a new webhook secret for a tool, and say it once",
    method: "POST",
    path: "/sockets/{socketId}/rotate",
    auth: "admin",
    input: z.object({ socketId: z.string() }),
    output: z.object({
      socket: SocketSchema,
      /** The only response that carries it. Paste it into the tool now. */
      webhookSecret: z.string(),
      inboundUrl: z.string(),
    }),
    handler: async ({ input, context }) => {
      const found = await requireSocket(context, input.socketId);
      const minted = mintWebhookSecret();
      const [row] = await context.db
        .update(socketTable)
        .set({ webhookSecret: await seal(context, minted), updatedAt: new Date() })
        .where(eq(socketTable.id, found.id))
        .returning();
      if (!row) throw new Error("sockets.rotate: the update returned no row");

      await appendEvent(context, {
        kind: "socket.updated",
        subjectType: "socket",
        subjectId: row.id,
        // What changed, never what it changed to.
        payload: { name: row.name, webhookSecret: "rotated" },
      });
      return {
        socket: socketOut(row),
        webhookSecret: minted,
        inboundUrl: inboundUrl(context, row.id),
      };
    },
  }),

  containers: defineOperation({
    name: "sockets.containers",
    summary: "What a Project could be bound to inside this tool",
    method: "GET",
    path: "/sockets/{socketId}/containers",
    auth: "admin",
    input: z.object({ socketId: z.string() }),
    output: z.object({
      containers: z.array(
        z.object({
          scope: z.record(z.string(), z.unknown()),
          scopeKey: z.string(),
          name: z.string(),
        }),
      ),
    }),
    handler: async ({ input, context }) => {
      const row = await requireSocket(context, input.socketId);
      const tracker = requireTracker(await socketModuleFor(context as SocketFor, row));
      return { containers: await tracker.listContainers() };
    },
  }),

  test: defineOperation({
    name: "sockets.test",
    summary: "Ask the tool who deevy is there, which proves the credential still works",
    method: "POST",
    path: "/sockets/{socketId}/test",
    auth: "admin",
    input: z.object({ socketId: z.string() }),
    output: z.object({
      ok: z.boolean(),
      identity: z.object({ login: z.string(), id: z.string(), mentionHandle: z.string() }),
    }),
    handler: async ({ input, context }) => {
      const row = await requireSocket(context, input.socketId);
      const module = await socketModuleFor(context as SocketFor, row);
      // An account renamed on the tool's side is a thing that happens, and the
      // loop guard reads this, so what comes back is what is kept.
      const identity = await module.identity();
      await context.db
        .update(socketTable)
        .set({ identity, updatedAt: new Date() })
        .where(eq(socketTable.id, row.id));
      return { ok: true, identity };
    },
  }),

  inbound: defineOperation({
    name: "sockets.inbound",
    summary: "What this tool has said lately, and what deevy made of it",
    method: "GET",
    path: "/sockets/{socketId}/inbound",
    auth: "admin",
    input: z.object({ socketId: z.string(), limit: z.number().int().min(1).max(100).default(50) }),
    output: z.object({ deliveries: z.array(InboundDeliverySchema) }),
    handler: async ({ input, context }) => {
      const row = await requireSocket(context, input.socketId);
      const deliveries = await context.db
        .select()
        .from(inboundDelivery)
        .where(eq(inboundDelivery.socketId, row.id))
        .orderBy(desc(inboundDelivery.createdAt))
        .limit(input.limit);
      return { deliveries };
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
        // The credential goes with the connection: a removed Socket is a row
        // that keeps history, not one that keeps a way in.
        .set({ status: "removed", credentials: null, webhookSecret: null, updatedAt: new Date() })
        .where(eq(socketTable.id, found.id))
        .returning();
      if (!row) throw new Error("sockets.remove: the update returned no row");

      await appendEvent(context, {
        kind: "socket.removed",
        subjectType: "socket",
        subjectId: row.id,
        payload: { provider: row.provider, name: row.name },
      });
      return socketOut(row);
    },
  }),
};
