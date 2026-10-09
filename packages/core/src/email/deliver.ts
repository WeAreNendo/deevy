import {
  delivery as deliveryTable,
  event as eventTable,
  invitation as invitationTable,
  type Db,
  type Event,
} from "@deevy/db";
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
  type Targets,
} from "../outbox.ts";
import { chatGateMessage } from "../sockets/chat-out.ts";
import { parseFrom, type EmailMessage } from "./port.ts";
import { resolveSender, type ResolveSenderOptions } from "./sender.ts";
import { setupInForce } from "./settings.ts";
import { emailChannelOf } from "./team.ts";
import { openSecret } from "../secrets.ts";
import { renderInvitation } from "./invitation.ts";
import { renderEmail } from "./render.ts";
import { unsubscribeToken, unsubscribeUrl } from "./unsubscribe.ts";

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

export interface DeliverDueEmailsOptions extends ResolveSenderOptions {
  db: Db;
  workspaceId: string;
  /** Where a Human opens deevy: every email links back into it. */
  baseUrl: string;
  now?: Date;
  limit?: number;
  maxAttempts?: number;
  /**
   * The instance secret, which signs each email's one-click unsubscribe.
   * Without it an email still links to Settings › Notifications.
   */
  secret?: string;
  /** What a sender set in Settings › Email is sealed with; it wins over `email`. */
  socketSecret?: string;
}

export interface EmailDeliveryResult {
  scanned: number;
  delivered: number;
  failed: number;
  gaveUp: number;
  more: boolean;
}

export { resolveSender, type ResolveSenderOptions } from "./sender.ts";

