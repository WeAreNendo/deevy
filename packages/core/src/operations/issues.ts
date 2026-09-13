import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { issue as issueTable, type Db } from "@deevy/db";
import { insertIssue, isSelfOrDescendant, issueKey, nextIssueNumber } from "../issues.ts";
import { oneLabelPerScope, replaceIssueLabels } from "../labels.ts";
import { resolveMentions } from "../mentions.ts";
import { assertLeavable, enterState } from "../workflow.ts";
import { IssueDetailSchema, IssueSummarySchema } from "../schemas.ts";
import { ORPCError } from "@orpc/server";
import { appendEvent } from "../events.ts";
import { defineOperation, type ContextFor } from "./registry.ts";
import {
  ProjectKeyLookup,
  QueryFlag,
  issueWith,
  loadIssue,
  openStateDocument,
  requireAssignee,
  requireIssue,
  requireIssueForMove,
  requireProject,
  projectVisible,
  withKey,
} from "./shared.ts";

export const issues = {
  create: defineOperation({
    name: "issues.create",
    summary: "Add an Issue to a Project, in the first State of its Workflow",
    method: "POST",
    path: "/issues",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({
      projectKey: ProjectKeyLookup,
      title: z.string().trim().min(1).max(300),
      description: z.string().max(100_000).nullish(),
      assigneeMemberId: z.string().nullish(),
      parentKey: z.string().nullish(),
    }),
    output: IssueDetailSchema,
    handler: async ({ input, context }) => {
      const project = await requireProject(context, input.projectKey);
      const first = await context.db.query.workflowState.findFirst({
        where: { projectId: project.id },
        orderBy: { position: "asc" },
      });
      if (!first) {
        throw new ORPCError("BAD_REQUEST", { message: "This Project has no Workflow States" });
      }
      const assignee = input.assigneeMemberId
        ? await requireAssignee(context, input.assigneeMemberId)
        : null;

      let parentId: string | null = null;
      let parentKey: string | null = null;
      if (input.parentKey) {
        /*
         * Any Project the caller was granted, not only this one. Work has
         * dependencies that run across Projects, and a delegation that stops at
         * the boundary does not remove the dependency — it moves it onto a
         * Human writing it down twice (docs/plans/sub-issue-delegation.md).
         * `requireIssue` is the whole access rule: a parent in a Project this
         * caller does not hold answers "No such Issue".
         */
        const parent = await requireIssue(context, input.parentKey);
        parentId = parent.issue.id;
        parentKey = issueKey(parent.project.key, parent.issue.number);
      }

      const number = await nextIssueNumber(context.db, project.id);
      const created = await insertIssue(context.db, {
        projectId: project.id,
        number,
        title: input.title,
        description: input.description,
        stateId: first.id,
        assigneeMemberId: input.assigneeMemberId,
        parentId,
        createdBy: context.member.id,
      });
      await appendEvent(context, {
        kind: "issue.created",
        subjectType: "issue",
        subjectId: created.id,
        projectId: project.id,
        // The State it landed in, so a reader of the log or the inbox sees
        // where the Issue started, not where it is now. And what it was opened
        // under, so an Activity about a sub-issue names its parent rather than
        // leaving the reader to click (docs/plans/sub-issue-delegation.md).
        payload: {
          key: issueKey(project.key, number),
          title: created.title,
          state: first.name,
          ...(parentKey ? { parentKey } : {}),
        },
      });
      /*
       * Handed to somebody at birth is still being handed to them: the Event
       * goes in, so their inbox hears about it and an Agent's Run starts. It
       * follows `issue.created` rather than preceding it, because a reader of
       * the log should see the Issue exist before it is given away, and because
       * `triggersFor` reads the Issue when the assignment reaches it.
       *
       * Where the first State's own rule names the same Agent, both Events want
       * a Run and only one is opened: the "at most one open Run per
       * (issue, agent)" rule in `startRun` is what settles it.
       */
      if (assignee) {
        await appendEvent(context, {
          kind: "issue.assigned",
          subjectType: "issue",
          subjectId: created.id,
          projectId: project.id,
          payload: {
            from: null,
            to: assignee.id,
            fromName: null,
            toName: assignee.user.name,
          },
        });
      }
      await openStateDocument(context, created.id, project.id, first);
      return loadIssue(context, created.id);
    },
  }),

  list: defineOperation({
    name: "issues.list",
    summary: "A Project's Issues, by number, from a cursor",
    method: "GET",
    // Not under /projects/{projectKey}: the Project is optional now, and a path
    // parameter cannot be. Nothing outside this repository called the old path.
    path: "/issues",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({
      /**
       * Left out, every Project the caller may see, newest change first, in
       * one query: the Issues home and the command palette are Workspace-wide
       * screens, and one list beats one per Project on D1's per-invocation
       * budget (docs/plans/ui-redesign.md slice 2). Named, that Project's
       * Issues in key order, paged by `after`.
       */
      projectKey: ProjectKeyLookup.optional(),
      /**
       * An Issue key (`DEV-12`), a number, or a word of the title. A key finds
       * exactly that Issue; anything else matches titles, case-insensitively.
       */
      q: z.string().trim().min(1).max(200).optional(),
      /**
       * Return Issues numbered above this. A cursor over numbers means
       * nothing across Projects, so it is ignored without a projectKey.
       */
      after: z.coerce.number().int().nonnegative().optional(),
      stateId: z.string().optional(),
      /**
       * A State by name rather than id: States belong to a Project, and a
       * Workspace-wide list spans Projects whose Workflows share names
       * (Done is Done everywhere), so the name is what folds across them.
       */
      stateName: z.string().trim().min(1).max(100).optional(),
      assigneeMemberId: z.string().optional(),
      /** Only Issues held by a Human, or only those held by an Agent. */
      assigneeKind: z.enum(["human", "agent"]).optional(),
      /** Only Issues nobody holds. */
      unassigned: QueryFlag.optional(),
      /** Only Issues held by an Agent this Human sponsors: "my Agents' Issues". */
      sponsorMemberId: z.string().optional(),
      labelId: z.string().optional(),
      /** Only Issues whose State is not a `done` one. */
      open: QueryFlag.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    output: z.object({
      issues: z.array(IssueSummarySchema),
      /** The number of the last Issue returned, or null when the page is empty. */
      nextCursor: z.number().int().nullable(),
      /**
       * Whether more Issues matched than the page holds. A Project's list
       * turns the page with `after`; the Workspace-wide feed has no cursor,
       * so this is how a screen knows to say "narrow the filters" rather
       * than lie with a count.
       */
      hasMore: z.boolean(),
    }),
    handler: async ({ input, context }) => {
      const projects = input.projectKey
        ? [await requireProject(context, input.projectKey)]
        : await visibleProjects(context);
      const keyOf = new Map(projects.map((project) => [project.id, project.key]));
      const only = projects.length === 1 ? projects[0] : undefined;
      // The cursor and the search each constrain `number`, so they sit side by
      // side under AND rather than in one object where the later would win:
      // `q: "DEV-12"` past a cursor of 20 is nothing, not DEV-12.
      const clauses: SearchClause[] = [];
      if (input.projectKey && input.after !== undefined) {
        clauses.push({ number: { gt: input.after } });
      }
      if (input.q !== undefined) clauses.push(searchClause(input.q, projects));
      // The Assignee filters combine under AND: "Agents I sponsor, and this
      // one in particular" is a narrower question, not a contradiction.
      const assignee = {
        ...(input.assigneeKind === undefined ? {} : { kind: input.assigneeKind }),
        ...(input.sponsorMemberId === undefined ? {} : { sponsorId: input.sponsorMemberId }),
      };
      const page = await context.db.query.issue.findMany({
        where: {
          ...(only ? { projectId: only.id } : { projectId: { in: [...keyOf.keys()] } }),
          ...(input.stateId === undefined ? {} : { stateId: input.stateId }),
          ...(input.stateName === undefined ? {} : { state: { name: input.stateName } }),
          ...(input.assigneeMemberId === undefined
            ? {}
            : { assigneeMemberId: input.assigneeMemberId }),
          ...(input.unassigned ? { assigneeMemberId: { isNull: true } } : {}),
          ...(Object.keys(assignee).length > 0 ? { assignee } : {}),
          ...(input.open ? { closedAt: { isNull: true } } : {}),
          ...(input.labelId === undefined ? {} : { labels: { id: input.labelId } }),
          ...(clauses.length > 0 ? { AND: clauses } : {}),
        },
        with: issueWith,
        // A Project's list reads in key order and pages; the Workspace's reads
        // as a feed, and a cursor over numbers means nothing across Projects.
        // Two changes in one millisecond would otherwise land in scan order,
        // so the id breaks the tie the same way every time.
        orderBy: input.projectKey ? { number: "asc" } : { updatedAt: "desc", id: "desc" },
        // One past the page, so `hasMore` costs no second query.
        limit: input.limit + 1,
      });
      const rows = page.slice(0, input.limit);
      return {
        issues: rows.map((row) => withKey(row, keyOf.get(row.projectId) ?? "")),
        nextCursor: input.projectKey ? (rows.at(-1)?.number ?? null) : null,
        hasMore: page.length > input.limit,
      };
    },
  }),

  get: defineOperation({
    name: "issues.get",
    summary: "One Issue by its key, with its State, Assignee, parent and children",
    method: "GET",
    path: "/issues/{key}",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({ key: z.string() }),
    output: IssueDetailSchema,
    handler: async ({ input, context }) => {
      const { issue } = await requireIssue(context, input.key);
      return loadIssue(context, issue.id);
    },
  }),

  move: defineOperation({
    name: "issues.move",
    summary:
      "Put an Issue in another State of its Project's Workflow; a Gate is left by a ruling, never by a move",
    method: "POST",
    path: "/issues/{key}/move",
    auth: "member",
    agents: true,
    // A tool, because it is the one thing a Human working an Issue from their
    // own client does most (ADR-0016). `assertLeavable` keeps a Gate a ruling's.
    mcp: true,
    input: z.object({ key: z.string(), stateId: z.string() }),
    output: IssueDetailSchema,
    handler: async ({ input, context }) => {
      const { issue, project, states, from } = await requireIssueForMove(context, input.key);
      const to = states.find((state) => state.id === input.stateId);
      if (!to) {
        throw new ORPCError("BAD_REQUEST", {
          message: "That State belongs to another Project's Workflow",
        });
      }
      if (to.id === from.id) return loadIssue(context, issue.id);
      assertLeavable(from, input.key);

      await enterState(context.db, issue, to);
      await appendEvent(context, {
        kind: "issue.moved",
        subjectType: "issue",
        subjectId: issue.id,
        projectId: project.id,
        payload: { from: from.name, to: to.name },
      });
      await openStateDocument(context, issue.id, project.id, to);
      return loadIssue(context, issue.id);
    },
  }),

  setLabels: defineOperation({
    name: "issues.setLabels",
    summary: "Replace an Issue's Labels; one per scope survives, the last given",
    method: "PUT",
    path: "/issues/{key}/labels",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({ key: z.string(), labelIds: z.array(z.string()) }),
    output: IssueDetailSchema,
    handler: async ({ input, context }) => {
      const { issue, project } = await requireIssue(context, input.key);
      const chosen = await context.db.query.label.findMany({
        where: { id: { in: input.labelIds }, workspaceId: context.workspace.id },
      });
      if (chosen.length !== new Set(input.labelIds).size) {
        throw new ORPCError("BAD_REQUEST", {
          message: "One of those Labels is not defined in this Workspace",
        });
      }
      // Order matters for the one-per-scope rule, and findMany does not keep it.
      const ordered = input.labelIds
        .map((id) => chosen.find((label) => label.id === id))
        .filter((label) => label !== undefined);

      const change = await replaceIssueLabels(
        context.db,
        issue.id,
        oneLabelPerScope(ordered).map((label) => label.id),
      );
      if (change.added.length > 0 || change.removed.length > 0) {
        // Names beside the ids, so the log reads without a lookup (docs/plans/ui-redesign-2.md D).
        const removedLabels =
          change.removed.length > 0
            ? await context.db.query.label.findMany({ where: { id: { in: change.removed } } })
            : [];
        const text = (label: { scope: string | null; name: string }) =>
          label.scope ? `${label.scope}: ${label.name}` : label.name;
        await appendEvent(context, {
          kind: "issue.labels_changed",
          subjectType: "issue",
          subjectId: issue.id,
          projectId: project.id,
          payload: {
            ...change,
            addedNames: change.added.flatMap((id) => {
              const label = chosen.find((candidate) => candidate.id === id);
              return label ? [text(label)] : [];
            }),
            removedNames: removedLabels.map(text),
          },
        });
      }
      return loadIssue(context, issue.id);
    },
  }),

  update: defineOperation({
    name: "issues.update",
    summary: "Change an Issue's title, description, Assignee, or parent",
    method: "PATCH",
    path: "/issues/{key}",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({
      key: z.string(),
      title: z.string().trim().min(1).max(300).optional(),
      description: z.string().max(100_000).nullish(),
      assigneeMemberId: z.string().nullish(),
      /** Pass null to detach the Issue from its parent. */
      parentKey: z.string().nullish(),
    }),
    output: IssueDetailSchema,
    handler: async ({ input, context }) => {
      const { issue: found, project } = await requireIssue(context, input.key);

      // Assignment and reparenting each get their own Event, since the inbox
      // and the timeline read them differently from an edit (docs/plans/m1.md).
      let parentId: string | null | undefined;
      if (input.parentKey !== undefined) {
        /*
         * An Issue whose current parent this caller cannot see is not theirs to
         * move. The parent is hidden from them on a read, which is the rule for
         * an ungranted Project — but hiding it and allowing the move as well
         * would let an Agent lift an Issue out of a tree it was never shown.
         * The refusal admits a tree exists without naming it, and that is the
         * cheaper of the two costs (docs/plans/sub-issue-delegation.md).
         */
        if (found.parentId) {
          const current = await context.db.query.issue.findFirst({
            where: { id: found.parentId },
            columns: { projectId: true },
          });
          if (current && !projectVisible(context, current.projectId)) {
            throw new ORPCError("CONFLICT", {
              message: `${input.key} is already part of a tree you cannot see.`,
            });
          }
        }
        if (input.parentKey === null) {
          parentId = null;
        } else {
          const parent = await requireIssue(context, input.parentKey);
          if (await isSelfOrDescendant(context.db, found.id, parent.issue.id)) {
            throw new ORPCError("BAD_REQUEST", {
              message: "An Issue cannot be its own parent or a child of its own descendant",
            });
          }
          parentId = parent.issue.id;
        }
      }
      if (input.assigneeMemberId) await requireAssignee(context, input.assigneeMemberId);

      const edits: Record<string, { from: unknown; to: unknown }> = {};
      if (input.title !== undefined && input.title !== found.title) {
        edits.title = { from: found.title, to: input.title };
      }
      if (input.description !== undefined && input.description !== found.description) {
        edits.description = { from: found.description, to: input.description ?? null };
      }
      const assigneeChanged =
        input.assigneeMemberId !== undefined &&
        (input.assigneeMemberId ?? null) !== found.assigneeMemberId;
      const parentChanged = parentId !== undefined && parentId !== found.parentId;

      if (Object.keys(edits).length === 0 && !assigneeChanged && !parentChanged) {
        return loadIssue(context, found.id);
      }

      await context.db
        .update(issueTable)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined ? {} : { description: input.description ?? null }),
          ...(assigneeChanged ? { assigneeMemberId: input.assigneeMemberId ?? null } : {}),
          ...(parentChanged ? { parentId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(issueTable.id, found.id));

      const subject = {
        subjectType: "issue",
        subjectId: found.id,
        projectId: project.id,
      } as const;
      if (Object.keys(edits).length > 0) {
        // A description mentions people the same way a comment does, so the
        // inbox reads one payload shape for both.
        const mentionedMemberIds =
          input.description === undefined
            ? []
            : await resolveMentions(context.db, context.workspace.id, input.description ?? "");
        await appendEvent(context, {
          kind: "issue.updated",
          ...subject,
          payload: { ...edits, mentionedMemberIds },
        });
      }
      if (assigneeChanged) {
        // Names beside the ids, so the log reads without a lookup (docs/plans/ui-redesign-2.md D).
        const ids = [found.assigneeMemberId, input.assigneeMemberId ?? null].filter(
          (id): id is string => id !== null,
        );
        const people =
          ids.length > 0
            ? await context.db.query.member.findMany({
                where: { id: { in: ids } },
                with: { user: true },
              })
            : [];
        const nameOf = (id: string | null) =>
          id ? (people.find((person) => person.id === id)?.user.name ?? null) : null;
        await appendEvent(context, {
          kind: "issue.assigned",
          ...subject,
          payload: {
            from: found.assigneeMemberId,
            to: input.assigneeMemberId ?? null,
            fromName: nameOf(found.assigneeMemberId),
            toName: nameOf(input.assigneeMemberId ?? null),
          },
        });
      }
      if (parentChanged) {
        const ids = [found.parentId, parentId ?? null].filter((id): id is string => id !== null);
        const related =
          ids.length > 0
            ? await context.db.query.issue.findMany({
                where: { id: { in: ids } },
                with: { project: true },
              })
            : [];
        const keyOf = (id: string | null) => {
          const row = id ? related.find((candidate) => candidate.id === id) : undefined;
          return row ? issueKey(row.project.key, row.number) : null;
        };
        await appendEvent(context, {
          kind: "issue.reparented",
          ...subject,
          payload: {
            from: found.parentId,
            to: parentId ?? null,
            fromKey: keyOf(found.parentId),
            toKey: keyOf(parentId ?? null),
          },
        });
      }
      return loadIssue(context, found.id);
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
    columns: { id: true, key: true },
  });
}

/** One condition of an Issue query, in the relational query builder's own filter shape. */
type SearchClause = NonNullable<
  NonNullable<Parameters<Db["query"]["issue"]["findMany"]>[0]>["where"]
>;

/**
 * What `q` means: `DEV-12` is exactly that Issue, a bare number is that number
 * in any Project (or a title containing it), anything else is a word of the
 * title. A key whose Project does not exist here is a word of the title too
 * ("Read ADR-0015 before touching ids" is found by `ADR-0015`). SQLite's LIKE
 * is case-insensitive for ASCII, which is what a key or a title is.
 */
function searchClause(q: string, projects: Array<{ id: string; key: string }>): SearchClause {
  const asKey = /^([A-Za-z]{2,6})-(\d+)$/.exec(q);
  if (asKey) {
    const project = projects.find((candidate) => candidate.key === asKey[1]?.toUpperCase());
    if (project) return { projectId: project.id, number: Number(asKey[2]) };
  }
  const title = titleContains(q);
  if (/^\d+$/.test(q)) return { OR: [{ number: Number(q) }, title] };
  return title;
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
