import type { Db, Socket } from "@deevy/db";
import { ORPCError } from "@orpc/server";
import type { ForgeSocket, Scope, SocketModule, SocketModules, TrackerSocket } from "./port.ts";

/**
 * Turning a Socket row into something that can be asked a question.
 *
 * The registry is injected (`createApp({ sockets })`), so the core holds the
 * port and never a provider (ADR-0024). A row whose provider this deployment
 * was not built with is a refusal rather than a crash: an operator who removed
 * a provider from their build should be told which Socket they orphaned.
 */

export interface SocketFor {
  db: Db;
  sockets?: SocketModules;
  now?: () => Date;
  fetch?: typeof fetch;
}

/**
 * Builds the module for one Socket. Takes what it actually reads rather than
 * the whole row, so `sockets.connect` can prove a credential before there is a
 * row to prove it against.
 */
export function socketModuleFor(
  context: SocketFor,
  row: Pick<Socket, "provider" | "config">,
): SocketModule {
  const make = context.sockets?.[row.provider];
  if (!make) {
    throw new ORPCError("NOT_IMPLEMENTED", {
      message: `This deevy was not built with the ${row.provider} Socket`,
    });
  }
  return make({
    config: row.config,
    credentials: {},
    fetch: context.fetch ?? globalThis.fetch,
    now: context.now ?? (() => new Date()),
  });
}

/** The Socket row a Project's tracker binding names, refusing a paused one. */
export async function requireSocket(context: SocketFor, socketId: string): Promise<Socket> {
  const row = await context.db.query.socket.findFirst({ where: { id: socketId } });
  if (!row || row.status === "removed") {
    throw new ORPCError("NOT_FOUND", { message: "No such Socket" });
  }
  if (row.status === "paused") {
    throw new ORPCError("CONFLICT", { message: `The ${row.name} Socket is paused` });
  }
  return row;
}

/** What a tracker-shaped question needs, or the refusal that says why not. */
export function requireTracker(module: SocketModule): TrackerSocket {
  if (!module.tracker) {
    throw new ORPCError("BAD_REQUEST", {
      message: `The ${module.provider} Socket is not a tracker`,
    });
  }
  return module.tracker;
}

export function requireForge(module: SocketModule): ForgeSocket {
  if (!module.forge) {
    throw new ORPCError("BAD_REQUEST", {
      message: `The ${module.provider} Socket is not a repository`,
    });
  }
  return module.forge;
}

/**
 * One container, in one string.
 *
 * It is stored beside the scope rather than derived on read, because an inbound
 * delivery has to find its Project in one indexed lookup and comparing JSON is
 * not that. The shape is the provider's own words, so two providers never
 * collide: `gh:acme/deevy`, `linear:team:ENG`, `stub:DEV`.
 */
export function scopeKeyOf(provider: string, scope: Scope): string {
  const named = scope.scopeKey;
  if (typeof named === "string" && named.length > 0) return `${provider}:${named}`;
  throw new ORPCError("BAD_REQUEST", { message: "That scope names no container" });
}
