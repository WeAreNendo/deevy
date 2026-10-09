import { delivery as deliveryTable, event as eventTable, type Db, type Event } from "@deevy/db";
import { inArray } from "drizzle-orm";
import type { EventKind } from "../events.ts";
import {
  gateRequestIdOf,
  isHumanNotificationKind,
  issueOf,
  notificationKindOf,
} from "../notifications.ts";
import {
  claimDeliveries,
  dueDeliveries,
  eventsOf,
  recordOutcomes,
  retireDeliveries,
  type Attempted,
  type Backoff,
} from "../outbox.ts";
import { chatGateMessage } from "../sockets/chat-out.ts";
import {
  parseFrom,
  type EmailMessage,
  type EmailSender,
  type EmailSenders,
  type EmailSetup,
} from "./port.ts";
import { renderEmail } from "./render.ts";

/**
 * The email arm of the outbox (docs/plans/email-channel.md), beside Slack, the
 * chat tools, the trackers and the webhooks, with their claim, their backoff
 * and their retirement. What is its own: which sender is in force, what an
 * email says, and that a refusal waiting cannot fix is given up on at once
 * rather than tried six times.
 */

/** Emails one pass may send. Sent one at a time: every service rate-limits. */
export const defaultEmailLimit = 20;

/** Attempts before an email is given up on: about a quarter of an hour, like Slack. */
export const maxEmailAttempts = 6;

/** 30s, 1m, 2m, 4m, 8m. A Gate that waits an hour for its email has waited too long. */
const emailBackoff: Backoff = { firstMs: 30_000, ceilingMs: 60 * 60_000, jitter: true };

export interface ResolveSenderOptions {
  /** The senders this runtime can run. */
  emailSenders?: EmailSenders;
  /** The sender in force: Settings › Email's, else the environment's. */
  email?: EmailSetup | null;
  fetch?: typeof fetch;
}

/** The sender in force, or why there is none, in words an admin can act on. */
export function resolveSender({
  emailSenders = {},
  email,
  fetch: fetchImpl = fetch,
}: ResolveSenderOptions): { sender: EmailSender; setup: EmailSetup } | { reason: string } {
  if (!email) return { reason: "No email sender is configured." };
  const factory = emailSenders[email.sender];
  if (!factory) {
    return { reason: `The ${email.sender} sender cannot run on this deployment.` };
  }
  try {
    return {
      sender: factory({ config: email.config, credentials: email.credentials, fetch: fetchImpl }),
      setup: email,
    };
  } catch (failure) {
    return { reason: failure instanceof Error ? failure.message : String(failure) };
  }
}

export interface DeliverDueEmailsOptions extends ResolveSenderOptions {
  db: Db;
  workspaceId: string;
  /** Where a Human opens deevy: every email links back into it. */
  baseUrl: string;
  now?: Date;
  limit?: number;
  maxAttempts?: number;
}

export interface EmailDeliveryResult {
  scanned: number;
  delivered: number;
  failed: number;
  gaveUp: number;
  more: boolean;
}

