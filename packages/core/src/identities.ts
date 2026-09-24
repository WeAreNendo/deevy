import {
  account as accountTable,
  linkCode as linkCodeTable,
  memberIdentity as memberIdentityTable,
  user as userTable,
  type Db,
  type LinkCode,
  type Member,
  type MemberIdentity,
  type Socket,
} from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { appendEvent, type EventSource } from "./events.ts";
import { newId } from "./ids.ts";
import type { ExternalActor, IdentityScope } from "./sockets/port.ts";

/**
 * Which Member wrote this, on that tool (ADR-0025).
 *
 * The one question a Ruling from outside deevy turns on, answered from what
 * deevy can prove and nothing it was merely told. A login is never matched:
 * logins are renamed and reused. What is matched is the tool's own account id,
 * in the place that issued it, against one of three things:
 *
 * 1. An Identity already written down — a live `member_identity` row.
 * 2. The account the Human signs in to deevy with, where the tool's accounts
 *    are the sign-in provider's (`IdentityScope.signInProvider`). Better Auth
 *    holds that row, keyed by the provider's own user id, and it is the proof
 *    that the Human controls the account; a Human who signed in with GitHub
 *    rules from GitHub with no linking step, and one who linked GitHub from
 *    Settings › Identities rules the same way.
 * 3. An address the tool reports, matched to one a Member verified — only on a
 *    Socket whose admin allowed it, because some tools (Notion) have nothing
 *    better to offer and most have something much better.
 *
 * What 2 and 3 find is written down as an Identity, so the next comment is one
 * indexed read and the Human can see it and take it back. A revoked Identity is
 * the Human saying no, and nothing is allowed to link that account again
 * behind them: only they can, from a signed-in session.
 */

export interface ResolvedIdentity {
  member: Member;
  identity: MemberIdentity;
}

export interface IdentityLookup {
  source: EventSource;
  socket: Pick<Socket, "id" | "provider" | "config">;
  scope: IdentityScope;
  actor: ExternalActor;
}

export async function memberForExternalIdentity({
  source,
  socket,
  scope,
  actor,
}: IdentityLookup): Promise<ResolvedIdentity | null> {
  const { db } = source;
  const workspaceId = source.workspace.id;
  if (!actor.id) return null;

  const known = await db.query.memberIdentity.findMany({
    where: {
      workspaceId,
      provider: socket.provider,
      instance: scope.instance,
      externalUserId: actor.id,
    },
    with: { member: true },
  });
  const live = known.find((row) => row.revokedAt === null);
  if (live) return { member: live.member, identity: live };
  // Unlinked by the Human it belonged to, and so it stays until they say
  // otherwise from inside deevy (Settings › Identities).
  if (known.length > 0) return null;

  const signedIn = scope.signInProvider
    ? await memberBySignIn(db, workspaceId, scope.signInProvider, actor.id)
    : null;
  if (signedIn) return link(source, socket, scope, actor, signedIn, "sign_in");

  if (socket.config.identityByEmail === true && actor.email) {
    const byEmail = await memberByVerifiedEmail(db, workspaceId, actor.email);
    if (byEmail) return link(source, socket, scope, actor, byEmail, "email");
  }
  return null;
}

/** The Member whose Better Auth account this is, on this Workspace. */
async function memberBySignIn(
  db: Db,
  workspaceId: string,
  providerId: string,
  accountId: string,
): Promise<Member | null> {
  const [found] = await db
    .select({ userId: accountTable.userId })
    .from(accountTable)
    .where(and(eq(accountTable.providerId, providerId), eq(accountTable.accountId, accountId)))
    .limit(1);
  if (!found) return null;
  return (
    (await db.query.member.findFirst({ where: { workspaceId, userId: found.userId } })) ?? null
  );
}

/** The Member who verified this address, on this Workspace. */
async function memberByVerifiedEmail(
  db: Db,
  workspaceId: string,
  email: string,
): Promise<Member | null> {
  const [found] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(and(eq(userTable.email, email.trim().toLowerCase()), eq(userTable.emailVerified, true)))
    .limit(1);
  if (!found) return null;
  return (await db.query.member.findFirst({ where: { workspaceId, userId: found.id } })) ?? null;
}

/** Writes an Identity down, and says so in the log. */
async function link(
  source: EventSource,
  socket: { id: string; provider: string },
  scope: IdentityScope,
  actor: ExternalActor,
  member: Member,
  verifiedBy: MemberIdentity["verifiedBy"],
): Promise<ResolvedIdentity> {
  const [identity] = await source.db
    .insert(memberIdentityTable)
    .values({
      id: newId("memberIdentity"),
      workspaceId: source.workspace.id,
      memberId: member.id,
      provider: socket.provider,
      instance: scope.instance,
      externalUserId: actor.id,
      externalLogin: actor.login || null,
      verifiedBy,
    })
    .returning();
  if (!identity) throw new Error("memberForExternalIdentity: the insert returned no row");
  await appendEvent(source, {
    kind: "identity.linked",
    subjectType: "member",
    subjectId: member.id,
    payload: {
      identityId: identity.id,
      socketId: socket.id,
      provider: socket.provider,
      instance: scope.instance,
      login: identity.externalLogin,
      verifiedBy,
    },
  });
  return { member, identity };
}

/** A Member's Identities, live first, for the screen that lists them. */
export async function identitiesOf(db: Db, memberId: string): Promise<MemberIdentity[]> {
  const rows = await db.query.memberIdentity.findMany({
    where: { memberId },
    orderBy: { linkedAt: "desc" },
  });
  return [...rows.filter((row) => !row.revokedAt), ...rows.filter((row) => row.revokedAt)];
}

