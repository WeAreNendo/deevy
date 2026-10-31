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
import { socketCapabilities } from "./sockets/port.ts";

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
/**
 * An invitation as every surface shows one: never its token's hash, never the
 * token sealed while its email is owed, and whether that email went
 * (docs/plans/email-channel.md, slice 6).
 */
export const InvitationSchema = createSelectSchema(invitation)
  .omit({ tokenHash: true, sealedToken: true })
  .extend({
    /** `queued` while owed, `sent` once it landed, `failed` once given up on; null when never emailed. */
    emailStatus: z.enum(["queued", "sent", "failed"]).nullable(),
    /** What the sender said when it refused. */
    emailError: z.string().nullable(),
  });

/**
 * A Socket as every surface shows one: never its credentials and never its
 * webhook secret, which are sealed columns and leave the database only to be
 * handed to the provider module (ADR-0024). `secrets.test.ts` holds the line.
 */
export const SocketSchema = createSelectSchema(socket)
  // Every sealed column, and when the webhook secret last changed, which no
  // screen reads and which only matters to the delivery that checks it.
  .omit({
    credentials: true,
    webhookSecret: true,
    previousWebhookSecret: true,
    webhookSecretChangedAt: true,
    // Left behind until the clean break (schema/socket.ts): deevy asks no tool.
    pollMinutes: true,
  })
  .extend({
    identity: z.object({ login: z.string(), id: z.string(), mentionHandle: z.string() }),
    capabilities: z.array(z.enum(socketCapabilities)),
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

export const ProjectSchema = createSelectSchema(project)
  // Columns left behind until the clean break (schema/project.ts): not part of a Project.
  .omit({
    forgeSocketId: true,
    forgeScope: true,
    docsSocketId: true,
    docsScope: true,
    mirror: true,
    lastPolledAt: true,
  })
  .extend({
    /**
     * How a record says which Agent it is for. Declared rather than left as
     * loose JSON, because every reader of a Project asks for these two fields
     * and a screen should not have to narrow a column deevy itself wrote
     * (schema/project.ts).
     */
    routing: z.object({ labelPrefix: z.string(), mention: z.boolean() }),
  });

export const IssueSchema = createSelectSchema(issue)
  // Left behind until the clean break (schema/issue.ts): deevy opens no record,
  // so it no longer knows who opened one.
  .omit({ createdBy: true });

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

/**
 * An Issue as its own page shows one: the summary plus its family. Never its
 * conversation, which is the tracker's (docs/plans/simplify.md, slice 4).
 */
export const IssueDetailSchema = IssueSummarySchema.extend({
  project: ProjectSchema,
  parent: IssueSummarySchema.nullable(),
  children: z.array(IssueSummarySchema),
  /**
   * The Checkpoints this Project asks a Run to stop at, by name.
   *
   * Here rather than on the Project because this is the read an Agent makes
   * before it plans anything, and where to stop is part of the brief: none of
   * its tools is a way to list a Project's policy (packages/core/mcp-tools.json).
   * The arithmetic behind each one is a Human's
   * business and stays on the Gate.
   */
  checkpoints: z.array(z.string()),
});

export const IssueLinkSchema = createSelectSchema(issueLink);

export const NotificationSchema = createSelectSchema(notification);

/** A Notification as the inbox shows one: the row plus the Issue it is about. */
export const NotificationWithIssueSchema = NotificationSchema.extend({
  issue: IssueSummarySchema.nullable(),
  event: EventSchema,
});
