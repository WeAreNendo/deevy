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
import { accountCallbackUrl } from "../account-links.ts";
import { InboundDeliverySchema, SocketSchema } from "../schemas.ts";
import { openSecret, requireSealingSecret, sealSecret, signState } from "../secrets.ts";
import {
  requireSocket,
  requireTracker,
  socketModuleFor,
  type SocketFor,
} from "../sockets/registry.ts";
import type { SocketModule } from "../sockets/port.ts";
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

/**
 * What a provider can do, asked of a module built with nothing in it: a module
 * says its own capabilities, and no Socket row is touched.
 */
function capabilitiesOf(
  context: Pick<AppContext, "sockets">,
  provider: (typeof socketProviders)[number],
): ("tracker" | "forge" | "docs" | "chat")[] {
  const module = context.sockets?.[provider]?.({
    config: {},
    credentials: {},
    fetch: globalThis.fetch,
    now: () => new Date(),
  });
  return [...(module?.capabilities ?? [])];
}

/**
 * Who deevy is on the tool, or a refusal an admin can read.
 *
 * A tool that will not answer has refused the credential, and that is the
 * admin's to hear in the tool's own words — not a 500 with the reason in the
 * server's log, which is what Linear's refusal of a client id it never issued
 * was until the Linear check.
 */
