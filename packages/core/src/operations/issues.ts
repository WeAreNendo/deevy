import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@deevy/db";
import {
  delegationRefusalMessage,
  refusesDelegation,
  routeIssueTo,
  upsertProjection,
} from "../issues.ts";
import { IssueDetailSchema, IssueSummarySchema } from "../schemas.ts";
import { requireSocket, requireTracker, socketModuleFor } from "../sockets/registry.ts";
import { ORPCError } from "@orpc/server";
import { appendEvent } from "../events.ts";
import { defineOperation, type ContextFor } from "./registry.ts";
import {
  ProjectSlugLookup,
  QueryFlag,
  issueWith,
  loadIssue,
  requireAssignee,
  requireProject,
  resolveIssueRef,
} from "./shared.ts";

/**
 * Whether there is room for one more Issue under this parent, for the callers
 * the ceilings bind (docs/plans/sub-issue-delegation.md). A Human is not one of
 * them: somebody opening two hundred Issues by hand is not the failure mode
 * this exists for, and a limit that stops them is a support ticket.
 *
 * A refusal is an Event as well as an error, because the Agent will note it and
 * carry on and the Sponsor is the one who needs to know a number shaped the
 * work.
 */
async function assertRoomBelow(
  context: ContextFor<"member">,
  parent: { id: string; projectId: string },
  parentKey: string,
): Promise<void> {
  if (context.member.kind !== "agent") return;
  const refusal = await refusesDelegation(context.db, parent.id, context.workspace);
  if (!refusal) return;
  await appendEvent(context, {
    kind: "delegation.refused",
    subjectType: "issue",
    subjectId: parent.id,
    // The parent's Project, because the parent is what this is about: a
    // Project-scoped read of the log has to find it, and a tree may cross one.
    projectId: parent.projectId,
    payload: { limit: refusal.limit, allowed: refusal.allowed, parentKey },
  });
  throw new ORPCError("BAD_REQUEST", {
    message: delegationRefusalMessage(refusal, parentKey),
  });
}

/** A page of a feed: the moment and the row, so two changes in one millisecond still order. */
const IssueCursor = /^(\d+):(.+)$/;

function parseIssueCursor(cursor: string): { at: Date; id: string } {
  const match = IssueCursor.exec(cursor);
  if (!match) throw new ORPCError("BAD_REQUEST", { message: "Not a cursor" });
  return { at: new Date(Number(match[1])), id: match[2] ?? "" };
}

