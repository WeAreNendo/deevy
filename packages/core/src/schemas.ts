import {
  allowlistRule,
  comment,
  document,
  documentVersion,
  event,
  gateDecision,
  invitation,
  issue,
  issueLink,
  label,
  notification,
  member,
  project,
  team,
  user,
  workflowState,
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

export const TeamSchema = createSelectSchema(team);
export const ProjectSchema = createSelectSchema(project);
export const WorkflowStateSchema = createSelectSchema(workflowState);

/** A Project as every surface shows one: the row plus its Workflow, in order. */
export const ProjectWithStatesSchema = ProjectSchema.extend({
  states: z.array(WorkflowStateSchema),
  team: TeamSchema.nullable(),
});

export const TeamWithMembersSchema = TeamSchema.extend({
  members: z.array(MemberWithUserSchema),
});

export const IssueSchema = createSelectSchema(issue);

export const LabelSchema = createSelectSchema(label);

/** An Issue as a list shows one: the row plus its derived key, State and Labels. */
export const IssueSummarySchema = IssueSchema.extend({
  key: z.string(),
  state: WorkflowStateSchema,
  assignee: MemberWithUserSchema.nullable(),
  labels: z.array(LabelSchema),
});

export const GateDecisionSchema = createSelectSchema(gateDecision).extend({
  /**
   * What each of the Issue's Documents said when this ruling was made. A Gate
   * approves text, and the text keeps moving afterwards; this is the record of
   * which words were agreed to.
   */
  documents: z.array(z.object({ name: z.string(), version: z.number().int() })),
});

/**
 * Where the Gate an Issue is in has got to, and what the Human reading it may
 * do about it (docs/plans/four-eyes-gates.md). Null when the Issue is not in a
 * Gate, which is also when nothing is asked to work it out.
 */
export const GateStandingSchema = z.object({
  /** Distinct Humans who must approve before the Issue leaves. */
  required: z.number().int(),
  /** How many could give one: the approvers this Gate names, or every Human, less the suspended. */
  eligible: z.number().int(),
  excludeRequester: z.boolean(),
  approvals: z.array(
    z.object({
      memberId: z.string(),
      name: z.string().nullable(),
      note: z.string().nullable(),
      at: z.date(),
    }),
  ),
  mayApprove: z.boolean(),
  /** Why not, when `mayApprove` is false. */
  refusedBecause: z.enum(["not_an_approver", "requester", "approved", "too_few_humans"]).nullable(),
});

/** An Issue as its own page shows one: the summary plus its family and its Gate history. */
export const IssueDetailSchema = IssueSummarySchema.extend({
  project: ProjectSchema,
  parent: IssueSummarySchema.nullable(),
  children: z.array(IssueSummarySchema),
  gateDecisions: z.array(GateDecisionSchema),
  gate: GateStandingSchema.nullable(),
});

export const DocumentSchema = createSelectSchema(document);
export const DocumentVersionSchema = createSelectSchema(documentVersion);

/** A Document read at one version: the row plus that version's body. */
export const DocumentAtVersionSchema = DocumentSchema.extend({
  version: z.number().int(),
  body: z.string(),
  authorMemberId: z.string().nullable(),
  /**
   * When this version was written, which is the version row's own time rather
   * than the Document's: reading version 1 of a Document edited yesterday must
   * say when version 1 was written, not when the Document last changed.
   */
  writtenAt: z.date(),
  /**
   * What to echo back on a write, so the server can merge what you changed
   * rather than paste what you sent (ADR-0021). Opaque, and null when there is
   * nothing to write from — reading an older version is reading history.
   */
  basis: z.string().nullable(),
});

export const CommentSchema = createSelectSchema(comment);

/** A comment as the thread shows one: the row plus who wrote it. */
export const CommentWithAuthorSchema = CommentSchema.extend({
  author: MemberWithUserSchema.nullable(),
});

export const IssueLinkSchema = createSelectSchema(issueLink);

export const NotificationSchema = createSelectSchema(notification);

/** A Notification as the inbox shows one: the row plus the Issue it is about. */
export const NotificationWithIssueSchema = NotificationSchema.extend({
  issue: IssueSummarySchema.nullable(),
  event: EventSchema,
});