/** Takes one back. Idempotent: an Identity revoked twice is revoked once. */
export async function revokeIdentity(
  source: EventSource,
  identity: MemberIdentity,
  now = new Date(),
): Promise<MemberIdentity> {
  if (identity.revokedAt) return identity;
  const [revoked] = await source.db
    .update(memberIdentityTable)
    .set({ revokedAt: now })
    .where(and(eq(memberIdentityTable.id, identity.id), isNull(memberIdentityTable.revokedAt)))
    .returning();
  await appendEvent(source, {
    kind: "identity.revoked",
    subjectType: "member",
    subjectId: identity.memberId,
    payload: {
      identityId: identity.id,
      provider: identity.provider,
      instance: identity.instance,
      login: identity.externalLogin,
    },
  });
  return revoked ?? { ...identity, revokedAt: now };
}

/**
 * Allows one again, from the Human it belongs to.
 *
 * Nothing links a revoked Identity automatically — not the account they sign
 * in with, not their address — so a Human who changes their mind needs a way
 * back, and it is this: a signed-in Human saying so. Refused where somebody
 * else has linked the same account since, because one account is one Human.
 */
export async function restoreIdentity(
  source: EventSource,
  identity: MemberIdentity,
): Promise<MemberIdentity> {
  if (!identity.revokedAt) return identity;
  const taken = await source.db.query.memberIdentity.findFirst({
    where: {
      provider: identity.provider,
      instance: identity.instance,
      externalUserId: identity.externalUserId,
      revokedAt: { isNull: true },
    },
    columns: { id: true },
  });
  if (taken) {
    throw new ORPCError("CONFLICT", { message: "That account rules as somebody else now" });
  }
  const [restored] = await source.db
    .update(memberIdentityTable)
    .set({ revokedAt: null, linkedAt: new Date() })
    .where(eq(memberIdentityTable.id, identity.id))
    .returning();
  await appendEvent(source, {
    kind: "identity.linked",
    subjectType: "member",
    subjectId: identity.memberId,
    payload: {
      identityId: identity.id,
      provider: identity.provider,
      instance: identity.instance,
      login: identity.externalLogin,
      verifiedBy: identity.verifiedBy,
    },
  });
  return restored ?? { ...identity, revokedAt: null };
}

/** How long a link code may wait to be redeemed. */
export const LINK_CODE_MS = 10 * 60_000;

/** No I, O, 0 or 1: a code is read off one screen and typed into another. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** What a code is stored as: a hash of it, typed however it was typed. */
async function codeHash(code: string): Promise<string> {
  const normalized = code.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A code for one account on a chat tool, to be said to that account alone
 * (ADR-0025). Whoever redeems it signed in to deevy becomes that account's
 * Human; the tool vouches that only this account saw it, and the session
 * vouches for the Human.
 *
 * Returned once and stored only as a hash, so neither the table nor the log can
 * hand it to anybody else in the ten minutes it is good for.
 */
export async function mintLinkCode(
  source: EventSource,
  socket: Pick<Socket, "id" | "provider">,
  scope: IdentityScope,
  actor: ExternalActor,
  now = new Date(),
): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const raw = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  await source.db.insert(linkCodeTable).values({
    id: newId("linkCode"),
    workspaceId: source.workspace.id,
    socketId: socket.id,
    provider: socket.provider,
    instance: scope.instance,
    externalUserId: actor.id,
    externalLogin: actor.login || null,
    codeHash: await codeHash(code),
    expiresAt: new Date(now.getTime() + LINK_CODE_MS),
  });
  return code;
}

/** A code that is still good in this Workspace, or NOT_FOUND. Never says which of those it is not. */
export async function requireLinkCode(
  db: Db,
  workspaceId: string,
  code: string,
  now = new Date(),
): Promise<LinkCode> {
  const found = await db.query.linkCode.findFirst({
    where: { codeHash: await codeHash(code), workspaceId },
  });
  if (!found || found.redeemedAt || found.expiresAt.getTime() <= now.getTime()) {
    throw new ORPCError("NOT_FOUND", {
      message: "That code is not one deevy gave out here, or it has been used or has expired",
    });
  }
  return found;
}

/**
 * Links the account a code names to the Human redeeming it, and spends it.
 * Refused where that account already rules as somebody else: one account is
 * one Human, and changing whose it is is theirs to undo first.
 */
export async function redeemLinkCode(
  source: EventSource & { member: Member },
  found: LinkCode,
): Promise<MemberIdentity> {
  const live = await source.db.query.memberIdentity.findFirst({
    where: {
      provider: found.provider,
      instance: found.instance,
      externalUserId: found.externalUserId,
      revokedAt: { isNull: true },
    },
  });
  if (live && live.memberId !== source.member.id) {
    throw new ORPCError("CONFLICT", {
      message: "That account already approves and rejects as somebody else in deevy",
    });
  }
  // Spent first, and only if nobody spent it in between: the update is the claim.
  const [spent] = await source.db
    .update(linkCodeTable)
    .set({ redeemedAt: new Date(), redeemedBy: source.member.id })
    .where(and(eq(linkCodeTable.id, found.id), isNull(linkCodeTable.redeemedAt)))
    .returning({ id: linkCodeTable.id });
  if (!spent) {
    throw new ORPCError("NOT_FOUND", {
      message: "That code is not one deevy gave out here, or it has been used or has expired",
    });
  }
  if (live) return live;
  const linked = await link(
    source,
    { id: found.socketId, provider: found.provider },
    { instance: found.instance },
    { id: found.externalUserId, login: found.externalLogin ?? "", isBot: false },
    source.member,
    "link_code",
  );
  return linked.identity;
}
