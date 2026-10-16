/**
 * Signed webhooks: how deevy tells a URL that something happened (ADR-0003).
 *
 * deevy never runs an Agent, so a trigger is a POST the Agent's runtime has to
 * be able to trust. The signature is the whole of that trust, and it is plain
 * HMAC-SHA256 over the timestamp and the body so a receiver can verify it in
 * ten lines in any language, with no SDK.
 *
 * Web-standard only (ADR-0006): `crypto.subtle`, never `node:crypto`.
 */
import {
  delivery,
  member,
  projectGrant,
  webhookSubscription,
  type Db,
  type Event,
} from "@deevy/db";
import { and, eq, isNull } from "drizzle-orm";
import type { FetchLike } from "./slack.ts";
import { newId } from "./ids.ts";

/** How long a signed body stays acceptable, so a captured POST cannot be replayed later. */
export const replayWindowSeconds = 5 * 60;

/** HMAC-SHA256 over `<unix seconds>.<body>`, which is what the header commits to. */
async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The `deevy-signature` header for one body: `t=<unix seconds>,v1=<hex>`.
 *
 * The timestamp is inside the signed message rather than beside it, so it
 * cannot be moved forward to keep an old body alive.
 */
export async function signPayload(secret: string, timestamp: Date, body: string): Promise<string> {
  const seconds = Math.floor(timestamp.getTime() / 1000);
  return `t=${seconds},v1=${await hmac(secret, `${seconds}.${body}`)}`;
}

export interface VerifyInput {
  /** The subscription's secret, which only deevy and the receiver hold. */
  secret: string;
  /** The `deevy-signature` header as it arrived. */
  header: string;
  /** The raw body, exactly as it was read off the wire. */
  body: string;
  /** The receiver's clock. */
  now?: Date;
  /** How old a signature may be. Beyond it, the POST is a replay. */
  toleranceSeconds?: number;
}

/**
 * What a receiver does with the header, written here because deevy has to be
 * able to say what "verifies" means and because a reference implementation
 * belongs beside the signer.
 *
 * It never throws: a malformed header is a refusal like any other.
 */
export async function verifySignature({
  secret,
  header,
  body,
  now = new Date(),
  toleranceSeconds = replayWindowSeconds,
}: VerifyInput): Promise<boolean> {
  const parts = new Map(
    header
      .split(",")
      .map((part) => part.trim().split("="))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([key, value]) => [key as string, value as string]),
  );
  const timestamp = Number(parts.get("t"));
  const signature = parts.get("v1");
  if (!signature || !Number.isFinite(timestamp)) return false;

  const age = Math.abs(Math.floor(now.getTime() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  return equal(signature, await hmac(secret, `${timestamp}.${body}`));
}

/**
 * Compares in time that does not depend on where the two differ, so a receiver
 * cannot be walked to the right signature one byte at a time.
 */
function equal(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let at = 0; at < left.length; at += 1) {
    difference |= left.charCodeAt(at) ^ right.charCodeAt(at);
  }
  return difference === 0;
}

/**
 * The deliveries one Event owes the URLs that asked for it, written in the
 * tail of `appendEvent` beside the Notifications (docs/plans/m2.md).
 *
 * The row is the record and the job queue is only a hint, so a timer that dies
 * loses nothing: the next sweep finds exactly what this wrote. Nothing is
 * copied out of the Event, because the Event is the source (ADR-0003) and a
 * copy is a second one that can disagree with it.
 *
 * Three statements at most whatever the Workspace holds: the enabled
 * subscriptions, which `webhook_subscription_workspace_idx` answers and of
 * which a Workspace has a handful; the grants of the Agents among them, when
 * there are any; and one multi-row insert.
 */
export async function deriveWebhookDeliveries(db: Db, event: Event): Promise<string[]> {
  return deriveWebhookDeliveriesForMany(db, event.workspaceId, [event]);
}

/** How many delivery rows one insert carries; D1 caps bound parameters at 100. */
const deliveryRowsPerInsert = 16;

