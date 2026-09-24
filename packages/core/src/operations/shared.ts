/**
 * Helpers every area shares: the lookups that turn a key into a row and refuse
 * when it is not there, and the input shapes more than one operation uses. Split
 * out of one file so an area can be edited on its own.
 */
import { and, count, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import {
  allowlistRuleKinds,
  issueLink as issueLinkTable,
  issueLinkKinds,
  member as memberTable,
} from "@deevy/db";
import { loadAgent } from "../agents.ts";
import { appendEvent } from "../events.ts";
import { newId } from "../ids.ts";
import { parseIssueRef } from "../issues.ts";
import { parseLink } from "../links.ts";
import { ProjectSlugPattern } from "../projects.ts";
import { ORPCError } from "@orpc/server";
import type { Issue, Project, Run } from "@deevy/db";
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

/** Strict on the way in: a slug is a URL handle and a typo in one is a 404 later. */
export const ProjectSlug = z
  .string()
  .trim()
  .regex(ProjectSlugPattern, "Lowercase letters, numbers and hyphens, as in acme-deevy");

/** Lenient on the way out, so `/projects/Acme-Deevy` finds it. */
export const ProjectSlugLookup = z.string().trim().toLowerCase().regex(ProjectSlugPattern);

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
  if (!projectVisible(context, projectId)) {
    throw new ORPCError("NOT_FOUND", { message: "No such Project" });
  }
}

/**
 * The same question without the throw, for the places that have to leave
 * something out rather than refuse: a parent or a child in a Project this
 * caller was not granted is not shown to them at all
 * (docs/plans/sub-issue-delegation.md). Null grants are a Human, who sees
 * every Project this Workspace has.
 */
export function projectVisible(context: ContextFor<"member">, projectId: string): boolean {
  const granted = context.grantedProjectIds;
  return !granted || granted.includes(projectId);
}

