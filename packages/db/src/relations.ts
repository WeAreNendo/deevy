import { defineRelations, defineRelationsPart } from "drizzle-orm";
import {
  account,
  apikey,
  authRelations,
  jwks,
  oauthAccessToken,
  oauthClient,
  oauthClientAssertion,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  session,
  user,
  verification,
} from "./schema/auth.ts";
import { agent, projectGrant } from "./schema/agent.ts";
import { activity, run } from "./schema/run.ts";
import { channel, notificationPreference, routingRule } from "./schema/channel.ts";
import { delivery } from "./schema/delivery.ts";
import { webhookSubscription } from "./schema/webhook.ts";
import { allowlistRule } from "./schema/allowlist.ts";
import { invitation } from "./schema/invitation.ts";
import { event } from "./schema/event.ts";
import { comment } from "./schema/comment.ts";
import { notification } from "./schema/notification.ts";
import { issueLink } from "./schema/link.ts";
import { document, documentVersion, documentVersionAuthor, roomState } from "./schema/document.ts";
import { gateApprover, gateDecision, gateDecisionDocument } from "./schema/gate.ts";
import { issue } from "./schema/issue.ts";
import { issueLabel, label } from "./schema/label.ts";
import { project, team, teamMember, workflowState } from "./schema/project.ts";
import { member, workspace } from "./schema/workspace.ts";

export const tables = {
  user,
  session,
  account,
  verification,
  apikey,
  jwks,
  oauthClient,
  oauthResource,
  oauthClientResource,
  oauthRefreshToken,
  oauthAccessToken,
  oauthConsent,
  oauthClientAssertion,
  workspace,
  member,
  event,
  allowlistRule,
  invitation,
  team,
  teamMember,
  project,
  workflowState,
  issue,
  gateDecision,
  document,
  documentVersion,
  label,
  issueLabel,
  comment,
  issueLink,
  notification,
  agent,
  projectGrant,
  run,
  activity,
  channel,
  routingRule,
  notificationPreference,
  delivery,
  webhookSubscription,
  gateApprover,
  gateDecisionDocument,
  documentVersionAuthor,
  roomState,
};

