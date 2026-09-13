/**
 * Helpers every area shares: the lookups that turn a key into a row and refuse
 * when it is not there, and the input shapes more than one operation uses. Split
 * out of one file so an area can be edited on its own.
 */
import { and, count, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { allowlistRuleKinds, member as memberTable } from "@deevy/db";
import { loadAgent } from "../agents.ts";
import { issueKey, parseIssueKey } from "../issues.ts";
import { ensureStateDocument } from "../documents.ts";
import { ProjectKeyPattern } from "../projects.ts";
import { gateStanding } from "../workflow.ts";
import { ORPCError } from "@orpc/server";
import { appendEvent } from "../events.ts";
import type { Run } from "@deevy/db";
import type { AppContext, ContextFor } from "./registry.ts";

/** The Member an admin operation names, or NOT_FOUND. Scoped to the Workspace. */
export async function findMember(context: ContextFor<"admin">, memberId: string) {
  const found = await context.db.query.member.findFirst({
    where: { id: memberId, workspaceId: context.workspace.id },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Member of this Workspace" });
  return found;
}

/** A Workspace always keeps one admin who can still act, so the last one is protected. */
export async function assertNotTheLastAdmin(context: ContextFor<"admin">, memberId: string) {
  const [row] = await context.db
    .select({ remaining: count() })
    .from(memberTable)
    .where(
      and(
        eq(memberTable.workspaceId, context.workspace.id),
        eq(memberTable.role, "admin"),
        isNull(memberTable.suspendedAt),
        ne(memberTable.id, memberId),
      ),
    );
  if ((row?.remaining ?? 0) === 0) {
    throw new ORPCError("BAD_REQUEST", {
      message: "A Workspace needs one admin: this is the last one",
    });
  }
}

/**
 * The Agent an operation names, or NOT_FOUND, plus the rule that only its
 * Sponsor or an admin may change it (docs/plans/m2.md). A Sponsor answers for
 * their own Agent; nobody else's.
 */
export async function requireSponsoredAgent(context: ContextFor<"member">, memberId: string) {
  const found = await context.db.query.member.findFirst({
    where: { id: memberId, workspaceId: context.workspace.id, kind: "agent" },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Agent in this Workspace" });
  if (context.member.role !== "admin" && found.sponsorId !== context.member.id) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only an Agent's Sponsor or an admin can do that",
    });
  }
  return found;
}

/** Reads an Agent back after a write, in the shape every Agent operation returns. */
export async function reloadAgent(context: ContextFor<"member">, memberId: string) {
  const row = await loadAgent(context.db, memberId);
  if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
  return row;
}

/** The Projects an Agent may see, read back after a grant changed. */
export async function grantedProjects(context: ContextFor<"member">, memberId: string) {
  const row = await context.db.query.member.findFirst({
    where: { id: memberId },
    with: { grantedProjects: true },
  });
  return { projects: row?.grantedProjects ?? [] };
}

/** A handle is what a mention resolves to, so it shares one namespace with Teams. */
export const HandleInput = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "A handle is lowercase letters, digits and hyphens");

/**
 * What an allowlist rule holds, whatever its kind: trimmed, lowercased so a
 * rule matches whatever case the sign-in arrives in, short enough to be a name
 * rather than a document, and made of the characters all three kinds are made
 * of. The exact shape is the kind's, checked below — this is the widest of the
 * three, and the one an OpenAPI reader sees, since a `pattern` cannot depend on
 * a sibling field.
 */
const AllowlistValue = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(255)
  .regex(
    /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/,
    "A domain such as example.com, an organization login, or a group path",
  );

/**
 * The shape a value may take is its kind's, because the three are not one
 * shape. An email domain and a GitHub organization login are dotted labels; a
 * GitLab group is a path — `acme/platform`, subgroups nested, `_` and `.`
 * legal — which the label pattern refuses and which is not a domain
 * (docs/plans/sign-in.md).
 */
const allowlistValueShapes = {
  email_domain: {
    pattern: /^[a-z0-9-]+(\.[a-z0-9-]+)*$/,
    message: "A domain such as example.com",
  },
  github_org: {
    // A GitHub login is one label: letters, digits and single hyphens, never a
    // dot. `example.com` in this field is a rule that can never match, and it
    // was accepted because this shape was the email domain's
    // (docs/plans/sign-in.md).
    pattern: /^[a-z0-9](-?[a-z0-9])*$/,
    message: "An organization login such as acme",
  },
  gitlab_group: {
    pattern: /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/,
    message: "A group path such as acme/platform",
  },
} satisfies Record<(typeof allowlistRuleKinds)[number], { pattern: RegExp; message: string }>;

/**
 * A rule as an admin states one. The kind is checked with the value rather
 * than beside it, so the message names the shape the admin was actually asked
 * for instead of the union of all three.
 */
export const AllowlistRuleInput = z
  .object({ kind: z.enum(allowlistRuleKinds), value: AllowlistValue })
  .superRefine(({ kind, value }, ctx) => {
    const { pattern, message } = allowlistValueShapes[kind];
    if (!pattern.test(value)) ctx.addIssue({ code: "custom", message, path: ["value"] });
  });

/** Strict on the way in: `dev` is a mistake worth reporting, not something to correct silently. */
export const ProjectKey = z
  .string()
  .trim()
  .regex(ProjectKeyPattern, "Two to six uppercase letters, as in DEV");

/** Lenient on the way out, so `/projects/dev` finds DEV. */
export const ProjectKeyLookup = z.string().trim().toUpperCase().regex(ProjectKeyPattern);

/**
 * A boolean in a GET input. The OpenAPI surface sends it as a query string and
 * the RPC link sends a real boolean, so both are accepted.
 */
export const QueryFlag = z.union([z.boolean(), z.stringbool()]);

/**
 * An Agent sees only the Projects it was granted, and an ungranted Project does
 * not exist to it rather than being forbidden (docs/plans/m2.md). The check sits
 * here and in requireIssue because those are the two places that already hold
 * the Project row; a middleware would have to resolve the id a second time.
 */
export function assertProjectVisible(context: ContextFor<"member">, projectId: string): void {
  const granted = context.grantedProjectIds;
  if (granted && !granted.includes(projectId)) {
    throw new ORPCError("NOT_FOUND", { message: "No such Project" });
  }
}

/** The Project an operation names by key, or NOT_FOUND. Scoped to the Workspace. */
export async function requireProject(context: ContextFor<"member">, key: string) {
  const found = await context.db.query.project.findFirst({
    where: { workspaceId: context.workspace.id, key },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Project" });
  assertProjectVisible(context, found.id);
  return found;
}

/**
 * An admin, or a Member of the Team that owns the Project, may change it. A
 * Project no Team owns is the admins' to change (docs/plans/m1.md).
 */
export async function requireProjectOrAdmin(context: ContextFor<"member">, key: string) {
  const found = await requireProject(context, key);
  if (context.member.role === "admin") return found;
  const onTeam = found.teamId
    ? await context.db.query.teamMember.findFirst({
        where: { teamId: found.teamId, memberId: context.member.id },
      })
    : undefined;
  if (!onTeam) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only an admin or a Member of the owning Team can change this Project",
    });
  }
  return found;
}