/** The Project an operation names by slug, or NOT_FOUND. Scoped to the Workspace. */
export async function requireProject(context: ContextFor<"member">, slug: string) {
  const found = await context.db.query.project.findFirst({
    where: { workspaceId: context.workspace.id, slug },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Project" });
  assertProjectVisible(context, found.id);
  return found;
}

/**
 * Who may change a Project's binding. An admin: a binding names a Socket and a
 * container, and pointing a Project at somebody else's repository is not a
 * Project-level decision (ADR-0024). Teams used to soften this and are gone.
 */
export async function requireProjectOrAdmin(context: ContextFor<"member">, slug: string) {
  const found = await requireProject(context, slug);
  if (context.member.role === "admin") return found;
  throw new ORPCError("FORBIDDEN", {
    message: "Only an admin can change what a Project is bound to",
  });
}

/** A Project as every Project operation returns one: the row and its binding. */
export async function loadProject(db: ContextFor<"member">["db"], id: string) {
  const found = await db.query.project.findFirst({ where: { id } });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Project" });
  return found;
}

/** The relations every Issue shape needs loaded. State and Labels are columns now. */
export const issueWith = { assignee: { with: { user: true } } } as const;

/**
 * The Issue an operation names, by id, by URL or by the tracker's key.
 *
 * The URL is canonical because it is what a Human pastes and what a delivery
 * carries. A key may be ambiguous — two Sockets can both know an
 * `acme/deevy#42` — and this refuses rather than picking one, because picking
 * one silently is how an Agent works somebody else's Issue (ADR-0024).
 */
export async function resolveIssueRef(context: ContextFor<"member">, ref: string) {
  const parsed = parseIssueRef(ref);
  const rows = await context.db.query.issue.findMany({
    where:
      parsed.by === "id"
        ? { id: parsed.id }
        : parsed.by === "url"
          ? { url: parsed.url }
          : { externalKey: parsed.key },
    with: { project: true },
    limit: 2,
  });
  const visible = rows.filter(
    (row) =>
      row.project.workspaceId === context.workspace.id && projectVisible(context, row.projectId),
  );
  const [first, second] = visible;
  if (!first) throw new ORPCError("NOT_FOUND", { message: `No such Issue: ${ref}` });
  if (second) {
    throw new ORPCError("CONFLICT", {
      message: `Two Sockets know an Issue called ${ref}. Name it by its URL.`,
    });
  }
  const { project, ...issue } = first;
  return { issue: issue as Issue, project };
}

export async function loadIssue(context: ContextFor<"member">, id: string) {
  const found = await context.db.query.issue.findFirst({
    where: { id },
    with: {
      ...issueWith,
      project: true,
      // Each related Issue with its own Project, because a tree may cross one
      // (docs/plans/sub-issue-delegation.md). One relation, not a query each.
      parent: { with: { ...issueWith, project: true } },
      children: { with: { ...issueWith, project: true }, orderBy: { externalKey: "asc" } },
    },
  });
  if (!found) throw new ORPCError("NOT_FOUND", { message: "No such Issue" });
  const shown = found.children.filter((child) => projectVisible(context, child.projectId));
  /*
   * Which children an Agent is working right now: one query for all of them,
   * not one each, so reading an Issue costs the same whether it has one child
   * or six (`budget.test.ts`).
   */
  const working = new Set(
    shown.length === 0
      ? []
      : (
          await context.db.query.run.findMany({
            where: {
              issueId: { in: shown.map((child) => child.id) },
              status: { in: ["pending", "active", "awaiting_input"] },
            },
            columns: { issueId: true },
          })
        ).map((run) => run.issueId),
  );
  // What this Project asks a Run to stop at. One query, on the read where the
  // answer is part of the brief rather than on every list (schemas.ts).
  const checkpoints = await context.db.query.checkpoint.findMany({
    where: { projectId: found.projectId },
    columns: { name: true },
    orderBy: { name: "asc" },
  });
  return {
    ...found,
    parent: found.parent && projectVisible(context, found.parent.projectId) ? found.parent : null,
    children: shown.map((child) => ({ ...child, hasOpenRun: working.has(child.id) })),
    checkpoints: checkpoints.map((row) => row.name),
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

/** The Run an operation names, with the Issue key the tracker wrote. */
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
    key: found.issue.externalKey,
  };
}

/**
 * Where a Project's code is, or the refusal that says it has none.
 *
 * A Project without a forge binding is ordinary — a tracker with no repository
 * behind it is a perfectly good Project — so this is a `NOT_FOUND` about the
 * repository rather than an error about the Project (docs/plans/sockets.md).
 */
export interface ForgeBinding {
  socketId: string;
  scope: Record<string, unknown>;
  baseBranch: string;
}

/**
 * Where a Project's code is, or null when it has none.
 *
 * A Project bound to a tracker and nothing else is ordinary: its Runs read,
 * decide and say things, and write no code (ADR-0024). So this answers rather
 * than refuses, and the caller decides whether the absence is a problem.
 */
export function forgeBindingOf(project: Project): ForgeBinding | null {
  if (!project.forgeSocketId || !project.forgeScope) return null;
  const scope = project.forgeScope;
  const baseBranch = typeof scope.baseBranch === "string" ? scope.baseBranch : "main";
  return { socketId: project.forgeSocketId, scope, baseBranch };
}

/** The same, for the caller that asked for something only a repository can give. */
export function requireForgeBinding(project: Project): ForgeBinding {
  const binding = forgeBindingOf(project);
  if (!binding) {
    throw new ORPCError("NOT_FOUND", { message: "This Project has no repository" });
  }
  return binding;
}

export interface IssueLinkInput {
  issue: { id: string };
  project: { id: string };
  url: string;
  title?: string | null;
  kind?: (typeof issueLinkKinds)[number];
  /** The Run that produced it, so evidence is attributed to the attempt. */
  runId?: string | null;
}

/**
 * Attaches evidence to a record, and says so in the log.
 *
 * One path for `links.add` and for the pull request `pulls.open` opens, so a
 * link looks the same whoever attached it and the Event carries the Run either
 * way (docs/plans/sockets.md, slice 6).
 */
export async function addIssueLink(context: ContextFor<"member">, input: IssueLinkInput) {
  const parsed = parseLink(input.url);
  const id = newId("link");
  await context.db.insert(issueLinkTable).values({
    id,
    issueId: input.issue.id,
    kind: input.kind ?? parsed.kind,
    url: input.url,
    title: input.title ?? null,
    ref: parsed.ref,
    runId: input.runId ?? null,
    createdBy: context.member.id,
  });
  await appendEvent(context, {
    kind: "issue.link_added",
    subjectType: "issue",
    subjectId: input.issue.id,
    projectId: input.project.id,
    payload: {
      linkId: id,
      kind: input.kind ?? parsed.kind,
      url: input.url,
      // What a mirrored comment names the link by, where somebody named it.
      ...(input.title ? { title: input.title } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
    },
  });
  const row = await context.db.query.issueLink.findFirst({ where: { id } });
  if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
  return row;
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
