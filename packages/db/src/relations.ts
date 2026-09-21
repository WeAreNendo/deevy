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
import { notification } from "./schema/notification.ts";
import { issueLink } from "./schema/link.ts";
import { issue } from "./schema/issue.ts";
import { project } from "./schema/project.ts";
import { socket } from "./schema/socket.ts";
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
  socket,
  project,
  issue,
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
};

const appRelations = defineRelationsPart(tables, (r) => ({
  workspace: {
    members: r.many.member({ from: r.workspace.id, to: r.member.workspaceId }),
    events: r.many.event({ from: r.workspace.id, to: r.event.workspaceId }),
    allowlistRules: r.many.allowlistRule({
      from: r.workspace.id,
      to: r.allowlistRule.workspaceId,
    }),
    invitations: r.many.invitation({ from: r.workspace.id, to: r.invitation.workspaceId }),
    sockets: r.many.socket({ from: r.workspace.id, to: r.socket.workspaceId }),
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
  },
  socket: {
    workspace: r.one.workspace({ from: r.socket.workspaceId, to: r.workspace.id, optional: false }),
    installer: r.one.member({ from: r.socket.installedBy, to: r.member.id }),
    /** The Projects bound to it, which is what a disconnect has to name. */
    projects: r.many.project({ from: r.socket.id, to: r.project.trackerSocketId }),
  },
  project: {
    workspace: r.one.workspace({
      from: r.project.workspaceId,
      to: r.workspace.id,
      optional: false,
    }),
    trackerSocket: r.one.socket({
      from: r.project.trackerSocketId,
      to: r.socket.id,
      optional: false,
    }),
    forgeSocket: r.one.socket({ from: r.project.forgeSocketId, to: r.socket.id }),
    docsSocket: r.one.socket({ from: r.project.docsSocketId, to: r.socket.id }),
    defaultAgent: r.one.member({ from: r.project.defaultAgentMemberId, to: r.member.id }),
    issues: r.many.issue({ from: r.project.id, to: r.issue.projectId }),
  },
  issue: {
    project: r.one.project({ from: r.issue.projectId, to: r.project.id, optional: false }),
    socket: r.one.socket({ from: r.issue.socketId, to: r.socket.id, optional: false }),
    assignee: r.one.member({ from: r.issue.assigneeMemberId, to: r.member.id }),
    creator: r.one.member({ from: r.issue.createdBy, to: r.member.id }),
    parent: r.one.issue({ from: r.issue.parentId, to: r.issue.id }),
    children: r.many.issue({ from: r.issue.id, to: r.issue.parentId }),
    runs: r.many.run({ from: r.issue.id, to: r.run.issueId }),
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
