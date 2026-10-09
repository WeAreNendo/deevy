import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  delivery as deliveryTable,
  invitation as invitationTable,
  member as memberTable,
  memberRoles,
} from "@deevy/db";
import type { Db, Delivery, Invitation, Workspace } from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { allocateHandle } from "../handles.ts";
import { appendEvent } from "../events.ts";
import { InvitationSchema, MemberSchema } from "../schemas.ts";
import { newId } from "../ids.ts";
import { maxEmailAttempts } from "../email/deliver.ts";
import { resolveSender } from "../email/sender.ts";
import { senderOptionsFor } from "../email/settings.ts";
import { sealSecret } from "../secrets.ts";
import { defineOperation, NoInput, type AppContext, type ContextFor } from "./registry.ts";
import { linkOrigin } from "./shared.ts";

/**
 * An invitation admits one person where an allowlist rule admits a category
 * (docs/plans/sign-in.md). It is a link rather than an email — deevy has no
 * email Channel until after v1 — so `create` hands the admin a URL to send
 * however they like, once, and the row keeps only a hash of the token in it.
 *
 * Joining stays an operation with a Member and an Event: the invited Human
 * signs in with whatever the instance offers, lands signed in and nobody yet,
 * and `accept` is what makes them a Member.
 */

/** Seven days from now, which is how long a link an admin sent is good for. */
const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** The token in the link: 32 bytes, base64url, seen once and never stored. */
function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * What the row holds instead of the token: SHA-256, hex, through
 * `crypto.subtle` so the same code runs on Node and on Workers (ADR-0006).
 */
async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * What an invitation shows: every field but the hash. Written out rather than
 * destructured so the one column that must never leave the server is named
 * here, and a column added later has to be named here too.
 */
/** Whether an invitation's email went, from the delivery row that owes it. */
function emailOf(owed: Delivery | undefined): Pick<Shown, "emailStatus" | "emailError"> {
  if (!owed) return { emailStatus: null, emailError: null };
  if (owed.deliveredAt) return { emailStatus: "sent", emailError: null };
  if (owed.attempts >= maxEmailAttempts) {
    return { emailStatus: "failed", emailError: owed.lastError };
  }
  return { emailStatus: "queued", emailError: null };
}

type Shown = Omit<Invitation, "tokenHash" | "sealedToken"> & {
  emailStatus: "queued" | "sent" | "failed" | null;
  emailError: string | null;
};

/**
 * The email deliveries owed for this Workspace's invitations, in one
 * statement that binds two parameters however many there are: a list of ids
 * would bind one each, and D1 refuses a statement past a hundred.
 */
async function emailsFor(db: Db, workspaceId: string): Promise<Map<string, Delivery>> {
  const rows = await db.query.delivery.findMany({ where: { target: "invitation", workspaceId } });
  return new Map(rows.map((row) => [row.targetId, row]));
}

function shown(row: Invitation, owed?: Delivery): Shown {
  return {
    ...emailOf(owed),
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    acceptedMemberId: row.acceptedMemberId,
    revokedAt: row.revokedAt,
  };
}

/** An address as an admin states one: strict, and lowercased to match a sign-in. */
const InvitedEmail = z.email().toLowerCase();

/**
 * The Workspace an accepting caller is joining. A Human who is nobody yet has
 * no Workspace on their context (app.ts), and a self-hosted instance serves
 * one (CONTEXT.md), so it is read back here.
 */
async function acceptingWorkspace(context: AppContext): Promise<Workspace> {
  const found = context.workspace ?? (await context.db.query.workspace.findFirst());
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such invitation" });
  return found;
}

