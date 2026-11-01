/**
 * deevy's own delivery format: what the generic Socket takes from any tool's
 * adapter, and what the stub signs and reads (docs/plans/simplify.md, slice 7).
 *
 * A delivery is `{ "events": [...] }`, each event deevy's own `InboundEvent`
 * carrying its record or comment whole, so nothing is read back. It is signed
 * the way deevy signs its webhooks — `deevy-signature: t=<unix>,v1=<hex>`, an
 * HMAC-SHA256 of `<t>.<body>` (signature.ts in the core) — so one routine in
 * an adapter signs what it sends and verifies what deevy sends it. The format
 * is public (`tools/generic` on docs.deevy.dev), so the reader is strict and
 * says what it would not take, in the words the Socket's page shows.
 */
import {
  parseRulingCommand,
  signPayload,
  verifySignature,
  type InboundCheck,
  type InboundEvent,
  type InboundInput,
} from "@deevy/core/sockets";
import { z } from "zod";

/** The headers a delivery carries, as deevy's own webhooks name them. */
export const deliveryHeaders = {
  signature: "deevy-signature",
  /** The sender's id for it: the same one on a retry makes the retry a no-op. */
  delivery: "deevy-delivery",
  /** What the sender calls what happened, for the Socket's page. Optional. */
  event: "deevy-event",
} as const;

/** One delivery, ready to be POSTed at `/hooks/<socketId>`. */
export interface SignedDelivery {
  headers: Record<string, string>;
  body: string;
}

let signed = 0;

/**
 * Signs one delivery, as an adapter would. The events go as given: Dates
 * become the ISO strings JSON makes of them, which is what the reader takes.
 */
export async function signDelivery(
  secret: string,
  events: readonly unknown[],
  options: { deliveryId?: string; eventName?: string; now?: Date } = {},
): Promise<SignedDelivery> {
  signed += 1;
  const body = JSON.stringify({ events });
  return {
    headers: {
      "content-type": "application/json",
      [deliveryHeaders.signature]: await signPayload(secret, options.now ?? new Date(), body),
      [deliveryHeaders.delivery]: options.deliveryId ?? `delivery-${String(signed)}`,
      [deliveryHeaders.event]: options.eventName ?? "events",
    },
    body,
  };
}

/** Whether a delivery was signed with this secret, recently. Never throws. */
export async function verifyDelivery({
  headers,
  rawBody,
  webhookSecret,
  now,
}: InboundInput): Promise<InboundCheck> {
  const ok = await verifySignature({
    secret: webhookSecret,
    header: headers.get(deliveryHeaders.signature) ?? "",
    body: rawBody,
    ...(now ? { now } : {}),
  });
  return {
    ok,
    // An empty header is no id, or every delivery after it would be its repeat.
    deliveryId: headers.get(deliveryHeaders.delivery) || null,
    eventName: headers.get(deliveryHeaders.event) || "events",
  };
}

// What an event must carry. Lenient where deevy has a sensible default, so an
// adapter written by hand says only what its tool knows; strict where a wrong
// value would put something false in front of a Human.

/** A clock, as JSON carries one, given back as the Date deevy compares. */
const When = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
/** A link a Human may open: a web page, never a script. */
const Link = z.url({ protocol: /^https?$/ });
const Id = z.string().min(1);
const Account = z.object({ login: z.string(), id: Id });
const Actor = Account.extend({
  isBot: z.boolean().default(false),
  email: z.email().optional(),
});

const Issue = z
  .object({
    externalId: Id,
    key: z.string().min(1),
    url: Link,
    title: z.string(),
    // Absent, deevy keeps the body it had (port.ts).
    body: z.string().nullish(),
    state: z.enum(["open", "closed"]),
    stateName: z.string().optional(),
    assignees: z.array(Account).default([]),
    labels: z.array(z.string()).default([]),
    parentExternalId: Id.nullable().default(null),
    delegateId: Id.nullish(),
    updatedAt: When,
  })
  .transform(({ stateName, ...issue }) => ({ ...issue, stateName: stateName ?? issue.state }));

const Comment = z.object({
  externalId: Id,
  url: Link,
  body: z.string(),
  author: Actor,
  createdAt: When,
});

const events = {
  issue: z.object({
    kind: z.literal("issue"),
    scopeKey: z.string().min(1),
    issue: Issue,
    actor: Actor.nullable().default(null),
  }),
  // Found by its record's id, so the container is not read; said where it is.
  comment: z.object({
    kind: z.literal("comment"),
    scopeKey: z.string().default(""),
    issueExternalId: Id,
    comment: Comment,
  }),
  ruling: z.object({
    kind: z.literal("ruling"),
    scopeKey: z.string().default(""),
    issueExternalId: Id,
    comment: Comment,
    decision: z.enum(["approved", "rejected"]),
    note: z.string().nullable().default(null),
  }),
};

type Taken = keyof typeof events;

function isTaken(kind: unknown): kind is Taken {
  return typeof kind === "string" && Object.hasOwn(events, kind);
}

/** What was wrong, as `path: message`, the first three of it. */
function wrong(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join(".") || "the event"}: ${issue.message}`)
    .join("; ");
}

/**
 * The events a delivery carries, each in deevy's terms, or the reason one
 * could not be. A comment whose first line is `/approve` or `/reject` is a
 * Ruling, read as every tracker reads one (`parseRulingCommand`), so the
 * Socket can answer it rather than take it for chatter.
 */
export function readEvents(payload: unknown): InboundEvent[] {
  const list = (payload as { events?: unknown } | null)?.events;
  if (!Array.isArray(list)) {
    return [
      {
        kind: "ignored",
        why: 'A delivery is {"events": [...]}, and this one carries no list of events',
      },
    ];
  }
  return list.map((event: unknown, index): InboundEvent => {
    const at = `Event ${String(index + 1)}`;
    const kind = (event as { kind?: unknown } | null)?.kind;
    // What deevy itself would say to skip it, kept as said.
    if (kind === "ignored") {
      const why = (event as { why?: unknown }).why;
      return { kind: "ignored", why: typeof why === "string" ? why : `${at} said to ignore it` };
    }
    if (!isTaken(kind)) {
      return {
        kind: "ignored",
        why:
          typeof kind === "string"
            ? `${at} is \`${kind}\`, and deevy takes only issue, comment and ruling events`
            : `${at} has no kind`,
      };
    }
    const parsed = events[kind].safeParse(event);
    if (!parsed.success) {
      return {
        kind: "ignored",
        why: `${at} (${kind}) is not what deevy takes: ${wrong(parsed.error)}`,
      };
    }
    const read = parsed.data;
    if (read.kind !== "comment") return read;
    const ruling = parseRulingCommand(read.comment.body);
    return ruling ? { ...read, kind: "ruling", ...ruling } : read;
  });
}
