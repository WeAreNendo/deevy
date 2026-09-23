import { account as accountTable, identityVerifications } from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  identitiesOf,
  redeemLinkCode,
  requireLinkCode,
  restoreIdentity,
  revokeIdentity,
} from "../identities.ts";
import { socketModuleFor } from "../sockets/registry.ts";
import { NoInput, defineOperation, type ContextFor } from "./registry.ts";

/**
 * A Human's accounts on the tools, and which of them rule as them (ADR-0025).
 *
 * Own only, and a Human's only. Neither operation takes a Member, so nobody —
 * not an admin — lists or unlinks somebody else's; and an Agent has no
 * Identities, because an Agent never rules (ADR-0010).
 *
 * Linking is not here. Linking an account the Human signs in with is Better
 * Auth's own `link-social` from a signed-in session, and what that writes is
 * what the resolver reads (identities.ts); a tool with an OAuth grant of its
 * own, or a code sent to one account alone, brings its own route with it.
 */

const IdentitySchema = z.object({
  id: z.string(),
  provider: z.string(),
  instance: z.string(),
  externalLogin: z.string().nullable(),
  verifiedBy: z.enum(identityVerifications),
  linkedAt: z.date(),
  revokedAt: z.date().nullable(),
});

export const identities = {
  list: defineOperation({
    name: "identities.list",
    summary: "Your accounts on the tools, and which of them may rule as you",
    method: "GET",
    path: "/identities",
    auth: "member",
    input: NoInput,
    output: z.object({
      identities: z.array(IdentitySchema),
      /**
       * The providers you sign in to deevy with. An account there vouches for
       * you the first time you rule from a tool whose accounts are that
       * provider's, so it is an Identity waiting to happen.
       */
      signIns: z.array(z.string()),
      /**
       * The sign-in providers a tool connected here takes accounts from, which
       * is what is worth linking: an account no connected tool knows rules
       * nowhere, and a button for it would be a setting with nothing behind it.
       */
      linkable: z.array(z.string()),
    }),
    handler: async ({ context }) => {
      const rows = await identitiesOf(context.db, context.member.id);
      const accounts = await context.db
        .select({ providerId: accountTable.providerId })
        .from(accountTable)
        .where(eq(accountTable.userId, context.member.userId));
      return {
        identities: rows.map(view),
        signIns: [...new Set(accounts.map((row) => row.providerId))].sort(),
        linkable: await linkableProviders(context),
      };
    },
  }),

  revoke: defineOperation({
    name: "identities.revoke",
    summary: "Stop one of your accounts ruling as you",
    method: "POST",
    path: "/identities/{identityId}/revoke",
    auth: "member",
    input: z.object({ identityId: z.string() }),
    output: IdentitySchema,
    handler: async ({ input, context }) => {
      const found = await context.db.query.memberIdentity.findFirst({
        where: { id: input.identityId, memberId: context.member.id },
      });
      // Somebody else's is not there, as far as this caller can tell.
      if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Identity" });
      return view(await revokeIdentity(context, found));
    },
  }),

  /**
   * Who a code would link, before it does.
   *
   * A code links its account to whoever redeems it, so the one thing a Human
   * handed somebody else's code must see is that it is somebody else's: this
   * names the account, and linking is a second, deliberate step (ADR-0025).
   */
  peek: defineOperation({
    name: "identities.peek",
    summary: "Say which account a link code would link to you, without linking it",
    method: "POST",
    path: "/identities/peek",
    auth: "member",
    // A Human present, not a credential they delegated: linking an account is
    // giving it the power to rule as you (ADR-0010).
    sessionOnly: true,
    input: z.object({ code: z.string().trim().min(8).max(20) }),
    output: z.object({
      provider: z.string(),
      instance: z.string(),
      externalLogin: z.string().nullable(),
      socketName: z.string().nullable(),
      expiresAt: z.date(),
    }),
    handler: async ({ input, context }) => {
      const found = await requireLinkCode(context.db, context.workspace.id, input.code);
      const socket = await context.db.query.socket.findFirst({
        where: { id: found.socketId },
        columns: { name: true },
      });
      return {
        provider: found.provider,
        instance: found.instance,
        externalLogin: found.externalLogin,
        socketName: socket?.name ?? null,
        expiresAt: found.expiresAt,
      };
    },
  }),

  link: defineOperation({
    name: "identities.link",
    summary: "Link the account a code names to you, so it rules as you",
    method: "POST",
    path: "/identities/link",
    auth: "member",
    sessionOnly: true,
    input: z.object({ code: z.string().trim().min(8).max(20) }),
    output: IdentitySchema,
    handler: async ({ input, context }) => {
      const found = await requireLinkCode(context.db, context.workspace.id, input.code);
      return view(await redeemLinkCode(context, found));
    },
  }),

  restore: defineOperation({
    name: "identities.restore",
    summary: "Let an account you unlinked rule as you again",
    method: "POST",
    path: "/identities/{identityId}/restore",
    auth: "member",
    input: z.object({ identityId: z.string() }),
    output: IdentitySchema,
    handler: async ({ input, context }) => {
      const found = await context.db.query.memberIdentity.findFirst({
        where: { id: input.identityId, memberId: context.member.id },
      });
      if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Identity" });
      return view(await restoreIdentity(context, found));
    },
  }),
};

/**
 * Which sign-in providers' accounts the Workspace's tools take. Asked of each
 * connected Socket's module, because the provider is what knows whether its
 * accounts are the sign-in provider's — github.com's are, a GitHub Enterprise
 * Server's are not (IdentityScope). Building a module reads no network.
 */
async function linkableProviders(context: ContextFor<"member">): Promise<string[]> {
  const rows = await context.db.query.socket.findMany({
    where: { workspaceId: context.workspace.id, status: "active" },
    columns: { provider: true, config: true },
  });
  const found = new Set<string>();
  for (const row of rows) {
    const module = await socketModuleFor(context, row).catch(() => null);
    const provider = module?.identityScope?.signInProvider;
    if (provider) found.add(provider);
  }
  return [...found].sort();
}

function view(row: z.input<typeof IdentitySchema> & Record<string, unknown>) {
  return {
    id: row.id,
    provider: row.provider,
    instance: row.instance,
    externalLogin: row.externalLogin,
    verifiedBy: row.verifiedBy,
    linkedAt: row.linkedAt,
    revokedAt: row.revokedAt,
  };
}
