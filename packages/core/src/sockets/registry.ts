import type { Db, Socket } from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { openSecret } from "../secrets.ts";
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
  /** What this deployment seals credentials with, so a module can be given them. */
  socketSecret?: string;
  now?: () => Date;
  fetch?: typeof fetch;
}

/**
 * Builds the module for one Socket. Takes what it actually reads rather than
 * the whole row, so `sockets.connect` can prove a credential before there is a
 * row to prove it against.
 *
 * Asynchronous because opening the credentials is: they are sealed in the
 * column, and the only way to a provider's API is through them (secrets.ts).
 */
export async function socketModuleFor(
  context: SocketFor,
  row: Pick<Socket, "provider" | "config"> & { credentials?: string | null },
): Promise<SocketModule> {
  const make = context.sockets?.[row.provider];
  if (!make) {
    throw new ORPCError("NOT_IMPLEMENTED", {
      message: `This deevy was not built with the ${row.provider} Socket`,
    });
  }
  return make({
    config: row.config,
    credentials: await openCredentials(row.credentials, context.socketSecret),
    fetch: context.fetch ?? globalThis.fetch,
    now: context.now ?? (() => new Date()),
  });
}

/**
 * The credentials a module is built with. A Socket that holds none — the stub,
 * or a provider whose whole credential is its webhook secret — gets an empty
 * record rather than a refusal.
 */
export async function openCredentials(
  sealed: string | null | undefined,
  secret: string | undefined,
): Promise<Record<string, string>> {
  if (!sealed) return {};
  if (!secret) {
    throw new ORPCError("NOT_IMPLEMENTED", {
      message:
        "This deevy has no secret to open a Socket's credentials with, so it cannot use one. Set one on the server and restart.",
    });
  }
  try {
    const opened: unknown = JSON.parse(await openSecret(secret, sealed));
    return opened && typeof opened === "object" ? (opened as Record<string, string>) : {};
  } catch {
    throw new ORPCError("CONFLICT", {
      message:
        "deevy cannot open this Socket's credentials. Its secret changed, so connect the tool again.",
    });
  }
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
  if (row.status === "pending") {
    throw new ORPCError("CONFLICT", {
      message: `The ${row.name} Socket is not connected yet; finish connecting it first`,
    });
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