export const issues = {
  create: defineOperation({
    name: "issues.create",
    summary: "Open a record in the tracker a Project is bound to, and project it",
    method: "POST",
    path: "/issues",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({
      /**
       * The Issue this one is a part of, by id, URL or key. Its Project is
       * where the record is opened unless `projectSlug` names another one the
       * caller was granted (docs/plans/sub-issue-delegation.md).
       */
      parent: z.string().trim().min(1).nullish(),
      title: z.string().trim().min(1).max(300),
      body: z.string().max(100_000).nullish(),
      /**
       * The Agent this is for. It is written as the routing label the Project
       * names, so the tracker says who the work is for and deevy's own routing
       * reads it back the same way a Human's label would.
       */
      assignAgent: z.string().nullish(),
      /** Required when there is no parent to take the Project from. */
      projectSlug: ProjectSlugLookup.optional(),
    }),
    output: IssueDetailSchema,
    handler: async ({ input, context }) => {
      const parent = input.parent ? await resolveIssueRef(context, input.parent) : null;
      const project = input.projectSlug
        ? await requireProject(context, input.projectSlug)
        : parent
          ? await requireProject(context, parent.project.slug)
          : null;
      if (!project) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Name a Project, or the Issue this one is a part of",
        });
      }
      if (parent) await assertRoomBelow(context, parent.issue, parent.issue.externalKey);

      const assignee = input.assignAgent ? await requireAssignee(context, input.assignAgent) : null;
      if (assignee && assignee.kind !== "agent") {
        throw new ORPCError("BAD_REQUEST", {
          message: "Only an Agent is named by a routing label; assign a Human in the tracker",
        });
      }

      const row = await requireSocket(context, project.trackerSocketId);
      const tracker = requireTracker(await socketModuleFor(context, row));
      const label = assignee?.handle ? `${project.routing.labelPrefix}${assignee.handle}` : null;
      const external = await tracker.createIssue(project.trackerScope, {
        title: input.title,
        // The parent's URL in the body, because a tracker that cannot link two
        // records natively still has to say what this is a part of.
        body: [input.body ?? "", parent ? `Part of ${parent.issue.url}` : ""]
          .filter(Boolean)
          .join("\n\n"),
        parent: parent ? { externalId: parent.issue.externalId, url: parent.issue.url } : null,
        labels: label ? [label] : [],
      });

      const { issue } = await upsertProjection(context.db, {
        projectId: project.id,
        socketId: row.id,
        external,
        createdBy: context.member.id,
        parentId: parent?.issue.id ?? null,
      });

      await appendEvent(context, {
        kind: "issue.created",
        subjectType: "issue",
        subjectId: issue.id,
        projectId: project.id,
        payload: {
          key: issue.externalKey,
          url: issue.url,
          title: issue.title,
          ...(parent ? { parentKey: parent.issue.externalKey } : {}),
          /*
           * The parent, not the Agent: a wave of sub-issues is one line about
           * the parent, and `issueOf` points that line there because the parent
           * is the only place the work is whole. Only an Agent's fan-out is
           * rolled up, so what the Notification is stays a pure function of the
           * Event row, read again hours later with no request around it
           * (docs/plans/sub-issue-delegation.md, ADR-0003).
           */
          ...(parent && context.member.kind === "agent"
            ? { delegatedTo: parent.issue.id, delegatedBy: context.member.id }
            : {}),
          ...(assignee ? { assignedTo: assignee.id } : {}),
          ...(external.parentLinked ? {} : { parentLinked: false }),
        },
      });

      if (assignee) {
        await routeIssueTo(context.db, issue.id, assignee.id);
        await appendEvent(context, {
          kind: "issue.assigned",
          subjectType: "issue",
          subjectId: issue.id,
          projectId: project.id,
          payload: { from: null, to: assignee.id, toName: assignee.user.name, byRouting: true },
        });
      }

      // A record opened a moment ago has no conversation, and nobody asked
      // for one: `issues.get` is where a caller asks (ADR-0024).
      return { ...(await loadIssue(context, issue.id)), comments: null };
    },
  }),

  list: defineOperation({
    name: "issues.list",
    summary: "The records deevy has projected, newest change first",
    method: "GET",
    path: "/issues",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({
      /**
       * Left out, every Project the caller may see, newest change first, in
       * one query: "what is deevy working on" is a Workspace-wide question and
       * one list beats one per Project on D1's per-invocation budget.
       */
      projectSlug: ProjectSlugLookup.optional(),
      /** A tracker key (`acme/deevy#42`) or a word of the title. */
      q: z.string().trim().min(1).max(200).optional(),
      /** Where the last page stopped: `<millis>:<id>`. */
      cursor: z.string().optional(),
      /** What the tracker says: open, or closed. */
      state: z.enum(["open", "closed"]).optional(),
      /**
       * The provider's own word for the state — `In Review`, `Done` — which
       * folds across Projects whose trackers share it.
       */
      stateName: z.string().trim().min(1).max(100).optional(),
      assigneeMemberId: z.string().optional(),
      /** Only Issues routed to a Human, or only those routed to an Agent. */
      assigneeKind: z.enum(["human", "agent"]).optional(),
      /** Only Issues deevy has routed to nobody. */
      unassigned: QueryFlag.optional(),
      /** Only Issues held by an Agent this Human sponsors: "my Agents' work". */
      sponsorMemberId: z.string().optional(),
      /** A label the tracker carries. */
      label: z.string().trim().min(1).max(100).optional(),
      /** Only records the tracker has not closed. */
      open: QueryFlag.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    output: z.object({
      issues: z.array(IssueSummarySchema),
      /** Where to carry on from, or null when the page is the end. */
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
    }),
    handler: async ({ input, context }) => {
      const projects = input.projectSlug
        ? [await requireProject(context, input.projectSlug)]
        : await visibleProjects(context);
      const only = projects.length === 1 ? projects[0] : undefined;
      const clauses: SearchClause[] = [];
      if (input.cursor !== undefined) {
        const { at, id } = parseIssueCursor(input.cursor);
        clauses.push({
          RAW: (table) => sql`(${table.externalUpdatedAt}, ${table.id}) < (${at.getTime()}, ${id})`,
        });
      }
      if (input.q !== undefined) clauses.push(searchClause(input.q));
      if (input.label !== undefined) clauses.push(labelled(input.label));
      // The Assignee filters combine under AND: "Agents I sponsor, and this
      // one in particular" is a narrower question, not a contradiction.
      const assignee = {
        ...(input.assigneeKind === undefined ? {} : { kind: input.assigneeKind }),
        ...(input.sponsorMemberId === undefined ? {} : { sponsorId: input.sponsorMemberId }),
      };
      const page = await context.db.query.issue.findMany({
        where: {
          ...(only ? { projectId: only.id } : { projectId: { in: projects.map((one) => one.id) } }),
          ...(input.state === undefined ? {} : { state: input.state }),
          ...(input.stateName === undefined ? {} : { stateName: input.stateName }),
          ...(input.assigneeMemberId === undefined
            ? {}
            : { assigneeMemberId: input.assigneeMemberId }),
          ...(input.unassigned ? { assigneeMemberId: { isNull: true } } : {}),
          ...(Object.keys(assignee).length > 0 ? { assignee } : {}),
          ...(input.open ? { state: "open" as const } : {}),
          ...(clauses.length > 0 ? { AND: clauses } : {}),
        },
        with: issueWith,
        // A feed, so the newest change is first — the record's own change, not
        // the moment deevy last synced it. Two changes in one millisecond would
        // otherwise land in scan order, so the id breaks the tie the same way
        // every time and the cursor names both.
        orderBy: { externalUpdatedAt: "desc", id: "desc" },
        // One past the page, so `hasMore` costs no second query.
        limit: input.limit + 1,
      });
      const rows = page.slice(0, input.limit);
      const last = rows.at(-1);
      return {
        issues: rows,
        nextCursor: last ? `${String(last.externalUpdatedAt.getTime())}:${last.id}` : null,
        hasMore: page.length > input.limit,
      };
    },
  }),

  get: defineOperation({
    name: "issues.get",
    summary: "One record by id, URL or the tracker's key, with its family",
    method: "GET",
    path: "/issues/{issue}",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({
      /** An `iss_` id, the record's URL, or the key the tracker wrote. */
      issue: z.string().trim().min(1),
      /**
       * Read the conversation from the tracker as well. Off by default,
       * because it is a request to somebody else's API and most callers want
       * the record: an Agent about to work one asks for it, a list does not.
       */
      comments: QueryFlag.optional(),
    }),
    output: IssueDetailSchema,
    handler: async ({ input, context }) => {
      const { issue, project } = await resolveIssueRef(context, input.issue);
      const found = await loadIssue(context, issue.id);
      if (!input.comments) return { ...found, comments: null };

      // Best effort, and said so: a tracker that is down or a Socket that was
      // paused should not turn reading a record into a failure, and the
      // record itself is deevy's own (ADR-0024).
      try {
        const row = await requireSocket(context, project.trackerSocketId);
        const tracker = requireTracker(await socketModuleFor(context, row));
        const comments = await tracker.listComments(
          project.trackerScope,
          { externalId: issue.externalId, url: issue.url },
          50,
        );
        return { ...found, comments };
      } catch {
        return { ...found, comments: [] };
      }
    },
  }),
};

/** The Projects a Workspace-wide list reads: every unarchived one, or an Agent's grants. */
async function visibleProjects(context: ContextFor<"member">) {
  const granted = context.grantedProjectIds;
  return context.db.query.project.findMany({
    where: {
      workspaceId: context.workspace.id,
      archivedAt: { isNull: true },
      ...(granted ? { id: { in: granted } } : {}),
    },
    columns: { id: true, slug: true },
  });
}

/** One condition of an Issue query, in the relational query builder's own filter shape. */
type SearchClause = NonNullable<
  NonNullable<Parameters<Db["query"]["issue"]["findMany"]>[0]>["where"]
>;

/**
 * What `q` means: the tracker's key, or a word of the title. A key is matched
 * as a whole so `acme/deevy#4` does not find `#42`, and anything that is not
 * one is a word of the title. SQLite's LIKE is case-insensitive for ASCII,
 * which is what a key or a title is.
 */
function searchClause(q: string): SearchClause {
  return { OR: [{ externalKey: q }, titleContains(q)] };
}

/**
 * An Issue carrying this label. The labels are the tracker's, stored as a JSON
 * array, so the match is over the array's elements rather than the text of it:
 * a `LIKE '%bug%'` over the JSON would find `debug` and `bugfix` too.
 */
function labelled(label: string): SearchClause {
  return {
    RAW: (table) =>
      sql`exists (select 1 from json_each(${table.labels}) where json_each.value = ${label})`,
  };
}

/**
 * A title containing `q` as typed: `%` and `_` are LIKE's wildcards and a
 * backslash is the escape character this names, so all three are escaped
 * first. The relational `like` filter emits no ESCAPE clause, which is why
 * this is raw SQL: without it "100%" matched every title with "100" in it.
 */
function titleContains(q: string): SearchClause {
  const pattern = `%${q.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
  return { RAW: (table) => sql`${table.title} LIKE ${pattern} ESCAPE '\\'` };
}
