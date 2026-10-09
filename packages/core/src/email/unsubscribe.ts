import { humanNotificationKinds, notificationPreference, type Db } from "@deevy/db";
import type { HumanNotificationKind } from "@deevy/db";
import { signState, verifyState } from "../secrets.ts";

/**
 * The one-click unsubscribe every personal email carries (RFC 8058,
 * docs/plans/email-channel.md): a link that turns off one kind of email for
 * one Human, and nothing else.
 *
 * The link is the authority, so it is signed with the instance secret over the
 * Member and the kind: nobody can turn off somebody else's email, or another
 * kind of theirs, by editing it. It lives long, because an email is read weeks
 * later; when it has expired, Settings › Notifications still works.
 */

/**
 * Each kind by the name Settings › Notifications gives it
 * (apps/web/src/routes/settings/notifications.tsx), so the page a link opens
 * says what the switch it flips is called.
 */
export const kindLabels: Record<HumanNotificationKind, string> = {
  mention: "Mention",
  assignment: "Assignment",
  gate_awaiting: "Gate awaiting",
  run_awaiting_input: "Run awaiting input",
  run_finished: "Run finished",
  delegation: "Sub-issues",
};

/** Six months: about as old as an email anybody acts on. */
const lifetimeMs = 182 * 24 * 60 * 60_000;

const names = (memberId: string, kind: string) => `email-unsubscribe:${memberId}:${kind}`;

/** `<member>.<kind>.<expires>.<tag>`: an id and a kind carry no dot. */
export async function unsubscribeToken(
  secret: string,
  memberId: string,
  kind: HumanNotificationKind,
  now = new Date(),
): Promise<string> {
  return `${memberId}.${kind}.${await signState(secret, names(memberId, kind), now, lifetimeMs)}`;
}

/** Where the link goes: under `/api`, which every deployment routes to the server. */
export function unsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/email/unsubscribe/${encodeURIComponent(token)}`;
}

/** What a link says, when it was minted here and has not expired. */
export async function readUnsubscribeToken(
  secret: string,
  token: string,
  now = new Date(),
): Promise<{ memberId: string; kind: HumanNotificationKind } | null> {
  const [memberId, kind, expires, tag, ...rest] = token.split(".");
  if (!memberId || !kind || !expires || !tag || rest.length > 0) return null;
  if (!(humanNotificationKinds as ReadonlyArray<string>).includes(kind)) return null;
  if (!(await verifyState(secret, names(memberId, kind), `${expires}.${tag}`, now))) return null;
  return { memberId, kind: kind as HumanNotificationKind };
}

/** Turns that kind's email off, leaving the inbox and Slack as they were. */
export async function unsubscribe(
  db: Db,
  { memberId, kind }: { memberId: string; kind: HumanNotificationKind },
): Promise<void> {
  await db
    .insert(notificationPreference)
    .values({ memberId, kind, email: false })
    .onConflictDoUpdate({
      target: [notificationPreference.memberId, notificationPreference.kind],
      set: { email: false },
    });
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The page a click lands on, in the emails' own plain style. */
export function unsubscribePage({
  title,
  body,
  form,
  settingsUrl,
}: {
  title: string;
  body: string;
  /** The button, when the page still asks. */
  form?: { action: string; label: string } | null;
  settingsUrl?: string | null;
}): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:48px 16px;background:#f4f5f9;font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d2433;">
<main style="max-width:480px;margin:0 auto;padding:28px;background:#fff;border:1px solid #e2e5ee;border-radius:8px;font-size:14px;line-height:1.55;">
<p style="margin:0 0 16px;font-size:13px;font-weight:600;color:#4f46e5;">deevy</p>
<h1 style="margin:0 0 12px;font-size:18px;font-weight:600;">${escapeHtml(title)}</h1>
<p style="margin:0 0 20px;color:#4b5468;">${escapeHtml(body)}</p>
${
  form
    ? `<form method="post" action="${escapeHtml(form.action)}" style="margin:0 0 20px;"><button type="submit" style="padding:10px 18px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font-weight:600;font-size:14px;cursor:pointer;">${escapeHtml(form.label)}</button></form>`
    : ""
}
${settingsUrl ? `<p style="margin:0;font-size:12px;color:#7a8296;"><a href="${escapeHtml(settingsUrl)}" style="color:#7a8296;">Settings › Notifications</a> has every switch.</p>` : ""}
</main></body></html>`;
}
