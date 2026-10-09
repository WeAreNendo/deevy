import {
  humanNotificationKinds,
  notificationPreference,
  type Db,
  type HumanNotificationKind,
} from "@deevy/db";
import { emailByDefault } from "../notifications.ts";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { NoInput, defineOperation } from "./registry.ts";

/**
 * What one Human wants to hear about, and where (schema/channel.ts). Routing is
 * the Workspace's rules and this together: the rules say which Channel a kind
 * of Notification reaches, and this says whether the Human concerned wants it
 * there at all.
 *
 * Own only. Neither operation takes a Member, so a Human sets their own
 * preferences and nobody else's — not even an admin, because this is not
 * administration, and not an Agent, which is denied by default (ADR-0004).
 *
 * Nothing here appends an Event. The Event log is the record of what happened
 * in the Workspace (CONTEXT.md), and one Human's own settings are not that.
 */

const PreferenceView = z.object({
  kind: z.enum(humanNotificationKinds),
  inbox: z.boolean(),
  /** In the Slack rooms the Workspace's routing rules send this kind to. */
  slack: z.boolean(),
  /**
   * As a direct message from the Slack app, once your Slack account is linked
   * (ADR-0025). Nothing is sent before then, whatever this says.
   */
  slackDm: z.boolean(),
  /**
   * By email, at the address your sign-in verified (docs/plans/email-channel.md).
   * Until you choose, on for what waits on you and off for the rest.
   */
  email: z.boolean(),
});

/** What a caller sets: the direct-message and email columns may be left out, and keep their value. */
const PreferenceInput = PreferenceView.extend({
  slackDm: z.boolean().optional(),
  email: z.boolean().optional(),
});

const PreferencesOutput = z.object({
  preferences: z.array(PreferenceView),
  /**
   * Where deevy would email you: your address, when your sign-in verified it,
   * and null when it did not — deevy never emails an address it was not sure of.
   */
  emailAddress: z.string().nullable(),
});

type Saved = Map<HumanNotificationKind, typeof notificationPreference.$inferSelect>;

/** Every kind, always, at its saved value or its default: the SPA draws the matrix from this. */
function viewOf(saved: Saved) {
  return humanNotificationKinds.map((kind) => ({
    kind,
    inbox: saved.get(kind)?.inbox ?? true,
    slack: saved.get(kind)?.slack ?? true,
    slackDm: saved.get(kind)?.slackDm ?? true,
    email: saved.get(kind)?.email ?? emailByDefault(kind),
  }));
}

async function emailAddressOf(db: Db, userId: string): Promise<string | null> {
  const found = await db.query.user.findFirst({
    where: { id: userId },
    columns: { email: true, emailVerified: true },
  });
  return found?.emailVerified ? found.email : null;
}

export const preferences = {
  get: defineOperation({
    name: "preferences.get",
    summary: "Which Notifications reach you, and in which Channels",
    method: "GET",
    path: "/preferences",
    auth: "member",
    input: NoInput,
    output: PreferencesOutput,
    handler: async ({ context }) => {
      const rows = await context.db.query.notificationPreference.findMany({
        where: { memberId: context.member.id },
      });
      // Every kind, always: the SPA renders the matrix from this rather than
      // knowing the defaults itself.
      return {
        preferences: viewOf(new Map(rows.map((row) => [row.kind, row]))),
        emailAddress: await emailAddressOf(context.db, context.member.userId),
      };
    },
  }),

  set: defineOperation({
    name: "preferences.set",
    summary: "Say which of your Notifications reach the inbox, Slack and your email",
    method: "PUT",
    path: "/preferences",
    auth: "member",
    input: z.object({ preferences: z.array(PreferenceInput).max(humanNotificationKinds.length) }),
    output: PreferencesOutput,
    handler: async ({ input, context }) => {
      const changed = [...new Map(input.preferences.map((row) => [row.kind, row])).values()];
      // What a caller left out keeps the value it had, which a client that
      // predates direct messages relies on to not switch them off.
      const before = new Map(
        (
          await context.db.query.notificationPreference.findMany({
            where: { memberId: context.member.id },
          })
        ).map((row) => [row.kind, row]),
      );
      if (changed.length > 0) {
        // Replace only the kinds named, in two statements: D1 has no
        // interactive transactions (ADR-0006), and a kind that is briefly
        // unset is a kind at its default, which is what it was saying anyway.
        await context.db.delete(notificationPreference).where(
          and(
            eq(notificationPreference.memberId, context.member.id),
            inArray(
              notificationPreference.kind,
              changed.map((row) => row.kind),
            ),
          ),
        );
        await context.db.insert(notificationPreference).values(
          changed.map((row) => ({
            memberId: context.member.id,
            kind: row.kind,
            inbox: row.inbox,
            slack: row.slack,
            slackDm: row.slackDm ?? before.get(row.kind)?.slackDm ?? true,
            email: row.email ?? before.get(row.kind)?.email ?? null,
          })),
        );
      }

      const rows = await context.db.query.notificationPreference.findMany({
        where: { memberId: context.member.id },
      });
      return {
        preferences: viewOf(new Map(rows.map((row) => [row.kind, row]))),
        emailAddress: await emailAddressOf(context.db, context.member.userId),
      };
    },
  }),
};