export async function deliverDueEmails({
  db,
  workspaceId,
  baseUrl,
  now = new Date(),
  limit = defaultEmailLimit,
  maxAttempts = maxEmailAttempts,
  ...senderOptions
}: DeliverDueEmailsOptions): Promise<EmailDeliveryResult> {
  const result: EmailDeliveryResult = {
    scanned: 0,
    delivered: 0,
    failed: 0,
    gaveUp: 0,
    more: false,
  };
  const due = await dueDeliveries(db, ["email_member"], { workspaceId, now, limit, maxAttempts });
  result.more = due.length >= limit;
  if (due.length === 0) return result;
  const claimed = await claimDeliveries(
    db,
    due.map((row) => row.id),
    now,
  );
  result.scanned = claimed.length;
  if (claimed.length === 0) return result;

  // Without a sender nothing is kept waiting for one: a sender configured next
  // week must not send a week of stale Gates in one go. The inbox still has
  // every one of them.
  const resolved = resolveSender(senderOptions);
  if ("reason" in resolved) {
    await retireDeliveries(
      db,
      claimed.map((row) => row.id),
      resolved.reason,
      maxAttempts,
    );
    result.gaveUp = claimed.length;
    return result;
  }
  const { sender, setup } = resolved;
  const from = parseFrom(setup.from);

  // The rows the emails are rendered from, each in one batched read.
  const eventBySeq = await eventsOf(db, claimed);
  const events = [...eventBySeq.values()];
  const workspace = await db.query.workspace.findFirst({
    where: { id: workspaceId },
    columns: { name: true },
  });
  const members = await db.query.member.findMany({
    where: { id: { in: [...new Set(claimed.map((row) => row.targetId))] }, workspaceId },
    columns: { id: true, suspendedAt: true },
    with: { user: { columns: { email: true, emailVerified: true } } },
  });
  const memberById = new Map(members.map((row) => [row.id, row]));
  const gateOf = (event: Event): string | null =>
    event.subjectType === "gate" ? event.subjectId : gateRequestIdOf(event);
  const gateIds = [...new Set(events.map(gateOf).filter((id): id is string => id !== null))];
  const gates = gateIds.length
    ? await db.query.gateRequest.findMany({
        where: { id: { in: gateIds } },
        with: {
          issue: { columns: { externalKey: true, url: true } },
          run: { with: { agent: { with: { user: { columns: { name: true } } } } } },
          checkpointPolicy: { columns: { approvalsRequired: true } },
          decisions: {
            with: {
              socket: { columns: { provider: true } },
              member: { with: { user: { columns: { name: true } } } },
            },
          },
        },
      })
    : [];
  const gateById = new Map(gates.map((row) => [row.id, row]));
  // Whether a Run still waits on its answer: an email, unlike a Slack
  // message, cannot be changed once it is read, so one about a wait that is
  // over is not sent at all.
  const askingRunIds = [
    ...new Set(
      events
        .filter((event) => event.kind === "run.awaiting_input" && event.subjectType === "run")
        .map((event) => event.subjectId),
    ),
  ];
  const runs = askingRunIds.length
    ? await db.query.run.findMany({
        where: { id: { in: askingRunIds } },
        columns: { id: true, status: true },
      })
    : [];
  const runStatus = new Map(runs.map((row) => [row.id, row.status]));
  const issueIds = [...new Set(events.map(issueOf).filter((id): id is string => id !== null))];
  const issues = issueIds.length
    ? await db.query.issue.findMany({
        where: { id: { in: issueIds } },
        columns: { id: true, externalKey: true, title: true, url: true },
      })
    : [];
  const issueById = new Map(issues.map((row) => [row.id, row]));

  const undeliverable: string[] = [];
  /** Emails about a wait that ended before they went: nothing failed, so no Event. */
  const settled: string[] = [];
  const attempted: Attempted[] = [];
  /** Refusals no wait will change, with what the sender said. */
  const hopeless = new Map<string, Attempted>();
  const sentEvent = new Map<string, Event>();
  for (const row of claimed) {
    const event = eventBySeq.get(row.eventSeq);
    const member = memberById.get(row.targetId);
    const kind = event ? notificationKindOf(event) : null;
    // A Member who left, was suspended, or whose address is no longer one the
    // sign-in vouches for is sent nothing, now or later.
    if (
      !event ||
      !kind ||
      !isHumanNotificationKind(kind) ||
      !member ||
      member.suspendedAt ||
      !member.user.emailVerified
    ) {
      undeliverable.push(row.id);
      continue;
    }
    const issueId = issueOf(event);
    const issue = issueId ? issueById.get(issueId) : undefined;
    const gateId = gateOf(event);
    const gate = gateId ? gateById.get(gateId) : undefined;
    if (
      (kind === "gate_awaiting" && gate?.status !== "open") ||
      (kind === "run_awaiting_input" && runStatus.get(event.subjectId) !== "awaiting_input")
    ) {
      settled.push(row.id);
      continue;
    }
    const shown = gate ? chatGateMessage(gate, baseUrl) : null;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const rendered = renderEmail({
      kind,
      baseUrl,
      workspaceName: workspace?.name ?? "deevy",
      issue: issue
        ? { id: issue.id, key: issue.externalKey, title: issue.title, url: issue.url }
        : null,
      gate: shown
        ? {
            id: shown.gateRequestId,
            checkpoint: shown.checkpoint,
            proposal: shown.proposal,
            agentName: shown.agentName,
            approvals: shown.approvals,
            required: shown.required,
          }
        : null,
      question: typeof payload.question === "string" ? payload.question : null,
      runId: event.subjectType === "run" ? event.subjectId : null,
    });
    const message: EmailMessage = {
      from,
      to: member.user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: {},
      idempotencyKey: "",
    };
    // The delivery and what it says: a retry of the same email dedupes at a
    // sender that keys on it, and an email whose words changed between tries
    // (an approval came in) is a new request rather than a reused key, which
    // Resend refuses for good.
    message.idempotencyKey = await idempotencyKeyFor(row.id, message);
    // One at a time: every service rate-limits, and a pass is twenty at most.
    const sent = await sender.send(message);
    const outcome: Attempted = sent.delivered
      ? { id: row.id, delivered: true, status: sent.status, error: null }
      : { id: row.id, delivered: false, status: sent.status, error: sent.error };
    attempted.push(outcome);
    sentEvent.set(row.id, event);
    if (!sent.delivered && !sent.retry) hopeless.set(row.id, outcome);
  }

  const recorded = await recordOutcomes(db, attempted, {
    now,
    backoff: emailBackoff,
    maxAttempts,
    attemptsBefore: new Map(claimed.map((row) => [row.id, row.attempts])),
  });
  // Given up on now rather than after five more refusals, keeping the
  // sender's own words as the reason.
  if (hopeless.size > 0) {
    await db
      .update(deliveryTable)
      .set({ attempts: maxAttempts })
      .where(inArray(deliveryTable.id, [...hopeless.keys()]));
  }
  const exhausted = [...new Set([...recorded.exhausted, ...hopeless.keys()])];
  result.delivered = recorded.delivered;
  result.failed = recorded.failed - hopeless.size;
  result.gaveUp = exhausted.length + undeliverable.length + settled.length;
  await retireDeliveries(
    db,
    settled,
    "no longer waiting: it was settled before the email went",
    maxAttempts,
  );
  await retireDeliveries(
    db,
    undeliverable,
    "the Member is gone, suspended, or has no verified address",
    maxAttempts,
  );

  // Giving up is the operator's to know about, as a webhook's is: a sender
  // refusing every email is a key or a domain to fix. Straight to the log, not
  // through `appendEvent`, which would derive more of what just failed.
  if (exhausted.length > 0) {
    const outcomeById = new Map(attempted.map((one) => [one.id, one]));
    const memberOf = new Map(claimed.map((row) => [row.id, row.targetId]));
    const rows = exhausted.map((id) => {
      const event = sentEvent.get(id) as Event;
      const outcome = outcomeById.get(id);
      return {
        workspaceId: event.workspaceId,
        kind: "email.exhausted" satisfies EventKind,
        subjectType: "member",
        subjectId: memberOf.get(id) as string,
        projectId: event.projectId,
        payload: {
          eventSeq: event.seq,
          sender: setup.sender,
          status: outcome?.status ?? 0,
          error: outcome?.error ?? null,
        },
      };
    });
    // D1 binds at most a hundred parameters per statement, and each row binds six.
    for (let at = 0; at < rows.length; at += exhaustedRowsPerInsert) {
      await db.insert(eventTable).values(rows.slice(at, at + exhaustedRowsPerInsert));
    }
  }
  return result;
}

/** Exhausted deliveries whose Events go in one statement, as work.ts batches its own. */
const exhaustedRowsPerInsert = 16;

/** `<delivery>.<16 hex of the content's SHA-256>`. */
async function idempotencyKeyFor(deliveryId: string, message: EmailMessage): Promise<string> {
  const content = JSON.stringify([
    message.to,
    message.subject,
    message.text,
    message.html,
    message.headers,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${deliveryId}.${hex.slice(0, 16)}`;
}