async function provenIdentity(module: SocketModule, provider: string) {
  try {
    return await module.identity();
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    const why = error instanceof Error ? error.message : String(error);
    throw new ORPCError("BAD_REQUEST", {
      message: `${providerLabels[provider] ?? provider} would not take these credentials: ${why}`,
    });
  }
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

/**
 * What this instance signs a redirect's `state` with. Better Auth's secret,
 * which every deployment already has, rather than a second one to configure:
 * nothing is sealed with it, and rotating it only ends redirects in flight.
 */
function requireInstanceSecret(context: Pick<AppContext, "secret">): string {
  const secret = context.secret;
  if (!secret) {
    throw new ORPCError("NOT_IMPLEMENTED", {
      message:
        "This deevy has no secret to sign a redirect with, so it cannot start that flow. Set one on the server and restart.",
    });
  }
  return secret;
}

const ConnectedSocketSchema = SocketSchema.extend({
  inboundUrl: z.string(),
  /**
   * Said once, and only when deevy minted it: an operator has to paste it into
   * the tool, and after this response deevy will never say it again.
   */
  webhookSecret: z.string().nullable(),
});

/**
 * What each provider is called on screen, and what a Socket of that kind can
 * be asked for. A screen reads this rather than carrying its own list, so a
 * build without a provider offers no button whose only outcome is a refusal.
 */
const providerLabels: Record<string, string> = {
  github: "GitHub",
  linear: "Linear",
  gitlab: "GitLab",
  notion: "Notion",
  slack: "Slack",
  stub: "the stub tracker",
};

export const sockets = {
  providers: defineOperation({
    name: "sockets.providers",
    summary: "The tools this deevy was built to speak",
    method: "GET",
    path: "/sockets/providers",
    auth: "admin",
    input: z.object({}),
    output: z.object({
      providers: z.array(
        z.object({
          id: z.enum(socketProviders),
          label: z.string(),
          capabilities: z.array(z.enum(["tracker", "forge", "docs", "chat"])),
        }),
      ),
    }),
    handler: ({ context }) => {
      const built = Object.keys(context.sockets ?? {}) as (typeof socketProviders)[number][];
      return Promise.resolve({
        providers: built.sort().map((id) => ({
          id,
          label: providerLabels[id] ?? id,
          capabilities: capabilitiesOf(context, id),
        })),
      });
    },
  }),

  list: defineOperation({
    name: "sockets.list",
    summary: "The tools this Workspace is connected to",
    method: "GET",
    path: "/sockets",
    auth: "admin",
    input: z.object({}),
    output: z.object({
      // Each with where it delivers, which is not a secret and is the one thing
      // an operator re-pastes when this deevy's address moves.
      sockets: z.array(SocketSchema.extend({ inboundUrl: z.string() })),
    }),
    handler: async ({ context }) => {
      const rows = await context.db.query.socket.findMany({
        where: { workspaceId: context.workspace.id, status: { ne: "removed" } },
        orderBy: { createdAt: "asc" },
      });
      return {
        sockets: rows.map((row) => ({
          ...socketOut(row),
          inboundUrl: inboundUrl(context, row.id),
        })),
      };
    },
  }),

  begin: defineOperation({
    name: "sockets.begin",
    summary: "Start connecting a tool whose own flow has to send you back here",
    method: "POST",
    path: "/sockets/begin",
    auth: "admin",
    input: z.object({
      provider: z.enum(socketProviders),
      name: z.string().trim().min(1).max(120),
      config: z.record(z.string(), z.unknown()).default({}),
    }),
    output: ConnectedSocketSchema.extend({
      /** Where the provider sends the operator back to, code in hand. */
      setupUrl: z.string(),
      /**
       * Where the tool sends a Human back to after they link their own account
       * on it, for a tool that links accounts through its own consent page
       * (account-links.ts). Its OAuth app has to list this beside `setupUrl`.
       */
      accountCallbackUrl: z.string(),
      /**
       * What the provider must echo back on that redirect. Signed with this
       * instance's own secret and good for an hour, so what lands can be shown
       * to have started here (secrets.ts).
       */
      state: z.string(),
    }),
    handler: async ({ input, context }) => {
      // A Socket with nothing in it yet: connecting a GitHub App means sending
      // an operator to GitHub and back, and this row is where they land. What
      // it can do is the provider's, and known already: the redirect that
      // makes it live writes a credential, never what the Socket is for.
      const [row] = await context.db
        .insert(socketTable)
        .values({
          id: newId("socket"),
          workspaceId: context.workspace.id,
          provider: input.provider,
          capabilities: capabilitiesOf(context, input.provider),
          name: input.name,
          identity: { login: "", id: "", mentionHandle: "" },
          config: input.config,
          installedBy: context.member.id,
          status: "pending",
        })
        .returning();
      if (!row) throw new Error("sockets.begin: the insert returned no row");

      return {
        ...socketOut(row),
        inboundUrl: inboundUrl(context, row.id),
        setupUrl: `${inboundUrl(context, row.id)}/setup`,
        accountCallbackUrl: accountCallbackUrl(context, row.provider),
        webhookSecret: null,
        state: await signState(requireInstanceSecret(context), row.id),
      };
    },
  }),

  rewire: defineOperation({
    name: "sockets.rewire",
    summary: "Point a tool's own webhook at this deevy's address, after the address moved",
    method: "POST",
    path: "/sockets/{socketId}/rewire",
    auth: "admin",
    input: z.object({ socketId: z.string() }),
    output: z.object({ inboundUrl: z.string() }),
    handler: async ({ input, context }) => {
      const socket = await requireSocket(context, input.socketId);
      if (socket.workspaceId !== context.workspace.id) {
        throw new ORPCError("NOT_FOUND", { message: "No such Socket" });
      }
      const module = await socketModuleFor(context, socket);
      const url = inboundUrl(context, socket.id);
      if (!module.rewire) {
        throw new ORPCError("BAD_REQUEST", {
          message: `${socket.name} does not let deevy say where it delivers; paste ${url} into its webhook settings`,
        });
      }
      await module.rewire(url);
      await appendEvent(context, {
        kind: "socket.updated",
        subjectType: "socket",
        subjectId: socket.id,
        payload: {
          provider: socket.provider,
          name: socket.name,
          summary: `Pointed its webhook at ${url}`,
        },
      });
      return { inboundUrl: url };
    },
  }),

  handshake: defineOperation({
    name: "sockets.handshake",
    summary: "Show the token a tool sent to verify its webhook, to paste back into it",
    method: "GET",
    path: "/sockets/{socketId}/handshake",
    auth: "admin",
    input: z.object({ socketId: z.string() }),
    output: z.object({
      /**
       * What the tool sent, while nothing signed with it has arrived; null
       * before it sends one, and once a delivery has proved it (hooks.ts).
       */
      token: z.string().nullable(),
      verified: z.boolean(),
    }),
    handler: async ({ input, context }) => {
      const socket = await context.db.query.socket.findFirst({
        where: { id: input.socketId, workspaceId: context.workspace.id },
      });
      if (!socket || socket.status === "removed") {
        throw new ORPCError("NOT_FOUND", { message: "No such Socket" });
      }
      const verified = socket.config.webhookVerified === true;
      // Shown only while it is the one thing standing between the tool and a
      // working webhook: after that it is a secret like any other.
      if (verified || socket.config.webhookVerified !== false || !socket.webhookSecret) {
        return { token: null, verified };
      }
      const token = await openSecret(
        requireSealingSecret(context.socketSecret),
        socket.webhookSecret,
      );
      return { token, verified };
    },
  }),

  install: defineOperation({
    name: "sockets.install",
    summary: "Give a connected tool's app more than its credential could, on the tool's own page",
    method: "POST",
    path: "/sockets/{socketId}/install",
    auth: "admin",
    input: z.object({ socketId: z.string() }),
    output: z.object({
      /** Where to send the admin's browser. It comes back to the setup route. */
      url: z.string(),
    }),
    handler: async ({ input, context }) => {
      const socket = await context.db.query.socket.findFirst({
        where: { id: input.socketId, workspaceId: context.workspace.id },
      });
      if (!socket || socket.status === "removed") {
        throw new ORPCError("NOT_FOUND", { message: "No such Socket" });
      }
      const module = await socketModuleFor(context, socket);
      if (!module.install) {
        throw new ORPCError("NOT_FOUND", { message: `${socket.name} has nothing to install` });
      }
      // Signed for this Socket, as `sockets.begin`'s is: the setup route will
      // spend the code it comes back with only on a state it can verify.
      return {
        url: module.install({
          redirectUri: `${inboundUrl(context, socket.id)}/setup`,
          state: await signState(requireInstanceSecret(context), socket.id),
        }),
      };
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
      /**
       * A Socket `sockets.begin` started, to complete rather than to connect a
       * second one: Slack wants the request URL in the app's own manifest, and
       * the URL names the Socket, so the row exists before its credential.
       */
      socketId: z.string().optional(),
    }),
    output: ConnectedSocketSchema,
    handler: async ({ input, context }) => {
      const pending = input.socketId
        ? await context.db.query.socket.findFirst({
            where: { id: input.socketId, workspaceId: context.workspace.id },
          })
        : null;
      if (input.socketId && (!pending || pending.provider !== input.provider)) {
        throw new ORPCError("NOT_FOUND", { message: "No such Socket" });
      }
      if (pending && pending.status !== "pending") {
        throw new ORPCError("CONFLICT", { message: "That Socket is already connected" });
      }

      const sealed = {
        ...(input.credentials
          ? { credentials: await seal(context, JSON.stringify(input.credentials)) }
          : {}),
        ...(input.webhookSecret ? { webhookSecret: await seal(context, input.webhookSecret) } : {}),
      };
      const config = { ...pending?.config, ...input.config };
      // Built before the row is written, and with the credential the operator
      // pasted, so a credential that does not work is a refusal rather than a
      // Socket nobody can use.
      const module = await socketModuleFor(
        { ...context, socketSecret: context.socketSecret },
        { provider: input.provider, config, credentials: sealed.credentials ?? null },
      );
      // What proving the credential taught deevy that is not a secret — a
      // Slack team's id — goes in the configuration, not the identity.
      const { learned, ...identity } = await provenIdentity(module, input.provider);

      const values = {
        capabilities: [...module.capabilities],
        name: input.name,
        identity,
        config: { ...config, ...learned },
        ...(input.pollMinutes === undefined ? {} : { pollMinutes: input.pollMinutes }),
        ...sealed,
      };
      const [row] = pending
        ? await context.db
            .update(socketTable)
            .set({ ...values, status: "active", updatedAt: new Date() })
            .where(eq(socketTable.id, pending.id))
            .returning()
        : await context.db
            .insert(socketTable)
            .values({
              id: newId("socket"),
              workspaceId: context.workspace.id,
              provider: input.provider,
              installedBy: context.member.id,
              ...values,
            })
            .returning();
      if (!row) throw new Error("sockets.connect: the write returned no row");

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
      /**
       * Take the address a tool reports as proof of which Member commented,
       * matched against one a Member verified. For a tool with nothing better
       * to offer — Notion — and off by default, because everywhere else an
       * account id is the proof and an address is a weaker one (ADR-0025).
       */
      identityByEmail: z.boolean().optional(),
      /**
       * The secret the tool signs with, where the tool is where it is
       * rotated — Slack's signing secret. The one it replaces is still taken
       * for a day, so a rotation done in two places in either order drops
       * nothing (ADR-0025).
       */
      webhookSecret: z.string().trim().min(8).max(500).optional(),
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
      const config =
        input.identityByEmail === undefined
          ? null
          : { ...found.config, identityByEmail: input.identityByEmail };
      const secrets =
        input.webhookSecret === undefined
          ? {}
          : {
              webhookSecret: await seal(context, input.webhookSecret),
              previousWebhookSecret: found.webhookSecret,
              webhookSecretChangedAt: new Date(),
            };
      const [row] = await context.db
        .update(socketTable)
        .set({ ...changes, ...(config ? { config } : {}), ...secrets, updatedAt: new Date() })
        .where(eq(socketTable.id, found.id))
        .returning();
      if (!row) throw new Error("sockets.update: the update returned no row");

      await appendEvent(context, {
        kind: "socket.updated",
        subjectType: "socket",
        subjectId: row.id,
        payload: {
          name: row.name,
          ...changes,
          ...(input.identityByEmail === undefined
            ? {}
            : { identityByEmail: input.identityByEmail }),
          // That it changed, and never what to.
          ...(input.webhookSecret === undefined ? {} : { webhookSecretReplaced: true }),
        },
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
      const { learned, ...identity } = await provenIdentity(module, row.provider);
      await context.db
        .update(socketTable)
        .set({
          identity,
          // A team renamed on the tool's side, learned the same way it was at connect.
          ...(learned ? { config: { ...row.config, ...learned } } : {}),
          updatedAt: new Date(),
        })
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
      // Whatever state it is in: a paused Socket is still one an admin may
      // take away, and one that never finished connecting — refused by the
      // tool, or its App never made — is otherwise in the list for good.
      // `requireSocket` refuses both, rightly, for anything that uses one.
      const found = await context.db.query.socket.findFirst({
        where: { id: input.socketId, workspaceId: context.workspace.id, status: { ne: "removed" } },
      });
      if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Socket" });
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
