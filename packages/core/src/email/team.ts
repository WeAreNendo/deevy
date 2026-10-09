import { channel as channelTable, type Channel, type Db } from "@deevy/db";
import { eq } from "drizzle-orm";
import { signState, verifyState } from "../secrets.ts";
import { resolveSender, type ResolveSenderOptions } from "./sender.ts";
import { parseFrom, type EmailMessage } from "./port.ts";
import { renderPlain, type RenderedEmail } from "./render.ts";

/**
 * A team address (docs/plans/email-channel.md, slice 2): a Channel an admin
 * routes Notifications to, sent nothing until somebody at it confirms by the
 * link deevy mailed there. The confirmation is to a mailbox what a verified
 * sign-in is to a person: without it, an admin could make deevy mail anyone.
 */

/** Two weeks: a shared mailbox is not read every day. */
const confirmLifetimeMs = 14 * 24 * 60 * 60_000;

const names = (channelId: string, address: string) => `email-confirm:${channelId}:${address}`;

/** The address an email Channel sends to, and when it was confirmed. */
export function emailChannelOf(row: Pick<Channel, "kind" | "config">): {
  address: string;
  confirmedAt: Date | null;
} | null {
  if (row.kind !== "email") return null;
  const address = row.config?.address;
  if (typeof address !== "string" || address.length === 0) return null;
  const at = row.config?.confirmedAt;
  return { address, confirmedAt: typeof at === "number" ? new Date(at) : null };
}

/** `<channel>.<expires>.<tag>`, bound to the address too: a Channel re-pointed elsewhere needs a new one. */
export async function confirmToken(secret: string, channelId: string, address: string) {
  return `${channelId}.${await signState(secret, names(channelId, address), new Date(), confirmLifetimeMs)}`;
}

export function confirmUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/email/confirm/${encodeURIComponent(token)}`;
}

/** The Channel a confirmation link names, when it was minted here for its current address. */
export async function readConfirmToken(
  db: Db,
  secret: string,
  token: string,
): Promise<Channel | null> {
  const [channelId, expires, tag, ...rest] = token.split(".");
  if (!channelId || !expires || !tag || rest.length > 0) return null;
  const found = await db.query.channel.findFirst({ where: { id: channelId } });
  const email = found ? emailChannelOf(found) : null;
  if (!found || !email) return null;
  return (await verifyState(secret, names(channelId, email.address), `${expires}.${tag}`))
    ? found
    : null;
}

/** Marks it confirmed. Twice is once. */
export async function confirmChannel(db: Db, row: Channel, now = new Date()): Promise<boolean> {
  const email = emailChannelOf(row);
  if (!email || email.confirmedAt) return false;
  await db
    .update(channelTable)
    .set({ config: { ...row.config, confirmedAt: now.getTime() } })
    .where(eq(channelTable.id, row.id));
  return true;
}

export interface SendOutcome {
  delivered: boolean;
  status: number;
  error: string | null;
}

/**
 * Sends one email now, through the sender in force, for an operation whose
 * caller waits for the answer: a confirmation, a test. Nothing is queued, so a
 * refusal is said to the admin who can fix it, rather than written in a row.
 */
export async function sendNow(
  options: ResolveSenderOptions,
  to: string,
  rendered: RenderedEmail,
): Promise<SendOutcome> {
  const resolved = resolveSender(options);
  if ("reason" in resolved) return { delivered: false, status: 0, error: resolved.reason };
  const message: EmailMessage = {
    from: parseFrom(resolved.setup.from),
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    headers: {},
  };
  const sent = await resolved.sender.send(message);
  return sent.delivered
    ? { delivered: true, status: sent.status, error: null }
    : { delivered: false, status: sent.status, error: sent.error };
}

/** What a team address is first sent: who wants to mail it, and the one way to agree. */
export function renderConfirmation({
  workspaceName,
  channelName,
  addedBy,
  url,
}: {
  workspaceName: string;
  channelName: string;
  addedBy: string | null;
  url: string;
}): RenderedEmail {
  return renderPlain({
    workspaceName,
    subject: `Confirm this address for ${workspaceName}`,
    headline: "Confirm this address to get deevy's Notifications",
    lines: [
      `${addedBy ?? "An admin"} of ${workspaceName} added this address as the Channel "${channelName}", so Notifications they route here — a Gate waiting for a Human, a Run waiting for an answer — arrive by email.`,
      "Nothing is sent here until somebody confirms. If you weren't expecting this, ignore it and nothing will be.",
    ],
    action: { label: "Confirm this address", url },
    footer: `This link works for two weeks. It was sent because an admin of ${workspaceName} typed this address into deevy.`,
  });
}

/** What Test sends a confirmed team address. */
export function renderTeamTest({
  workspaceName,
  channelName,
  baseUrl,
}: {
  workspaceName: string;
  channelName: string;
  baseUrl: string;
}): RenderedEmail {
  return renderPlain({
    workspaceName,
    subject: `${workspaceName} is connected to this address`,
    headline: `${workspaceName} is connected to this address`,
    lines: [
      `This is a test from the Channel "${channelName}". Notifications routed here will arrive like this.`,
    ],
    action: null,
    footer: `An admin of ${workspaceName} routes Notifications to this address. Settings › Channels is where that stops: ${baseUrl.replace(/\/+$/, "")}/settings/channels`,
  });
}
