import {
  allowlistRule,
  event,
  inboundDelivery,
  invitation,
  issue,
  issueLink,
  notification,
  member,
  project,
  socket,
  user,
  workspace,
} from "@deevy/db";
import { createSelectSchema } from "drizzle-orm/zod";
import { z } from "zod";

export const WorkspaceSchema = createSelectSchema(workspace);
export const MemberSchema = createSelectSchema(member);
export const UserSchema = createSelectSchema(user).pick({
  id: true,
  name: true,
  email: true,
  image: true,
  kind: true,
});
export const EventSchema = createSelectSchema(event);

/** A Member as the SPA shows one: the row plus the Human or Agent behind it. */
export const MemberWithUserSchema = MemberSchema.extend({ user: UserSchema });

export const AllowlistRuleSchema = createSelectSchema(allowlistRule);

/**
 * An invitation as any surface may show one: everything but the token hash.
 * The token exists in one HTTP response, `invitations.create`'s, and nothing
 * reads it back (docs/plans/sign-in.md).
 */
export const InvitationSchema = createSelectSchema(invitation).omit({ tokenHash: true });

/**
 * A Socket as every surface shows one: never its credentials and never its
 * webhook secret, which are sealed columns and leave the database only to be
 * handed to the provider module (ADR-0024). `secrets.test.ts` holds the line.
 */
export const SocketSchema = createSelectSchema(socket)
  .omit({ credentials: true, webhookSecret: true })
  .extend({
    identity: z.object({ login: z.string(), id: z.string(), mentionHandle: z.string() }),
    capabilities: z.array(z.enum(["tracker", "forge", "docs", "chat"])),
    /**
     * Whether each sealed column holds something. A settings page has to be
     * able to say "this tool has a webhook secret" without being told what it
     * is, and an operator looking at a Socket that hears nothing needs to know
     * which half is missing.
     */
    hasCredentials: z.boolean(),
    hasWebhookSecret: z.boolean(),
  });

/** One delivery, as a settings page lists what a tool has said lately. */
export const InboundDeliverySchema = createSelectSchema(inboundDelivery);

export const ProjectSchema = createSelectSchema(project);

export const IssueSchema = createSelectSchema(issue);

/**
 * An Issue as a list shows one: the projection, plus the Member deevy routed it
 * to. Its key and its state are the tracker's own words and are columns now,
 * so nothing is derived on the way out (ADR-0024).
 */
export const IssueSummarySchema = IssueSchema.extend({
  assignee: MemberWithUserSchema.nullable(),
  /**
   * Whether an Agent is working this one right now. Only set where it was asked
   * for — an Issue's children, which is the one list where it answers the
   * question a reader actually has (docs/plans/sub-issue-delegation.md) — and
   * left out everywhere a list would pay for it and nobody would read it.
   */
  hasOpenRun: z.boolean().optional(),
});

/** An Issue as its own page shows one: the summary plus its family. */
export const IssueDetailSchema = IssueSummarySchema.extend({
  project: ProjectSchema,
  parent: IssueSummarySchema.nullable(),
  children: z.array(IssueSummarySchema),
});

/** A comment as it stands in the tracker. deevy stores none of them. */
export const ExternalCommentSchema = z.object({
  externalId: z.string(),
  url: z.string(),
  body: z.string(),
  author: z.object({ login: z.string(), id: z.string(), isBot: z.boolean() }),
  createdAt: z.date(),
});

export const IssueLinkSchema = createSelectSchema(issueLink);

export const NotificationSchema = createSelectSchema(notification);

/** A Notification as the inbox shows one: the row plus the Issue it is about. */
export const NotificationWithIssueSchema = NotificationSchema.extend({
  issue: IssueSummarySchema.nullable(),
  event: EventSchema,
});