export async function deliverDueEmails({
  db,
  workspaceId,
  baseUrl,
  now = new Date(),
  limit = defaultEmailLimit,
  maxAttempts = maxEmailAttempts,
  secret,
  socketSecret,
  ...senderOptions
}: DeliverDueEmailsOptions): Promise<EmailDeliveryResult> {
  const result: EmailDeliveryResult = {
    scanned: 0,
    delivered: 0,
    failed: 0,
    gaveUp: 0,
    more: false,
  };
  const targets: Targets = ["email_member", "email", "invitation"];
  const due = await dueDeliveries(db, targets, {
    workspaceId,
    now,
    limit,
    maxAttempts,
  });
  result.more = due.length >= limit;
  if (due.length === 0) return result;
  const claimed = await claimDeliveries(
    db,
    targets,
    due.map((row) => row.id),
    now,
  );
  result.scanned = claimed.length;
  if (claimed.length === 0) return result;

  // Without a sender nothing is kept waiting for one: a sender configured next
  // week must not send a week of stale Gates in one go. The inbox still has
  // every one of them.
  // Settings › Email's sender, else the environment's (email/settings.ts).
  const inForce = await setupInForce({
    db,
    workspaceId,
    ...(socketSecret ? { socketSecret } : {}),
    ...(senderOptions.email ? { email: senderOptions.email } : {}),
  });
  const resolved = inForce.problem
    ? { reason: inForce.problem }
    : resolveSender({ ...senderOptions, email: inForce.setup });
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
  // A team address is a Channel: its id names it, as a Member's names them.
  const teams = await db.query.channel.findMany({
    where: {
      id: { in: [...new Set(claimed.map((row) => row.targetId))] },
      workspaceId,
      kind: "email",
    },
  });
  const teamById = new Map(teams.map((row) => [row.id, row]));
  // An invitation's link, owed to the address it is for (slice 6).
  const invites = await db.query.invitation.findMany({
    where: { id: { in: [...new Set(claimed.map((row) => row.targetId))] }, workspaceId },
    with: { creator: { with: { user: { columns: { name: true } } } } },
  });
  const inviteById = new Map(invites.map((row) => [row.id, row]));
  /** Invitations whose email landed or never will: their sealed token is cleared after the pass. */
  const invitedIds: string[] = [];
  /** Invitations accepted, revoked or expired before their email went. */
  const inviteSettled: string[] = [];
  /** Invitations whose sealed link cannot be opened: the secret is gone or changed. */
  const inviteUnopened: string[] = [];
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

  const targetIds = new Map(claimed.map((row) => [row.id, row.targetId]));
  const targetIdOf = (deliveryId: string) => targetIds.get(deliveryId) ?? "";
  const undeliverable: string[] = [];
  /** Emails about a wait that ended before they went: nothing failed, so no Event. */
  const settled: string[] = [];
  const attempted: Attempted[] = [];
  /** Refusals no wait will change, with what the sender said. */
  const hopeless = new Map<string, Attempted>();
  const sentEvent = new Map<string, Event>();
  for (const row of claimed) {
    const invite = inviteById.get(row.targetId);
    if (invite) {
      // Accepted, revoked or expired before it went: nothing to send, and
      // nothing failed. Without the secret that sealed it, nothing can be.
      if (invite.acceptedAt || invite.revokedAt || invite.expiresAt <= now || !invite.sealedToken) {
        inviteSettled.push(row.id);
        invitedIds.push(invite.id);
        continue;
      }
      const token = socketSecret
        ? await openSecret(socketSecret, invite.sealedToken).catch(() => null)
        : null;
      if (!token) {
        inviteUnopened.push(row.id);
        invitedIds.push(invite.id);
        continue;
      }
      const rendered = renderInvitation({
        workspaceName: workspace?.name ?? "deevy",
        inviterName: invite.creator?.user.name ?? null,
        role: invite.role,
        expiresAt: invite.expiresAt,
        url: `${baseUrl.replace(/\/+$/, "")}/invite/${token}`,
      });
      const invitation: EmailMessage = {
        from,
        to: invite.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        headers: {},
        idempotencyKey: "",
      };
      invitation.idempotencyKey = await idempotencyKeyFor(row.id, invitation);
      const sent = await sender.send(invitation);
      const outcome: Attempted = sent.delivered
        ? { id: row.id, delivered: true, status: sent.status, error: null }
        : { id: row.id, delivered: false, status: sent.status, error: sent.error };
      attempted.push(outcome);
      // Kept only while the email may still go: sent, or refused for good.
      if (sent.delivered || !sent.retry) invitedIds.push(invite.id);
      if (!sent.delivered && !sent.retry) hopeless.set(row.id, outcome);
      continue;
    }
    const event = eventBySeq.get(row.eventSeq);
    const member = memberById.get(row.targetId);
    const team = teamById.get(row.targetId);
    const teamAddress = team ? emailChannelOf(team) : null;
    const kind = event ? notificationKindOf(event) : null;
    // Where it goes: a Member's verified address — never one who left, was
    // suspended, or whose sign-in no longer vouches for it — or a team
    // address that is still confirmed and still there.
    const to =
      member && !member.suspendedAt && member.user.emailVerified
        ? member.user.email
        : teamAddress?.confirmedAt
          ? teamAddress.address
          : null;
    if (!event || !kind || !isHumanNotificationKind(kind) || !to) {
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
    // A Human's own email can be stopped in one click; a team address is
    // stopped where it was routed, by an admin. Signed from when the Event
    // happened, not from this pass: every attempt then carries the same link,
    // and so is the same email to a sender.
    const unsubscribe =
      secret && member
        ? unsubscribeUrl(baseUrl, await unsubscribeToken(secret, member.id, kind, event.createdAt))
        : null;
    const rendered = renderEmail({
      unsubscribeUrl: unsubscribe,
      audience: team ? "team" : "member",
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
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      // One click turns this kind off for this Human (RFC 8058); a client
      // that offers "unsubscribe" beside the sender's name posts here.
      headers: unsubscribe
        ? {
            "List-Unsubscribe": `<${unsubscribe}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : {},
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
  // An invitation retried to exhaustion will not go either.
  for (const id of recorded.exhausted) {
    const invite = inviteById.get(targetIdOf(id));
    if (invite) invitedIds.push(invite.id);
  }
  // The token is kept only while an email that carries it is owed.
  if (invitedIds.length > 0) {
    await db
      .update(invitationTable)
      .set({ sealedToken: null })
      .where(inArray(invitationTable.id, invitedIds));
  }
  result.delivered = recorded.delivered;
  result.failed = recorded.failed - hopeless.size;
  result.gaveUp =
    exhausted.length +
    undeliverable.length +
    settled.length +
    inviteSettled.length +
    inviteUnopened.length;
  await retireDeliveries(
    db,
    inviteSettled,
    "The invitation was accepted, revoked or had expired before the email went.",
    maxAttempts,
  );
  await retireDeliveries(
    db,
    inviteUnopened,
    "deevy couldn't open the invitation's link: the server's secret for sealed keys is missing or changed.",
    maxAttempts,
  );
  await retireDeliveries(
    db,
    settled,
    "no longer waiting: it was settled before the email went",
    maxAttempts,
  );
  await retireDeliveries(
    db,
    undeliverable,
    "the Member is gone, suspended or unverified, or the team address is gone or unconfirmed",
    maxAttempts,
  );

  // Giving up is the operator's to know about, as a webhook's is: a sender
  // refusing every email is a key or a domain to fix. Straight to the log, not
  // through `appendEvent`, which would derive more of what just failed.
  if (exhausted.length > 0) {
    const outcomeById = new Map(attempted.map((one) => [one.id, one]));
    const memberOf = new Map(claimed.map((row) => [row.id, row.targetId]));
    const rows = exhausted.map((id) => {
      const event = sentEvent.get(id);
      const outcome = outcomeById.get(id);
      const target = memberOf.get(id) as string;
      return {
        workspaceId,
        kind: "email.exhausted" satisfies EventKind,
        subjectType: inviteById.has(target)
          ? "invitation"
          : teamById.has(target)
            ? "channel"
            : "member",
        subjectId: target,
        projectId: event?.projectId ?? null,
        payload: {
          eventSeq: event?.seq ?? null,
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