/** The invitation a token names, or NOT_FOUND: a bearer nobody holds names nothing. */
async function invitationFor(db: Db, workspaceId: string, token: string): Promise<Invitation> {
  const found = await db.query.invitation.findFirst({
    where: { workspaceId, tokenHash: await hashInvitationToken(token) },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such invitation" });
  return found;
}

/**
 * Mark the live invitation this token names as accepted, if it is this
 * Workspace's and still open. Used where somebody turns out to be a Member
 * already: the row is what an admin reads as "has not answered yet", so a
 * spent link must not go on sitting in that list.
 */
async function spend(context: AppContext, token: string, memberId: string): Promise<void> {
  if (!context.workspace) return;
  const hash = await hashInvitationToken(token);
  await context.db
    .update(invitationTable)
    .set({ acceptedAt: new Date(), acceptedMemberId: memberId, sealedToken: null })
    .where(
      and(
        eq(invitationTable.workspaceId, context.workspace.id),
        eq(invitationTable.tokenHash, hash),
        isNull(invitationTable.acceptedAt),
        isNull(invitationTable.revokedAt),
      ),
    );
}

export const invitations = {
  list: defineOperation({
    name: "invitations.list",
    summary: "Every invitation this Workspace has issued, spent and revoked ones included",
    method: "GET",
    path: "/invitations",
    auth: "admin",
    input: NoInput,
    output: z.object({ invitations: z.array(InvitationSchema) }),
    handler: async ({ context }) => {
      const rows = await context.db.query.invitation.findMany({
        where: { workspaceId: context.workspace.id },
        orderBy: { createdAt: "desc" },
      });
      // The token appears in no list: only its hash was ever stored, and the
      // URL existed exactly once, in the response that created it — and, while
      // its email was owed, sealed in a column no read returns.
      const owed = await emailsFor(context.db, context.workspace.id);
      return { invitations: rows.map((row) => shown(row, owed.get(row.id))) };
    },
  }),

  create: defineOperation({
    name: "invitations.create",
    summary: "Admit one person by address, and get the link to send them",
    method: "POST",
    path: "/invitations",
    auth: "admin",
    input: z.object({
      email: InvitedEmail,
      role: z.enum(memberRoles).default("member"),
      /**
       * Email the link to the address too, when a sender is configured
       * (docs/plans/email-channel.md, slice 6). The link is returned either way.
       */
      send: z.boolean().default(true),
    }),
    output: InvitationSchema.extend({
      /**
       * The link to send, and the only sight of the token in it. Nothing reads
       * it back, so an admin who loses it revokes the invitation and issues
       * another.
       */
      url: z.string(),
      /**
       * The same link, site-relative. `url` is built from this instance's own
       * origin, which serves the SPA in the image and on Workers but not on a
       * split-origin deployment or in the `dev` loop, where the API and the SPA
       * are two ports. A browser knows the origin it is on; this is the half it
       * cannot know (docs/plans/sign-in.md).
       */
      path: z.string(),
      /** Why it was not emailed, when it was asked to be and could not be. */
      emailNotSent: z.string().nullable(),
    }),
    handler: async ({ input, context }) => {
      const live = await context.db.query.invitation.findFirst({
        where: {
          workspaceId: context.workspace.id,
          email: input.email,
          acceptedAt: { isNull: true },
          revokedAt: { isNull: true },
        },
      });
      // The partial unique index says one live invitation per address; an
      // expired one is still live, because a partial index cannot ask what the
      // time is. So the way to send a second link is to revoke the first.
      if (live) {
        throw new ORPCError("CONFLICT", {
          message: "That address already has an invitation: revoke it to send another",
        });
      }

      const token = mintToken();
      const [row] = await context.db
        .insert(invitationTable)
        .values({
          id: newId("invitation"),
          workspaceId: context.workspace.id,
          email: input.email,
          role: input.role,
          tokenHash: await hashInvitationToken(token),
          createdBy: context.member.id,
          expiresAt: new Date(Date.now() + LIFETIME_MS),
        })
        .returning();
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      const created = await appendEvent(context, {
        kind: "invitation.created",
        subjectType: "invitation",
        subjectId: row.id,
        payload: { email: row.email, role: row.role },
      });
      const path = `/invite/${token}`;
      const emailed = input.send ? await queueEmail(context, row.id, token, created.seq) : null;
      const owed = emailed?.queued
        ? (await emailsFor(context.db, context.workspace.id)).get(row.id)
        : undefined;
      return {
        ...shown(row, owed),
        url: `${linkOrigin(context)}${path}`,
        path,
        emailNotSent: emailed && !emailed.queued ? emailed.reason : null,
      };
    },
  }),

  revoke: defineOperation({
    name: "invitations.revoke",
    summary: "Stop an invitation being accepted, keeping the record that it was sent",
    method: "POST",
    path: "/invitations/{invitationId}/revoke",
    auth: "admin",
    input: z.object({ invitationId: z.string() }),
    output: InvitationSchema,
    handler: async ({ input, context }) => {
      const found = await context.db.query.invitation.findFirst({
        where: { id: input.invitationId, workspaceId: context.workspace.id },
      });
      if (!found) throw new ORPCError("NOT_FOUND", { message: "No such invitation" });
      if (found.acceptedAt) {
        throw new ORPCError("BAD_REQUEST", {
          message: "That invitation was already accepted",
        });
      }
      if (found.revokedAt) return shown(found);

      const [row] = await context.db
        .update(invitationTable)
        // The sealed token goes too: nothing will ever send it now.
        .set({ revokedAt: new Date(), sealedToken: null })
        .where(eq(invitationTable.id, found.id))
        .returning();
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      await appendEvent(context, {
        kind: "invitation.revoked",
        subjectType: "invitation",
        subjectId: found.id,
        payload: { email: found.email, role: found.role },
      });
      return shown(row);
    },
  }),

  accept: defineOperation({
    name: "invitations.accept",
    summary: "Join this Workspace with the invitation you were sent",
    method: "POST",
    path: "/invitations/accept",
    auth: "session",
    input: z.object({ token: z.string().min(1) }),
    output: MemberSchema,
    handler: async ({ input, context }) => {
      // Already a Member: the link has done its work, whether this caller
      // accepted it a moment ago or joined by a rule years back. Accepting
      // twice is that, and it is a no-op rather than an error — but the
      // invitation is spent all the same. Leaving it live left an address that
      // held a pending invitation nobody could ever accept and no admin could
      // replace, since one live invitation per address is a CONFLICT on the
      // next one (docs/plans/sign-in.md).
      if (context.member) {
        await spend(context, input.token, context.member.id);
        return context.member;
      }

      const ws = await acceptingWorkspace(context);
      const found = await invitationFor(context.db, ws.id, input.token);
      if (found.revokedAt) {
        throw new ORPCError("BAD_REQUEST", { message: "That invitation was revoked" });
      }
      if (found.acceptedAt) {
        throw new ORPCError("BAD_REQUEST", { message: "That invitation was already accepted" });
      }
      if (found.expiresAt.getTime() <= Date.now()) {
        throw new ORPCError("BAD_REQUEST", { message: "That invitation has expired" });
      }
      // Per person means per person: a forwarded link is not a second seat.
      if (context.session.user.email.toLowerCase() !== found.email) {
        throw new ORPCError("FORBIDDEN", {
          message: `That invitation was sent to ${found.email}`,
        });
      }

      // Four sequential writes, no transaction: D1 has none (ADR-0006), and
      // `joinWorkspace` joins the same way. A request that dies between the
      // Member and the invitation leaves a Member whose `member.joined` never
      // landed — the same shape a rule-based join has, and the reason the
      // Member row rather than the invitation is what deevy reads back.
      const memberId = newId("member");
      await context.db.insert(memberTable).values({
        id: memberId,
        workspaceId: ws.id,
        userId: context.session.user.id,
        role: found.role,
        kind: "human",
        handle: await allocateHandle(
          context.db,
          context.session.user.name ?? context.session.user.email,
        ),
      });
      await context.db
        .update(invitationTable)
        .set({ acceptedAt: new Date(), acceptedMemberId: memberId, sealedToken: null })
        .where(eq(invitationTable.id, found.id));

      // The Member exists by now, so both Events carry the Human who joined as
      // their actor. `member.joined` beside `invitation.accepted` is what makes
      // the Workspace's history read the same however somebody got in.
      const source = {
        db: context.db,
        workspace: ws,
        member: { id: memberId },
        ...(context.jobs ? { jobs: context.jobs } : {}),
      };
      await appendEvent(source, {
        kind: "invitation.accepted",
        subjectType: "invitation",
        subjectId: found.id,
        payload: { email: found.email, role: found.role },
      });
      await appendEvent(source, {
        kind: "member.joined",
        subjectType: "member",
        subjectId: memberId,
        payload: { role: found.role, kind: "human" },
      });
      const row = await context.db.query.member.findFirst({ where: { id: memberId } });
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return row;
    },
  }),
};

/**
 * Owes an invitation's email: the token sealed on the row, and a delivery the
 * sweep sends (email/deliver.ts). Nothing is queued without a sender to send
 * it, or without `DEEVY_SECRET` to keep the token sealed until then.
 */
async function queueEmail(
  context: ContextFor<"admin">,
  invitationId: string,
  token: string,
  eventSeq: number,
): Promise<{ queued: true } | { queued: false; reason: string }> {
  const sender = resolveSender(await senderOptionsFor(context));
  if ("reason" in sender) return { queued: false, reason: sender.reason };
  if (!context.socketSecret) {
    return {
      queued: false,
      reason:
        "deevy has no secret to keep the link with until the email goes, so it wasn't emailed. Send the link yourself.",
    };
  }
  await context.db
    .update(invitationTable)
    .set({ sealedToken: await sealSecret(context.socketSecret, token) })
    .where(eq(invitationTable.id, invitationId));
  await context.db.insert(deliveryTable).values({
    id: newId("delivery"),
    workspaceId: context.workspace.id,
    target: "invitation",
    targetId: invitationId,
    eventSeq,
  });
  return { queued: true };
}