/** The Team an operation names, or NOT_FOUND. Scoped to the Workspace. */
export async function requireTeam(context: ContextFor<"member">, teamId: string) {
  const found = await context.db.query.team.findFirst({
    where: { id: teamId, workspaceId: context.workspace.id },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Team in this Workspace" });
  return found;
}

/** A Project with its Workflow and Team, the shape every Project operation returns. */
export async function loadProject(db: ContextFor<"member">["db"], id: string) {
  const found = await db.query.project.findFirst({
    where: { id },
    with: { states: { orderBy: { position: "asc" } }, team: true },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Project" });
  return found;
}

/** A Team with the Members on it, the shape every Team operation returns. */
export async function loadTeam(db: ContextFor<"member">["db"], id: string) {
  const found = await db.query.team.findFirst({
    where: { id },
    with: { members: { with: { user: true } } },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Team" });
  return found;
}

/**
 * A Team is not a permission wall, but its own Members maintain it: an admin,
 * or someone on the Team, may change it (docs/plans/m1.md).
 */
export async function requireTeamOrAdmin(context: ContextFor<"member">, teamId: string) {
  const found = await requireTeam(context, teamId);
  if (context.member.role === "admin") return found;
  const onTeam = await context.db.query.teamMember.findFirst({
    where: { teamId, memberId: context.member.id },
  });
  if (!onTeam) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only an admin or a Member of this Team can do that",
    });
  }
  return found;
}

/** The relations every Issue shape needs loaded, and the key derived onto it. */
export const issueWith = { state: true, assignee: { with: { user: true } }, labels: true } as const;

export type LoadedIssue = { number: number; project?: { key: string } } & Record<string, unknown>;

export function withKey<T extends LoadedIssue>(row: T, projectKey: string) {
  return { ...row, key: issueKey(projectKey, row.number) };
}

/** The Issue an operation names by key, or NOT_FOUND. Scoped to the Workspace. */
export async function requireIssue(context: ContextFor<"member">, key: string) {
  const parsed = parseIssueKey(key);
  if (!parsed) throw new ORPCError("NOT_FOUND", { message: "Not an Issue key" });
  const project = await context.db.query.project.findFirst({
    where: { workspaceId: context.workspace.id, key: parsed.projectKey },
  });
  if (!project) throw new ORPCError("NOT_FOUND", { message: "No such Project" });
  assertProjectVisible(context, project.id);
  const found = await context.db.query.issue.findFirst({
    where: { projectId: project.id, number: parsed.number },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: `No such Issue: ${key}` });
  return { issue: found, project };
}

export async function loadIssue(context: ContextFor<"member">, id: string) {
  const found = await context.db.query.issue.findFirst({
    where: { id },
    with: {
      ...issueWith,
      project: true,
      parent: { with: issueWith },
      children: { with: issueWith, orderBy: { number: "asc" } },
      gateDecisions: { orderBy: { createdAt: "asc" }, with: { documents: true } },
    },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Issue" });
  const key = found.project.key;
  // Only a Gate has a standing, and only a Gate pays for one: an Issue in Build
  // asks nothing (docs/plans/four-eyes-gates.md).
  const gate = found.state.isGate
    ? await gateStanding(context.db, {
        workspaceId: context.workspace.id,
        issue: found,
        state: found.state,
        memberId: context.member.id,
        decisions: found.gateDecisions,
      })
    : null;
  return {
    ...withKey(found, key),
    parent: found.parent ? withKey(found.parent, key) : null,
    children: found.children.map((child) => withKey(child, key)),
    gateDecisions: found.gateDecisions.map((decision) => ({
      ...decision,
      documents: decision.documents.map((pinned) => ({
        name: pinned.name,
        version: pinned.version,
      })),
    })),
    gate,
  };
}

/** The Member an Issue may be assigned to, or BAD_REQUEST. */
export async function requireAssignee(context: ContextFor<"member">, memberId: string) {
  const found = await context.db.query.member.findFirst({
    where: { id: memberId, workspaceId: context.workspace.id },
    // With their name, because every caller that checks an Assignee is about to
    // write one into an Event, and a second query for it would be a second
    // statement against the budget.
    with: { user: { columns: { name: true } } },
  });
  if (!found) {
    throw new ORPCError("BAD_REQUEST", {
      message: "An Issue can only be assigned to a Member of this Workspace",
    });
  }
  return found;
}

/**
 * Creates the Document the State an Issue just entered asks for, and records
 * it. Called wherever an Issue enters a State: on create, move, approve and
 * reject (docs/plans/m1.md).
 */
export async function openStateDocument(
  context: ContextFor<"member">,
  issueId: string,
  projectId: string,
  state: { documentName: string | null; documentTemplate: string | null },
) {
  const created = await ensureStateDocument(context.db, issueId, state, context.member.id);
  if (!created) return;
  await appendEvent(context, {
    kind: "document.created",
    subjectType: "issue",
    subjectId: issueId,
    projectId,
    payload: { name: created.name, documentId: created.id },
  });
}

/** The Issue, its Project, and that Project's States in order: what a move needs. */
export async function requireIssueForMove(context: ContextFor<"member">, key: string) {
  const { issue, project } = await requireIssue(context, key);
  const states = await context.db.query.workflowState.findMany({
    where: { projectId: project.id },
    orderBy: { position: "asc" },
  });
  const from = states.find((state) => state.id === issue.stateId);
  if (!from) throw new ORPCError("BAD_REQUEST", { message: "This Issue is in no known State" });
  return { issue, project, states, from };
}

/** The Document an operation names on an Issue, or NOT_FOUND. */
export async function requireDocument(
  context: ContextFor<"member">,
  issueId: string,
  name: string,
) {
  const found = await context.db.query.document.findFirst({
    where: { issueId, name },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: `This Issue has no ${name} Document` });
  return found;
}

export async function loadComment(context: ContextFor<"member">, id: string) {
  const found = await context.db.query.comment.findFirst({
    where: { id },
    with: { author: { with: { user: true } } },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such comment" });
  return found.deletedAt ? { ...found, body: "" } : found;
}

/** The Label an operation names, or NOT_FOUND. Scoped to the Workspace. */
export async function requireLabel(context: ContextFor<"member">, labelId: string) {
  const found = await context.db.query.label.findFirst({
    where: { id: labelId, workspaceId: context.workspace.id },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Label in this Workspace" });
  return found;
}

/** The comment an operation names, with the Issue it belongs to. Scoped to the Workspace. */
export async function requireComment(context: ContextFor<"member">, commentId: string) {
  const found = await context.db.query.comment.findFirst({
    where: { id: commentId },
    with: { issue: { with: { project: true } } },
  });
  if (!found || found.issue.project.workspaceId !== context.workspace.id) {
    throw new ORPCError("NOT_FOUND", { message: "No such comment" });
  }
  return found;
}

/** Its author may change a comment; an admin may also remove one. */
export function assertMayEdit(context: ContextFor<"member">, authorMemberId: string | null) {
  if (authorMemberId === context.member.id) return;
  throw new ORPCError("FORBIDDEN", { message: "Only its author can change this comment" });
}

/** The Run an operation names, with the Issue key every surface shows. */
export function runView(row: Run, issueKey: string) {
  return {
    id: row.id,
    issueKey,
    agentMemberId: row.agentMemberId,
    triggeredByMemberId: row.triggeredByMemberId,
    trigger: row.trigger,
    status: row.status,
    summary: row.summary,
    startedAt: row.startedAt,
    lastActivityAt: row.lastActivityAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Runs page newest first, and two Runs can share a millisecond, so the cursor
 * is the pair that is unique: the createdAt of the last row and its id. A
 * cursor on the timestamp alone would drop the loser of a tie.
 */
export const RunCursor = /^(\d+):(.+)$/;

export function parseRunCursor(cursor: string): { at: Date; id: string } {
  const match = RunCursor.exec(cursor);
  if (!match) throw new ORPCError("BAD_REQUEST", { message: "Not a cursor from this list" });
  return { at: new Date(Number(match[1])), id: match[2] as string };
}

/** The Run an operation names, or NOT_FOUND. Scoped to the Workspace and to what the caller may see. */
export async function requireRun(context: ContextFor<"member">, runId: string) {
  const found = await context.db.query.run.findFirst({
    where: { id: runId },
    with: { issue: { with: { project: true } } },
  });
  if (!found || found.issue.project.workspaceId !== context.workspace.id) {
    throw new ORPCError("NOT_FOUND", { message: "No such Run" });
  }
  assertProjectVisible(context, found.issue.projectId);
  return {
    run: found,
    issue: found.issue,
    project: found.issue.project,
    key: issueKey(found.issue.project.key, found.issue.number),
  };
}

/**
 * An Activity is what an Agent posts to its own Run (CONTEXT.md), so nobody
 * else writes into that feed: another Agent's Run is not theirs to narrate, and
 * a Human speaks through `runs.answer`.
 */
export function assertOwnRun(context: ContextFor<"member">, run: Run): void {
  if (run.agentMemberId !== context.member.id) {
    throw new ORPCError("FORBIDDEN", { message: "This Run belongs to another Agent" });
  }
}

/**
 * deevy signs what it POSTs, which is worth nothing over cleartext: an Event
 * body and its signature on the wire is the Workspace on the wire. Every route
 * that writes a webhook_subscription uses this, so there is no second door.
 */
export const SubscriptionUrl = z.url().max(2048).startsWith("https://");

/**
 * Long enough that guessing it is not a way in. It is never read back, so a
 * Human who loses it sets another rather than being shown this one.
 */
export const SubscriptionSecret = z.string().min(16).max(200);

/**
 * The origin a link a Human is meant to click is built on: the SPA's own when
 * this deployment gives it one, else the origin the API answers on.
 *
 * They are the same in the image and on the Worker, which serve the SPA
 * themselves — but `baseURL` is the API's origin, the one the OAuth issuer and
 * the MCP resource are bound to, and in the `dev` loop or on a split-origin
 * deployment that is a different port from the page a Human has open. A link
 * built on it 404s (docs/plans/sign-in.md).
 */
export function linkOrigin(context: Pick<AppContext, "webURL" | "baseURL">): string {
  return (context.webURL ?? context.baseURL ?? "").replace(/\/+$/, "");
}
