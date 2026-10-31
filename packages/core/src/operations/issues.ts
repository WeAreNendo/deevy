import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@deevy/db";
import { IssueDetailSchema, IssueSummarySchema } from "../schemas.ts";
import { ORPCError } from "@orpc/server";
import { defineOperation, type ContextFor } from "./registry.ts";
import {
  ProjectSlugLookup,
  QueryFlag,
  issueWith,
  loadIssue,
  requireProject,
  resolveIssueRef,
} from "./shared.ts";

/** A page of a feed: the moment and the row, so two changes in one millisecond still order. */
const IssueCursor = /^(\d+):(.+)$/;

function parseIssueCursor(cursor: string): { at: Date; id: string } {
  const match = IssueCursor.exec(cursor);
  if (!match) throw new ORPCError("BAD_REQUEST", { message: "Not a cursor" });
  return { at: new Date(Number(match[1])), id: match[2] ?? "" };
}

export const issues = {
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
    }),
    output: IssueDetailSchema,
    handler: async ({ input, context }) => {
      // deevy's own copy, as the tracker last described it. The conversation
      // is the tracker's, and the Agent reads it there with its own access
      // (docs/plans/simplify.md, slice 4).
      const { issue } = await resolveIssueRef(context, input.issue);
      return loadIssue(context, issue.id);
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
