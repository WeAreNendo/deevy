import { z } from "zod";
import { writeVersion } from "../documents.ts";
import { decodeBasis, encodeBasis, liveMarkdown, replaceSection } from "../documents-live.ts";
import { mergeMarkdown } from "../merge.ts";
import { applyToRoom } from "../room-store.ts";
import { DocumentAtVersionSchema, DocumentSchema } from "../schemas.ts";
import { ORPCError } from "@orpc/server";
import { appendEvent } from "../events.ts";
import { defineOperation } from "./registry.ts";
import type { Document, Issue, Project } from "@deevy/db";
import type { ContextFor } from "./registry.ts";
import { requireDocument, requireIssue } from "./shared.ts";

/**
 * What this write should land as: what it changed, replayed onto what the
 * Document says now. Refuses rather than overwriting where the two collide —
 * the Agent re-reads and tries again, and the Human typing is never
 * interrupted (ADR-0021).
 */
async function mergedBody(
  context: ContextFor<"member">,
  document: Document,
  body: string,
  basis: string | null,
): Promise<string> {
  const { body: theirs, live } = await liveMarkdown(context.db, document, context.liveRooms);
  // Nothing to merge against: no basis, and nobody in the room. This is the
  // write `documents.write` has always been.
  if (!basis && !live) return body;

  const merged = mergeMarkdown({ base: basis ? decodeBasis(basis) : theirs, mine: body, theirs });
  if (merged.ok) return merged.text;
  throw new ORPCError("CONFLICT", {
    message: `${merged.clashed.join(" and ")} changed while you were writing. Read ${document.name} again and write it once more.`,
  });
}

/**
 * One way in for both writes: into the room when there is one, so everybody
 * looking at it sees the change arrive, and into a version either way.
 */
async function writeTo(
  context: ContextFor<"member">,
  {
    issue,
    project,
    document,
    body,
  }: { issue: Issue; project: Project; document: Document; body: string },
) {
  const applied = await applyToRoom(
    context.db,
    document,
    body,
    context.member.id,
    context.liveRooms,
  );
  const version = applied ?? (await writeVersion(context.db, document, body, context.member.id));
  await appendEvent(context, {
    kind: "document.updated",
    subjectType: "issue",
    subjectId: issue.id,
    projectId: project.id,
    payload: { name: document.name, version, authorMemberIds: [context.member.id] },
  });
  return {
    ...document,
    currentVersion: version,
    version,
    body,
    authorMemberId: context.member.id,
    writtenAt: new Date(),
    basis: encodeBasis(body),
  };
}

