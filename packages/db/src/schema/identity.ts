import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { member, workspace } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * How deevy came to believe an account on a tool is a Member (ADR-0025).
 *
 * `sign_in`: the Human signs in to deevy with that account — Better Auth holds
 * it, keyed by the provider's own user id. `oauth`: they proved it with an
 * OAuth grant made while signed in. `link_code`: the tool delivered a
 * single-use code to that account alone, and they redeemed it signed in.
 * `email`: the tool reports an address a Member has verified, and an admin
 * allowed that on this Socket because the tool has nothing better to offer.
 */
export const identityVerifications = ["sign_in", "oauth", "link_code", "email"] as const;

/**
 * A Human's account on a tool, linked to their Member so a Ruling made there
 * is theirs (CONTEXT.md, "Identity").
 *
 * Not Better Auth's `account`: those rows are written by sign-in, keyed per
 * provider rather than per tool instance (two GitLab hosts would collide),
 * carry sign-in tokens, and do not mean "verified for ruling". This table is
 * the answer to one question — which Member is this commenter — and a revoked
 * row is kept, because a Human who unlinked an account must not be relinked
 * by the next comment it writes.
 */
export const memberIdentity = sqliteTable(
  "member_identity",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    /** The kind of tool: `github`, `gitlab`, `linear`, `notion`, `slack`, `stub`. */
    provider: text("provider").notNull(),
    /** Which one: a host, a Linear organisation, a Notion workspace, a Slack team. */
    instance: text("instance").notNull(),
    /** The tool's own id for the account. The only thing ever matched on. */
    externalUserId: text("external_user_id").notNull(),
    /** What the tool calls them, for a screen. Never matched on: a login can be renamed and reused. */
    externalLogin: text("external_login"),
    verifiedBy: text("verified_by", { enum: identityVerifications }).notNull(),
    linkedAt: integer("linked_at", { mode: "timestamp_ms" }).default(now).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    // One live link per account, which is what makes "who wrote this" one row.
    uniqueIndex("member_identity_live_idx")
      .on(table.provider, table.instance, table.externalUserId)
      .where(sql`${table.revokedAt} is null`),
    index("member_identity_memberId_idx").on(table.memberId),
  ],
);

/**
 * A code a chat tool delivered to one of its users alone, which links that user
 * to whoever redeems it while signed in to deevy (ADR-0025).
 *
 * Single-use and short-lived, and kept only as a hash: the code is a bearer
 * credential for ten minutes, and a row that held it would be one. It names the
 * account it links rather than the Member — the Member is whoever proves
 * themselves by redeeming it, and is shown who they are linking first.
 */
export const linkCode = sqliteTable(
  "link_code",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    socketId: text("socket_id").notNull(),
    provider: text("provider").notNull(),
    instance: text("instance").notNull(),
    externalUserId: text("external_user_id").notNull(),
    externalLogin: text("external_login"),
    /** SHA-256 of the code, hex. Never the code. */
    codeHash: text("code_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    redeemedAt: integer("redeemed_at", { mode: "timestamp_ms" }),
    redeemedBy: text("redeemed_by").references(() => member.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
  },
  (table) => [uniqueIndex("link_code_hash_uidx").on(table.codeHash)],
);