const appRelations = defineRelationsPart(tables, (r) => ({
  workspace: {
    members: r.many.member({ from: r.workspace.id, to: r.member.workspaceId }),
    events: r.many.event({ from: r.workspace.id, to: r.event.workspaceId }),
    labels: r.many.label({ from: r.workspace.id, to: r.label.workspaceId }),
    allowlistRules: r.many.allowlistRule({
      from: r.workspace.id,
      to: r.allowlistRule.workspaceId,
    }),
    invitations: r.many.invitation({ from: r.workspace.id, to: r.invitation.workspaceId }),
    teams: r.many.team({ from: r.workspace.id, to: r.team.workspaceId }),
    projects: r.many.project({ from: r.workspace.id, to: r.project.workspaceId }),
  },
  member: {
    workspace: r.one.workspace({ from: r.member.workspaceId, to: r.workspace.id, optional: false }),
    user: r.one.user({ from: r.member.userId, to: r.user.id, optional: false }),
    sponsor: r.one.member({ from: r.member.sponsorId, to: r.member.id }),
    agent: r.one.agent({ from: r.member.id, to: r.agent.memberId }),
    subscriptions: r.many.webhookSubscription({
      from: r.member.id,
      to: r.webhookSubscription.memberId,
    }),
    grantedProjects: r.many.project({
      from: r.member.id.through(r.projectGrant.memberId),
      to: r.project.id.through(r.projectGrant.projectId),
    }),
    teams: r.many.team({
      from: r.member.id.through(r.teamMember.memberId),
      to: r.team.id.through(r.teamMember.teamId),
    }),
  },
  team: {
    workspace: r.one.workspace({ from: r.team.workspaceId, to: r.workspace.id, optional: false }),
    members: r.many.member({
      from: r.team.id.through(r.teamMember.teamId),
      to: r.member.id.through(r.teamMember.memberId),
    }),
    projects: r.many.project({ from: r.team.id, to: r.project.teamId }),
  },
  teamMember: {
    team: r.one.team({ from: r.teamMember.teamId, to: r.team.id, optional: false }),
    member: r.one.member({ from: r.teamMember.memberId, to: r.member.id, optional: false }),
  },
  project: {
    workspace: r.one.workspace({
      from: r.project.workspaceId,
      to: r.workspace.id,
      optional: false,
    }),
    team: r.one.team({ from: r.project.teamId, to: r.team.id }),
    states: r.many.workflowState({ from: r.project.id, to: r.workflowState.projectId }),
    issues: r.many.issue({ from: r.project.id, to: r.issue.projectId }),
  },
  issue: {
    project: r.one.project({ from: r.issue.projectId, to: r.project.id, optional: false }),
    state: r.one.workflowState({
      from: r.issue.stateId,
      to: r.workflowState.id,
      optional: false,
    }),
    assignee: r.one.member({ from: r.issue.assigneeMemberId, to: r.member.id }),
    creator: r.one.member({ from: r.issue.createdBy, to: r.member.id }),
    parent: r.one.issue({ from: r.issue.parentId, to: r.issue.id }),
    children: r.many.issue({ from: r.issue.id, to: r.issue.parentId }),
    gateDecisions: r.many.gateDecision({ from: r.issue.id, to: r.gateDecision.issueId }),
    documents: r.many.document({ from: r.issue.id, to: r.document.issueId }),
    runs: r.many.run({ from: r.issue.id, to: r.run.issueId }),
    labels: r.many.label({
      from: r.issue.id.through(r.issueLabel.issueId),
      to: r.label.id.through(r.issueLabel.labelId),
    }),
    comments: r.many.comment({ from: r.issue.id, to: r.comment.issueId }),
    links: r.many.issueLink({ from: r.issue.id, to: r.issueLink.issueId }),
  },
  run: {
    issue: r.one.issue({ from: r.run.issueId, to: r.issue.id, optional: false }),
    agent: r.one.member({ from: r.run.agentMemberId, to: r.member.id, optional: false }),
    triggeredBy: r.one.member({ from: r.run.triggeredByMemberId, to: r.member.id }),
    activities: r.many.activity({ from: r.run.id, to: r.activity.runId }),
    links: r.many.issueLink({ from: r.run.id, to: r.issueLink.runId }),
  },
  activity: {
    run: r.one.run({ from: r.activity.runId, to: r.run.id, optional: false }),
  },
  gateApprover: {
    state: r.one.workflowState({
      from: r.gateApprover.stateId,
      to: r.workflowState.id,
      optional: false,
    }),
    member: r.one.member({ from: r.gateApprover.memberId, to: r.member.id, optional: false }),
  },
  channel: {
    workspace: r.one.workspace({
      from: r.channel.workspaceId,
      to: r.workspace.id,
      optional: false,
    }),
    rules: r.many.routingRule({ from: r.channel.id, to: r.routingRule.channelId }),
  },
  routingRule: {
    channel: r.one.channel({
      from: r.routingRule.channelId,
      to: r.channel.id,
      optional: false,
    }),
    project: r.one.project({ from: r.routingRule.projectId, to: r.project.id }),
  },
  notificationPreference: {
    member: r.one.member({
      from: r.notificationPreference.memberId,
      to: r.member.id,
      optional: false,
    }),
  },
  issueLink: {
    issue: r.one.issue({ from: r.issueLink.issueId, to: r.issue.id, optional: false }),
    run: r.one.run({ from: r.issueLink.runId, to: r.run.id }),
  },
  comment: {
    issue: r.one.issue({ from: r.comment.issueId, to: r.issue.id, optional: false }),
    author: r.one.member({ from: r.comment.authorMemberId, to: r.member.id }),
  },
  label: {
    workspace: r.one.workspace({ from: r.label.workspaceId, to: r.workspace.id, optional: false }),
    issues: r.many.issue({
      from: r.label.id.through(r.issueLabel.labelId),
      to: r.issue.id.through(r.issueLabel.issueId),
    }),
  },
  issueLabel: {
    issue: r.one.issue({ from: r.issueLabel.issueId, to: r.issue.id, optional: false }),
    label: r.one.label({ from: r.issueLabel.labelId, to: r.label.id, optional: false }),
  },
  document: {
    issue: r.one.issue({ from: r.document.issueId, to: r.issue.id, optional: false }),
    versions: r.many.documentVersion({ from: r.document.id, to: r.documentVersion.documentId }),
  },
  roomState: {
    issue: r.one.issue({ from: r.roomState.issueId, to: r.issue.id, optional: false }),
    document: r.one.document({ from: r.roomState.documentId, to: r.document.id }),
  },
  documentVersionAuthor: {
    version: r.one.documentVersion({
      from: r.documentVersionAuthor.versionId,
      to: r.documentVersion.id,
      optional: false,
    }),
    member: r.one.member({
      from: r.documentVersionAuthor.memberId,
      to: r.member.id,
      optional: false,
    }),
  },
  documentVersion: {
    document: r.one.document({
      from: r.documentVersion.documentId,
      to: r.document.id,
      optional: false,
    }),
    author: r.one.member({ from: r.documentVersion.authorMemberId, to: r.member.id }),
    authors: r.many.documentVersionAuthor({
      from: r.documentVersion.id,
      to: r.documentVersionAuthor.versionId,
    }),
  },
  gateDecision: {
    issue: r.one.issue({ from: r.gateDecision.issueId, to: r.issue.id, optional: false }),
    state: r.one.workflowState({
      from: r.gateDecision.stateId,
      to: r.workflowState.id,
      optional: false,
    }),
    decidedBy: r.one.member({ from: r.gateDecision.memberId, to: r.member.id }),
    documents: r.many.gateDecisionDocument({
      from: r.gateDecision.id,
      to: r.gateDecisionDocument.decisionId,
    }),
  },
  gateDecisionDocument: {
    decision: r.one.gateDecision({
      from: r.gateDecisionDocument.decisionId,
      to: r.gateDecision.id,
      optional: false,
    }),
    document: r.one.document({
      from: r.gateDecisionDocument.documentId,
      to: r.document.id,
      optional: false,
    }),
  },
  workflowState: {
    project: r.one.project({ from: r.workflowState.projectId, to: r.project.id, optional: false }),
  },
  allowlistRule: {
    workspace: r.one.workspace({
      from: r.allowlistRule.workspaceId,
      to: r.workspace.id,
      optional: false,
    }),
    creator: r.one.member({ from: r.allowlistRule.createdBy, to: r.member.id }),
  },
  invitation: {
    workspace: r.one.workspace({
      from: r.invitation.workspaceId,
      to: r.workspace.id,
      optional: false,
    }),
    creator: r.one.member({ from: r.invitation.createdBy, to: r.member.id }),
    acceptedBy: r.one.member({ from: r.invitation.acceptedMemberId, to: r.member.id }),
  },
  notification: {
    recipient: r.one.member({
      from: r.notification.recipientMemberId,
      to: r.member.id,
      optional: false,
    }),
    event: r.one.event({ from: r.notification.eventId, to: r.event.seq, optional: false }),
    issue: r.one.issue({ from: r.notification.issueId, to: r.issue.id }),
  },
  event: {
    workspace: r.one.workspace({ from: r.event.workspaceId, to: r.workspace.id, optional: false }),
    actor: r.one.member({ from: r.event.actorMemberId, to: r.member.id }),
  },
  // An API key belongs to the Better Auth user its Member is (ADR-0007), so it
  // reaches the Member through the user rather than through member.id.
  apikey: {
    user: r.one.user({ from: r.apikey.referenceId, to: r.user.id, optional: false }),
  },
}));

// Parts are merged per table key, the way the Better Auth Drizzle docs describe:
// every table gets an entry, Better Auth's generated part supplies user/session/
// account, ours supplies workspace/member.
export const relations = {
  ...defineRelations(tables),
  ...authRelations,
  ...appRelations,
};
