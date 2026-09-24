import { channel as channelTable, channelKinds, type Channel, type Db } from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { appendEvent } from "../events.ts";
import { postSlackMessage } from "../slack.ts";
import { requireSocket, socketModuleFor } from "../sockets/registry.ts";
import { NoInput, defineOperation, type ContextFor } from "./registry.ts";
import { newId } from "../ids.ts";

/**
 * Channels: where Notifications are delivered (CONTEXT.md). Only Slack is
 * configured here. The inbox is every Human's and needs no row, so a Channel in
 * this namespace is a Slack incoming webhook, which posts a link, or a room in
 * a connected Slack app, where a Gate carries its two buttons (ADR-0025).
 *
 * None of these operations is open to an Agent (ADR-0004). Where Humans are
 * told things is administration, and an Agent never administers.
 */

/**
 * A Channel as the API hands it back. The incoming-webhook URL is a
 * credential — anyone holding it can post into the room — so it goes in and
 * never comes out, and the host stands in for it wherever a Human has to
 * recognise which Channel is which.
 */
const ChannelView = z.object({
  id: z.string(),
  kind: z.enum(channelKinds),
  name: z.string(),
  webhookHost: z.string().nullable(),
  /** For a room in a Slack app: the Socket it is in, and the conversation's id. */
  socketId: z.string().nullable(),
  conversation: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
});

