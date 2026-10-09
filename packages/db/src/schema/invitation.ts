import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { member, memberRoles, workspace } from "./workspace.ts";

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * An invitation admits one person, where an allowlist rule admits a category
 * (docs/plans/sign-in.md). It is a link, emailed when a sender is configured,
 * and the row holds the SHA-256 hash of the token that was handed out, the way an Agent's API key is issued once and
 * never shown again (packages/core/src/keys.ts).
 *
 * Spent and revoked rows are kept: the Workspace's history is the Event log,
 * and "who is invited right now" should be a question one index answers rather
 * than a replay. Hence the partial unique index below — at most one live
 * invitation per address — whose `where` drizzle-kit emits into the migration
 * itself; only the `NOT NULL` on the text primary key is hand-patched there,
 * as the drizzle-kit rc needs everywhere (ADR-0008).
 */
export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** Lowercased on the way in: the address that signs in has to equal this one. */
    email: text("email").notNull(),
    /** What the invited person becomes on accepting. */
    role: text("role", { enum: memberRoles }).default("member").notNull(),
    /** SHA-256 of the token, hex. The token itself exists in one HTTP response. */
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by").references(() => member.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(now).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    acceptedMemberId: text("accepted_member_id").references(() => member.id, {
      onDelete: "set null",
    }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    /**
     * The token itself, sealed under `DEEVY_SECRET`, while an email that
     * carries it is still owed (docs/plans/email-channel.md, slice 6). Cleared
     * the moment the email lands or the invitation stops being acceptable, so
     * the link exists in a recoverable form only as long as it has to.
     */
    sealedToken: text("sealed_token"),
  },
  (table) => [
    // Live is "neither accepted nor revoked". Expiry is not in it: a partial
    // index cannot ask what the time is, so an expired invitation still holds
    // the address until an admin revokes it.
    uniqueIndex("invitation_live_uidx")
      .on(table.workspaceId, table.email)
      .where(sql`accepted_at is null and revoked_at is null`),
    // The accept path has nothing but the hash to look the row up by.
    uniqueIndex("invitation_tokenHash_uidx").on(table.tokenHash),
    index("invitation_workspaceId_idx").on(table.workspaceId),
  ],
);
