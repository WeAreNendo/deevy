import { inboundDelivery, socket as socketTable, type Db, type Socket } from "@deevy/db";
import { eq, inArray } from "drizzle-orm";
import { newId } from "../ids.ts";
import type { JobQueue } from "../jobs.ts";
import { openSecret } from "../secrets.ts";
import { applyInbound } from "./apply.ts";
import type { SocketModules } from "./port.ts";
import { socketModuleFor } from "./registry.ts";

/**
 * `POST /hooks/:socketId` — the door a tool knocks on (ADR-0024).
 *
 * It is mounted before everything else in `app.ts` and builds no session: the
 * caller is a provider with a signature, not a Human with a cookie, and the
 * signature over the raw body is the whole of the authentication. The raw body
 * is therefore read first and once, because a framework that parsed it would
 * have changed the bytes the provider signed.
 *
 * The status codes are chosen for the machine on the other end rather than for
 * a reader. 401 for a signature that does not check out and 404 for a Socket
 * that does not exist, because both mean "stop sending this here"; 200 for
 * everything else, including a delivery deevy could not use, because a hook
 * that collects failures gets disabled by GitHub and silently stops a team's
 * work. What went wrong lives in `inbound_delivery` and in the log.
 */

export interface InboundOptions {
  db: Db;
  /** The Socket the URL named. */
  socketId: string;
  sockets?: SocketModules;
  /** The secret this deployment seals credentials with (secrets.ts). */
  socketSecret?: string;
  jobs?: JobQueue;
  now?: () => Date;
  fetch?: typeof fetch;
}

/** What applying a delivery came to, which is what the row records. */
export interface AppliedOutcome {
  status: "applied" | "skipped" | "failed";
  applied?: number;
  /** Why an event meant nothing, or what went wrong. Never a credential. */
  skipped?: string[];
}

/**
 * What deevy did with one delivery, which is also the body it answers. The two
 * statuses beyond applying are the ones decided before it: a redelivery, and a
 * Socket an operator has rested.
 */
export type InboundOutcome = AppliedOutcome | { status: "duplicate" | "paused" };

export async function handleInbound(request: Request, options: InboundOptions): Promise<Response> {
  const { db, socketId, now = () => new Date() } = options;
  // First, and once: every provider signs exactly these bytes.
  const rawBody = await request.text();

  const socket = await db.query.socket.findFirst({ where: { id: socketId } });
  if (!socket || socket.status === "removed") {
    return json({ error: "No such Socket" }, 404);
  }
  if (socket.status === "paused") {
    // Deliberately not a refusal: an operator resting a tool should not end up
    // with the provider deciding the hook is broken (`sockets.update`).
    return json({ status: "paused" }, 200);
  }

  const module = await socketModuleFor(options, socket);
  const tracker = module.tracker;
  if (!tracker) return json({ error: "This Socket does not take deliveries" }, 400);

  const webhookSecret = await webhookSecretOf(socket, options.socketSecret);
  if (webhookSecret === null) {
    return json({ error: "This Socket has no webhook secret to check a delivery against" }, 401);
  }

  const checked = await tracker.verifyInbound({
    headers: request.headers,
    rawBody,
    webhookSecret,
    now: now(),
  });
  if (!checked.ok) return json({ error: "That delivery is not signed by this Socket" }, 401);

  // The insert is the claim: a provider redelivering — by retry, by a button, or
  // because two deevy instances share a database — loses the race and is told
  // the delivery is already known, rather than opening a second Run.
  const [claimed] = await db
    .insert(inboundDelivery)
    .values({
      id: newId("inboundDelivery"),
      socketId: socket.id,
      // A provider that signs no delivery id gets one of deevy's own, which
      // makes every delivery unique and the replay guard a no-op for it.
      deliveryId: checked.deliveryId ?? `deevy-${newId("inboundDelivery")}`,
      eventName: checked.eventName,
    })
    .onConflictDoNothing()
    .returning();
  if (!claimed) return json({ status: "duplicate" }, 200);

  const outcome = await applyDelivery({ ...options, now }, socket, rawBody, checked.eventName);

  await db
    .update(inboundDelivery)
    .set({
      status: outcome.status,
      error: outcome.skipped?.length ? outcome.skipped.join("; ").slice(0, 2000) : null,
    })
    .where(eq(inboundDelivery.id, claimed.id));
  // What the catch-up poll reads: a Socket that has spoken recently is one
  // whose deliveries are arriving, so nothing needs to be gone looking for.
  await db.update(socketTable).set({ lastInboundAt: now() }).where(eq(socketTable.id, socket.id));

  return json(outcome, 200);
}

/**
 * Normalising and applying, with the one try/catch this file has.
 *
 * A body that is not what the provider's own documentation says, a record deevy
 * cannot place, a bug in a provider module: none of them is worth a 500, and
 * all of them are worth writing down.
 */
async function applyDelivery(
  options: InboundOptions & { now: () => Date },
  socket: Socket,
  rawBody: string,
  eventName: string,
): Promise<AppliedOutcome> {
  const workspace = await options.db.query.workspace.findFirst({
    where: { id: socket.workspaceId },
    columns: { id: true },
  });
  if (!workspace) return { status: "failed", skipped: ["This deevy has no Workspace yet"] };

  try {
    const module = await socketModuleFor(options, socket);
    const tracker = module.tracker;
    if (!tracker) return { status: "failed", skipped: ["This Socket is not a tracker"] };

    const events = tracker.normalize(eventName, JSON.parse(rawBody));
    const result = await applyInbound({
      db: options.db,
      workspace,
      socket,
      events,
      ...(options.jobs ? { jobs: options.jobs } : {}),
      now: options.now,
    });
    return {
      status: result.applied > 0 ? "applied" : "skipped",
      applied: result.applied,
      skipped: result.skipped,
    };
  } catch (error) {
    return { status: "failed", skipped: [String(error instanceof Error ? error.message : error)] };
  }
}

/** The shared secret, opened from the sealed column, or null when there is none. */
async function webhookSecretOf(socket: Socket, secret: string | undefined): Promise<string | null> {
  if (!socket.webhookSecret || !secret) return null;
  try {
    return await openSecret(secret, socket.webhookSecret);
  } catch {
    // A sealing secret that changed takes every Socket with it, and the
    // delivery is the wrong place to find out: the settings page says so.
    return null;
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Deliveries are kept for a month, which is longer than any provider retries. */
export const inboundRetentionMs = 30 * 24 * 60 * 60_000;

export interface ForgetDeliveriesOptions {
  db: Db;
  now?: Date;
  limit?: number;
}

/**
 * Forgets what a tool said long enough ago that no replay could still arrive.
 * Bounded like every other sweep, and appends nothing: a delivery nobody can
 * replay is not a Workspace event, it is bookkeeping (docs/plans/sockets.md).
 */
export async function forgetOldDeliveries({
  db,
  now = new Date(),
  limit = 50,
}: ForgetDeliveriesOptions): Promise<{ scanned: number; more: boolean }> {
  const cutoff = new Date(now.getTime() - inboundRetentionMs);
  const old = await db.query.inboundDelivery.findMany({
    where: { createdAt: { lt: cutoff } },
    columns: { id: true },
    limit,
  });
  if (old.length === 0) return { scanned: 0, more: false };
  await db.delete(inboundDelivery).where(
    inArray(
      inboundDelivery.id,
      old.map((row) => row.id),
    ),
  );
  return { scanned: old.length, more: old.length >= limit };
}
