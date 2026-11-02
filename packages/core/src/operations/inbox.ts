import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { notification as notificationTable } from "@deevy/db";
import { MemberWithUserSchema, NotificationWithIssueSchema } from "../schemas.ts";
import { defineOperation } from "./registry.ts";
import { QueryFlag, issueWith } from "./shared.ts";

/**
 * An Agent's inbox (docs/plans/simplify.md, slice 8): what it was assigned,
 * who mentioned it, and how its Gate was ruled. A Human has none. What needs
 * them is the Gates they may rule on, which `gates.list { mine }` derives for
 * Needs me, and nothing writes them a row, so a Human calling these is told
 * they are an Agent's rather than handed an inbox that is always empty.
 */
export const inbox = {
  list: defineOperation({
    name: "inbox.list",
    summary: "The Notifications waiting for this Agent, newest first",
    method: "GET",
    path: "/inbox",
    auth: "member",
    agents: true,
    agentsOnly: true,
    mcp: true,
    input: z.object({
      unreadOnly: QueryFlag.optional(),
      /** Return Notifications older than this id's position. */
      before: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    output: z.object({
      notifications: z.array(
        NotificationWithIssueSchema.extend({
          /** Who did the thing the Notification is about; null when deevy itself did. */
          actor: MemberWithUserSchema.nullable(),
          /** The comment, when the Event is one; `body` is null once it has been withdrawn. */
          comment: z.object({ id: z.string(), body: z.string().nullable() }).nullable(),
        }),
      ),
      nextCursor: z.number().int().nullable(),
    }),
    handler: async ({ input, context }) => {
      // A Notification names an Issue and carries it back in full, so the
      // inbox is a way into a Project as much as issues.get is. An Agent sees
      // only what its grants cover (docs/plans/m2.md).
      // It also carries who did it and, for a mention, what they wrote, so a
      // row can read as a sentence without one query per row.
      const granted = context.grantedProjectIds;
      const rows = await context.db.query.notification.findMany({
        where: {
          recipientMemberId: context.member.id,
          ...(input.unreadOnly ? { readAt: { isNull: true } } : {}),
          ...(input.before === undefined ? {} : { eventId: { lt: input.before } }),
          ...(granted ? { issue: { projectId: { in: granted } } } : {}),
        },
        with: { event: true, issue: { with: issueWith } },
        orderBy: { eventId: "desc" },
        limit: input.limit,
      });
      const actorIds = [
        ...new Set(
          rows.flatMap((row) => (row.event.actorMemberId ? [row.event.actorMemberId] : [])),
        ),
      ];
      const actors =
        actorIds.length > 0
          ? await context.db.query.member.findMany({
              where: { id: { in: actorIds } },
              with: { user: true },
            })
          : [];
      const actorById = new Map(actors.map((actor) => [actor.id, actor]));
      return {
        notifications: rows.map((row) => {
          // What was written rides on the Event: deevy stores no comments, and
          // the body it appended is what the mention was about (ADR-0024).
          const payload = row.event.payload as {
            externalCommentId?: unknown;
            body?: unknown;
          } | null;
          return {
            ...row,
            issue: row.issue,
            actor: row.event.actorMemberId
              ? (actorById.get(row.event.actorMemberId) ?? null)
              : null,
            comment:
              typeof payload?.externalCommentId === "string"
                ? {
                    id: payload.externalCommentId,
                    body: typeof payload.body === "string" ? payload.body : null,
                  }
                : null,
          };
        }),
        nextCursor: rows.at(-1)?.eventId ?? null,
      };
    },
  }),

  markRead: defineOperation({
    name: "inbox.markRead",
    summary: "Mark some of this Agent's Notifications read",
    method: "POST",
    path: "/inbox/read",
    auth: "member",
    // An Agent told to find work through `inbox_list` with `unreadOnly` could
    // never clear a row, so the same Notification came back on every pass and
    // its unread count only grew (docs/plans/m4.md). No `mcp: true`: the
    // caller is the loop keeping its own books rather than the model, PLAN.md
    // promises twenty tools, and the same key reaches this over the HTTP API,
    // which is the same authorisation through the other surface (ADR-0011).
    agents: true,
    agentsOnly: true,
    input: z.object({ ids: z.array(z.string()) }),
    output: z.object({ read: z.number().int() }),
    handler: async ({ input, context }) => {
      if (input.ids.length === 0) return { read: 0 };
      // Scoped to the caller in the same statement, so one Member cannot mark
      // another's inbox read by guessing ids.
      const updated = await context.db
        .update(notificationTable)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notificationTable.recipientMemberId, context.member.id),
            inArray(notificationTable.id, input.ids),
            isNull(notificationTable.readAt),
          ),
        )
        .returning({ id: notificationTable.id });
      return { read: updated.length };
    },
  }),
};