export const documents = {
  list: defineOperation({
    name: "documents.list",
    summary: "The Documents on an Issue",
    method: "GET",
    path: "/issues/{issueKey}/documents",
    auth: "member",
    agents: true,
    input: z.object({ issueKey: z.string() }),
    output: z.object({ documents: z.array(DocumentSchema) }),
    handler: async ({ input, context }) => {
      const { issue } = await requireIssue(context, input.issueKey);
      const rows = await context.db.query.document.findMany({
        where: { issueId: issue.id },
        orderBy: { createdAt: "asc" },
      });
      return { documents: rows };
    },
  }),

  /**
   * Every version of one Document, newest first, without their bodies: who
   * wrote each and when. The Issue page reads it twice over — to name everybody
   * who has had a hand in a Document rather than only whoever wrote the version
   * on screen, and to draw the history somebody opens from it.
   *
   * Bodies stay out of it on purpose: a Document edited thirty times is thirty
   * bodies nobody asked for, and reading one is `documents.get` with a version.
   */
  versions: defineOperation({
    name: "documents.versions",
    summary: "Every version of a Document: who wrote it and when, without the body",
    method: "GET",
    path: "/issues/{issueKey}/documents/{name}/versions",
    auth: "member",
    agents: true,
    input: z.object({ issueKey: z.string(), name: z.string() }),
    output: z.object({
      versions: z.array(
        z.object({
          version: z.number().int(),
          /** Who cut this version. */
          authorMemberId: z.string().nullable(),
          /**
           * Everybody whose keystrokes are in it. A version cut from a live
           * room regularly has more than one author (ADR-0021), and the byline
           * reads from this rather than guessing from the one above.
           */
          authorMemberIds: z.array(z.string()),
          writtenAt: z.date(),
          /**
           * The Gate rulings made while this version was the current one: what
           * a Human was looking at when they approved or rejected.
           */
          rulings: z.array(
            z.object({
              decision: z.enum(["approved", "rejected"]),
              stateId: z.string(),
              memberId: z.string().nullable(),
              at: z.date(),
            }),
          ),
        }),
      ),
    }),
    handler: async ({ input, context }) => {
      const { issue } = await requireIssue(context, input.issueKey);
      const found = await requireDocument(context, issue.id, input.name);
      const rows = await context.db.query.documentVersion.findMany({
        where: { documentId: found.id },
        orderBy: { version: "desc" },
        with: { authors: true },
      });
      const pinned = await context.db.query.gateDecisionDocument.findMany({
        where: { documentId: found.id },
        with: { decision: true },
      });
      return {
        versions: rows.map((row) => ({
          version: row.version,
          authorMemberId: row.authorMemberId,
          // A version written before rooms existed names its one author here
          // too, so a byline never has to ask which kind of version it is.
          authorMemberIds:
            row.authors.length > 0
              ? row.authors.map((one) => one.memberId)
              : row.authorMemberId
                ? [row.authorMemberId]
                : [],
          writtenAt: row.createdAt,
          rulings: pinned
            .filter((one) => one.version === row.version)
            .map((one) => ({
              decision: one.decision.decision,
              stateId: one.decision.stateId,
              memberId: one.decision.memberId,
              at: one.decision.createdAt,
            }))
            .sort((a, b) => a.at.getTime() - b.at.getTime()),
        })),
      };
    },
  }),

  get: defineOperation({
    name: "documents.get",
    summary: "One Document on an Issue, at its current version or an older one",
    method: "GET",
    path: "/issues/{issueKey}/documents/{name}",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({
      issueKey: z.string(),
      name: z.string(),
      /** Omitted, the current version. */
      version: z.coerce.number().int().min(1).optional(),
    }),
    output: DocumentAtVersionSchema,
    handler: async ({ input, context }) => {
      const { issue } = await requireIssue(context, input.issueKey);
      const found = await requireDocument(context, issue.id, input.name);
      const version = input.version ?? found.currentVersion;
      const row = await context.db.query.documentVersion.findFirst({
        where: { documentId: found.id, version },
      });
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: `No version ${version} of ${input.name}` });
      }

      // Asked for the Document, you get what it says now — which is the room's
      // text while somebody is typing in it. Asked for a version, you get that
      // version: reading history is reading history (ADR-0021).
      const asked = input.version !== undefined;
      const live = asked
        ? { body: row.body, live: false }
        : await liveMarkdown(context.db, found, context.liveRooms);
      return {
        ...found,
        version: row.version,
        body: live.body,
        authorMemberId: row.authorMemberId,
        writtenAt: row.createdAt,
        basis: asked ? null : encodeBasis(live.body),
      };
    },
  }),

  write: defineOperation({
    name: "documents.write",
    summary: "Write a new version of a Document; older ones stay readable",
    method: "POST",
    path: "/issues/{issueKey}/documents/{name}",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({
      issueKey: z.string(),
      name: z.string(),
      body: z.string().max(100_000),
      /**
       * The version this edit started from. Given, and a write that would land
       * on top of somebody else's is refused rather than quietly becoming the
       * current version: two people editing at once is the case deevy has, and
       * silently keeping the later one is the wrong answer to it. Omitted — an
       * Agent over MCP, a script — the write lands as it always did.
       */
      baseVersion: z.number().int().min(1).optional(),
      /**
       * What `documents.get` handed back with the text this edit started from.
       * Given, the server merges what this write *changed* onto what the
       * Document says now, rather than pasting a body composed minutes ago over
       * a paragraph somebody is in (ADR-0021).
       */
      basis: z.string().nullish(),
    }),
    output: DocumentAtVersionSchema,
    handler: async ({ input, context }) => {
      const { issue, project } = await requireIssue(context, input.issueKey);
      const found = await requireDocument(context, issue.id, input.name);
      if (input.baseVersion !== undefined && input.baseVersion !== found.currentVersion) {
        throw new ORPCError("CONFLICT", {
          message: `${input.name} is at version ${String(found.currentVersion)}; this edit started from ${String(input.baseVersion)}. Read the newer one and write again.`,
        });
      }

      const body = await mergedBody(context, found, input.body, input.basis ?? null);
      return writeTo(context, { issue, project, document: found, body });
    },
  }),

  writeSection: defineOperation({
    name: "documents.writeSection",
    summary: "Rewrite one section of a Document, leaving the rest of it alone",
    method: "POST",
    path: "/issues/{issueKey}/documents/{name}/sections/{section}",
    auth: "member",
    agents: true,
    mcp: true,
    input: z.object({
      issueKey: z.string(),
      name: z.string(),
      /** The heading, with or without its hashes: `Requirements`, `## Requirements`. */
      section: z.string().min(1).max(200),
      body: z.string().max(100_000),
    }),
    output: DocumentAtVersionSchema,
    /*
     * What an Agent usually means. It merges by construction — the rest of the
     * Document is not in the payload, so it cannot be pasted over — it costs a
     * fraction of the bytes, and it gives the log a line worth reading
     * (ADR-0021).
     */
    handler: async ({ input, context }) => {
      const { issue, project } = await requireIssue(context, input.issueKey);
      const found = await requireDocument(context, issue.id, input.name);
      const { body: current } = await liveMarkdown(context.db, found, context.liveRooms);
      const written = replaceSection(current, input.section, input.body);
      if (written === null) {
        throw new ORPCError("NOT_FOUND", {
          message: `${input.name} has no section called ${input.section}. Read it and write the whole body, or use one of its own headings.`,
        });
      }
      return writeTo(context, { issue, project, document: found, body: written });
    },
  }),
};