/** Slack's webhook host, or null when the URL is unset or unparseable. */
function hostOf(config: Channel["config"]): string | null {
  const url = config?.webhookUrl;
  if (typeof url !== "string") return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function view(row: Channel) {
  const text = (key: string) =>
    typeof row.config?.[key] === "string" ? (row.config[key] as string) : null;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    webhookHost: hostOf(row.config),
    socketId: text("socketId"),
    conversation: text("conversation"),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

/** Slack refuses anything else, and an http URL would put the credential on the wire. */
const WebhookUrl = z.url().max(500).startsWith("https://");

async function requireChannel(db: Db, workspaceId: string, channelId: string): Promise<Channel> {
  const found = await db.query.channel.findFirst({ where: { id: channelId, workspaceId } });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Channel" });
  return found;
}

export const channels = {
  list: defineOperation({
    name: "channels.list",
    summary: "The Channels this Workspace delivers Notifications to",
    method: "GET",
    path: "/channels",
    auth: "admin",
    input: NoInput,
    output: z.object({ channels: z.array(ChannelView) }),
    handler: async ({ context }) => {
      const rows = await context.db.query.channel.findMany({
        where: { workspaceId: context.workspace.id },
        orderBy: { createdAt: "asc" },
      });
      return { channels: rows.map(view) };
    },
  }),

  create: defineOperation({
    name: "channels.create",
    summary: "Add a Slack incoming webhook as a Channel",
    method: "POST",
    path: "/channels",
    auth: "admin",
    input: z.object({
      /** What a Human calls it, usually the Slack channel: `#deevy`. */
      name: z.string().trim().min(1).max(120),
      webhookUrl: WebhookUrl,
    }),
    output: ChannelView,
    handler: async ({ input, context }) => {
      const id = newId("channel");
      const [row] = await context.db
        .insert(channelTable)
        .values({
          id,
          workspaceId: context.workspace.id,
          kind: "slack",
          name: input.name,
          config: { webhookUrl: input.webhookUrl },
          createdBy: context.member.id,
        })
        .returning();
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      // The Event carries the host, never the URL: the log is readable by
      // every Member, and the credential is not.
      await appendEvent(context, {
        kind: "channel.created",
        subjectType: "channel",
        subjectId: id,
        payload: { name: input.name, channelKind: "slack", webhookHost: hostOf(row.config) },
      });
      return view(row);
    },
  }),

  /**
   * A room in a connected Slack app. What a webhook cannot do, this can: a Gate
   * is posted with its two buttons and changed when somebody rules, wherever
   * they ruled (ADR-0025). The app has to be in the room, which Slack says in
   * the error the first message would get.
   */
  createInSocket: defineOperation({
    name: "channels.createInSocket",
    summary: "Add a room in a connected Slack app as a Channel",
    method: "POST",
    path: "/channels/in-socket",
    auth: "admin",
    input: z.object({
      /** What a Human calls it, usually the Slack channel: `#deevy`. */
      name: z.string().trim().min(1).max(120),
      socketId: z.string(),
      /** The conversation's own id in the tool: `C0123ABCD` in Slack. */
      conversation: z.string().trim().min(1).max(40),
    }),
    output: ChannelView,
    handler: async ({ input, context }) => {
      const socket = await context.db.query.socket.findFirst({
        where: { id: input.socketId, workspaceId: context.workspace.id },
      });
      if (!socket || socket.status === "removed" || !socket.capabilities.includes("chat")) {
        throw new ORPCError("NOT_FOUND", { message: "No such chat tool here" });
      }
      const id = newId("channel");
      const [row] = await context.db
        .insert(channelTable)
        .values({
          id,
          workspaceId: context.workspace.id,
          kind: "slack_app",
          name: input.name,
          config: { socketId: socket.id, conversation: input.conversation },
          createdBy: context.member.id,
        })
        .returning();
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      await appendEvent(context, {
        kind: "channel.created",
        subjectType: "channel",
        subjectId: id,
        payload: { name: input.name, channelKind: "slack_app", socketName: socket.name },
      });
      return view(row);
    },
  }),

  update: defineOperation({
    name: "channels.update",
    summary: "Rename a Channel, or point it at a new webhook",
    method: "PATCH",
    path: "/channels/{channelId}",
    auth: "admin",
    input: z.object({
      channelId: z.string(),
      name: z.string().trim().min(1).max(120).optional(),
      webhookUrl: WebhookUrl.optional(),
    }),
    output: ChannelView,
    handler: async ({ input, context }) => {
      const found = await requireChannel(context.db, context.workspace.id, input.channelId);
      const [row] = await context.db
        .update(channelTable)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.webhookUrl === undefined
            ? {}
            : { config: { ...found.config, webhookUrl: input.webhookUrl } }),
        })
        .where(eq(channelTable.id, found.id))
        .returning();
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      await appendEvent(context, {
        kind: "channel.updated",
        subjectType: "channel",
        subjectId: row.id,
        payload: {
          name: row.name,
          // Whether the credential changed is worth recording; what it changed
          // to is not.
          webhookChanged: input.webhookUrl !== undefined,
        },
      });
      return view(row);
    },
  }),

  delete: defineOperation({
    name: "channels.delete",
    summary: "Remove a Channel; the routing rules aimed at it go with it",
    method: "DELETE",
    path: "/channels/{channelId}",
    auth: "admin",
    input: z.object({ channelId: z.string() }),
    output: z.object({ deleted: z.literal(true) }),
    handler: async ({ input, context }) => {
      const found = await requireChannel(context.db, context.workspace.id, input.channelId);
      // The rules referencing it cascade (schema/channel.ts). Deliveries owed to
      // it do not: they carry no foreign key, and the sweep retires one whose
      // Channel is gone rather than sending it somewhere else.
      await context.db.delete(channelTable).where(eq(channelTable.id, found.id));
      await appendEvent(context, {
        kind: "channel.deleted",
        subjectType: "channel",
        subjectId: found.id,
        payload: { name: found.name },
      });
      return { deleted: true as const };
    },
  }),

  test: defineOperation({
    name: "channels.test",
    summary: "Post a message to this Channel now, to prove it works",
    method: "POST",
    path: "/channels/{channelId}/test",
    auth: "admin",
    input: z.object({ channelId: z.string() }),
    output: z.object({
      delivered: z.boolean(),
      status: z.number().int(),
      error: z.string().nullable(),
    }),
    handler: async ({ input, context }) => {
      const found = await requireChannel(context.db, context.workspace.id, input.channelId);
      if (found.kind === "slack_app") return testInSocket(context, found);
      const webhookUrl = found.config?.webhookUrl;
      if (typeof webhookUrl !== "string" || webhookUrl.length === 0) {
        throw new ORPCError("BAD_REQUEST", { message: "This Channel has no webhook URL" });
      }
      // Sent here and now rather than through a delivery row: the Human is
      // waiting for the answer, and a test message is owed to nobody if it
      // fails. It appends no Event either, because nothing changed.
      const posted = await postSlackMessage(webhookUrl, {
        text: `${context.workspace.name} is connected to this Channel.`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${context.workspace.name}* is connected to this Channel. Notifications routed here will arrive like this.`,
            },
          },
        ],
      });
      return { delivered: posted.delivered, status: posted.status, error: posted.error ?? null };
    },
  }),
};

/**
 * A room in a Slack app, tested the way it is used: the app posts, which is
 * also how an operator finds out the app was never invited into the room —
 * Slack says `not_in_channel`, and that is what this answers with.
 */
async function testInSocket(
  context: ContextFor<"admin">,
  found: Channel,
): Promise<{ delivered: boolean; status: number; error: string | null }> {
  const socketId = typeof found.config?.socketId === "string" ? found.config.socketId : "";
  const conversation =
    typeof found.config?.conversation === "string" ? found.config.conversation : "";
  try {
    const socket = await requireSocket(context, socketId);
    const chat = (await socketModuleFor(context, socket)).chat;
    if (!chat) throw new Error("That Socket is not a chat tool");
    await chat.post(conversation, {
      kind: "text",
      text: `${context.workspace.name} is connected to this room. A Gate routed here arrives with two buttons.`,
      link: null,
    });
    return { delivered: true, status: 200, error: null };
  } catch (error) {
    return {
      delivered: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