/**
 * The same derivation for a batch of Events, so a sweep that writes its Events
 * straight to the log still owes what a subscription asked for.
 *
 * A sweep cannot go through `appendEvent`, because one append per row would
 * make its cost the Workspace rather than its limit. That made the Events it
 * writes undeliverable until this existed, which is the kind of thing that
 * only shows up when one slice adds a step to a tail another slice skips.
 *
 * Bounded the same way the sweeps are: one read of the subscriptions, one of
 * the grants when an Agent holds one of them, then chunked inserts.
 */
export async function deriveWebhookDeliveriesForMany(
  db: Db,
  workspaceId: string,
  events: Array<Pick<Event, "seq" | "kind" | "projectId" | "workspaceId">>,
): Promise<string[]> {
  if (events.length === 0) return [];
  const subscriptions = await db
    .select({
      id: webhookSubscription.id,
      kinds: webhookSubscription.kinds,
      projectId: webhookSubscription.projectId,
      memberId: webhookSubscription.memberId,
      memberKind: member.kind,
    })
    .from(webhookSubscription)
    .leftJoin(member, eq(member.id, webhookSubscription.memberId))
    .where(
      and(eq(webhookSubscription.workspaceId, workspaceId), isNull(webhookSubscription.disabledAt)),
    );
  if (subscriptions.length === 0) return [];
  const grants = await agentGrants(db, workspaceId, subscriptions);

  const rows = events.flatMap((event) =>
    subscriptions
      .filter((subscription) => wants(subscription, event))
      .filter((subscription) => sees(grants, subscription, event))
      .map((subscription) => ({
        id: newId("delivery"),
        workspaceId,
        target: "webhook" as const,
        targetId: subscription.id,
        eventSeq: event.seq,
        recipientMemberId: null,
      })),
  );
  // At most one attempt owed per subscription per Event, which the unique
  // index makes true rather than this being the only writer careful enough to
  // keep it (docs/plans/m3.md). A derivation that runs a second time — a
  // retried request, a queue message delivered again — owes nothing new.
  const written: string[] = [];
  for (let at = 0; at < rows.length; at += deliveryRowsPerInsert) {
    const inserted = await db
      .insert(delivery)
      .values(rows.slice(at, at + deliveryRowsPerInsert))
      .onConflictDoNothing()
      .returning({ id: delivery.id });
    for (const row of inserted) written.push(row.id);
  }
  // The ids the insert really wrote, not the ids it was offered: a derivation
  // that ran a second time hands back nothing, so nothing is enqueued for a
  // delivery something else is already carrying (events.ts).
  return written;
}

/**
 * The Projects each Agent among the subscriptions was granted, in one read
 * whatever the batch holds. Joined through the subscriptions rather than
 * listing the Agents' ids, so the statement binds the Workspace and nothing
 * that grows with it (D1 caps bound parameters at 100).
 *
 * Every Agent that holds a subscription has an entry, an empty one when it was
 * granted nothing, so that "no grants" reads as "sees nothing" and never as
 * "not scoped".
 */
async function agentGrants(
  db: Db,
  workspaceId: string,
  subscriptions: Array<{ memberId: string | null; memberKind: string | null }>,
): Promise<Map<string, Set<string>>> {
  const grants = new Map<string, Set<string>>();
  for (const subscription of subscriptions) {
    if (subscription.memberKind === "agent" && subscription.memberId) {
      grants.set(subscription.memberId, new Set());
    }
  }
  if (grants.size === 0) return grants;
  const rows = await db
    .selectDistinct({ memberId: projectGrant.memberId, projectId: projectGrant.projectId })
    .from(projectGrant)
    .innerJoin(webhookSubscription, eq(webhookSubscription.memberId, projectGrant.memberId))
    .where(
      and(eq(webhookSubscription.workspaceId, workspaceId), isNull(webhookSubscription.disabledAt)),
    );
  for (const row of rows) grants.get(row.memberId)?.add(row.projectId);
  return grants;
}

/**
 * Whether the Member a subscription belongs to may see this Event at all,
 * which is a wall where `wants` is a filter. An Agent sees only the Projects
 * it was granted, and an ungranted Project does not exist to it
 * (`projectVisible`, ADR-0004), so its webhook is owed nothing from one — and
 * nothing that belongs to no Project, because a Workspace's own Events
 * (Members, invitations, Sockets) are administration, which an Agent never
 * reads. A generic subscriber is the Workspace's; a subscription can only be
 * made for an Agent, and one naming a Human would see what a Human sees,
 * which is every Project.
 */
function sees(
  grants: Map<string, Set<string>>,
  subscription: { memberId: string | null },
  event: Pick<Event, "projectId">,
): boolean {
  const granted = subscription.memberId ? grants.get(subscription.memberId) : undefined;
  if (!granted) return true;
  return event.projectId !== null && granted.has(event.projectId);
}

/**
 * Whether a subscription asked for this Event. A null filter is "everything",
 * in both directions: no kinds means every kind, no Project means every
 * Project, which is what a generic subscriber wants and what an Agent's own
 * runtime usually narrows.
 *
 * A kind may be written `run.*`, which is every kind in that family. Event
 * kinds are `<subject>.<verb>` (events.ts) and a subscriber almost always
 * wants a subject rather than a verb, so without the wildcard every new kind
 * added to a family would silently miss the subscriptions that wanted it.
 */
export function wants(
  subscription: { kinds: string[] | null; projectId: string | null },
  event: Pick<Event, "kind" | "projectId">,
): boolean {
  if (subscription.projectId !== null && subscription.projectId !== event.projectId) return false;
  if (subscription.kinds === null) return true;
  return subscription.kinds.some((wanted) =>
    wanted.endsWith(".*") ? event.kind.startsWith(wanted.slice(0, -1)) : wanted === event.kind,
  );
}

/**
 * The body a receiver gets: the Event row itself, and nothing else. It is
 * rendered here rather than stored when the delivery is derived, because the
 * Event log is the source (ADR-0003) and a copy taken hours earlier could
 * disagree with it.
 */
export function webhookBody(event: Event): string {
  return JSON.stringify({
    seq: event.seq,
    kind: event.kind,
    workspaceId: event.workspaceId,
    projectId: event.projectId,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    actorMemberId: event.actorMemberId,
    payload: event.payload,
    createdAt: event.createdAt.toISOString(),
  });
}

/** What one POST to a subscribed URL came back with. */
export interface WebhookPostResult {
  delivered: boolean;
  status: number;
  /** What the receiver said when it refused, for the delivery row to quote. */
  error?: string;
}

export interface PostWebhookInput {
  url: string;
  secret: string;
  event: Event;
  /** Named in a header so a receiver can recognise a retry of what it already has. */
  deliveryId: string;
  now: Date;
  fetch?: FetchLike;
}

/**
 * Posts one Event to a subscribed URL. It never throws: a receiver being down
 * is an outcome the caller retries, not an error that unwinds the pass.
 */
export async function postWebhook({
  url,
  secret,
  event,
  deliveryId,
  now,
  fetch: fetchImpl = fetch,
}: PostWebhookInput): Promise<WebhookPostResult> {
  const body = webhookBody(event);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "deevy-signature": await signPayload(secret, now, body),
        // Retries carry the same delivery id, so a receiver that has already
        // acted on this Event can recognise it rather than act twice.
        "deevy-delivery": deliveryId,
        "deevy-event": String(event.seq),
      },
      body,
    });
    if (response.ok) return { delivered: true, status: response.status };
    const error = await response.text().catch(() => "");
    return { delivered: false, status: response.status, error: error.slice(0, 200) };
  } catch (failure) {
    return {
      delivered: false,
      status: 0,
      error: failure instanceof Error ? failure.message : "the request did not complete",
    };
  }
}
