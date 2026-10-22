import { and, asc, desc, eq, gt, like, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { event as eventTable } from "@deevy/db";
import { EventSchema, MemberWithUserSchema } from "../schemas.ts";
import { eventIterator } from "@orpc/server";
import { subscribeToEvents } from "../live.ts";
import { defineOperation, defineStreamOperation } from "./registry.ts";

export const events = {
  list: defineOperation({
    name: "events.list",
    summary: "Events in this Workspace from a cursor, oldest first unless asked otherwise",
    method: "GET",
    path: "/events",
    auth: "member",
    input: z.object({
      /** Return Events after this seq. Pass back the previous page's nextCursor. */
      after: z.coerce.number().int().nonnegative().optional(),
      /**
       * Return Events before this seq: the page an Event log read newest-first
       * turns to next (docs/plans/ui-redesign.md slice 10).
       */
      before: z.coerce.number().int().positive().optional(),
      /**
       * Oldest first is the stream's order; newest first is a log's. Left
       * out, it is `asc`, except with `before` alone, where it is `desc`: a
       * page before a seq is a page turned back, and its cursor must keep
       * going back.
       */
      order: z.enum(["asc", "desc"]).optional(),
      /** Only Events whose kind starts with this family, e.g. `gate` or `run`. */
      kindPrefix: z
        .string()
        .regex(/^[a-z_]+$/, "A kind family is lowercase letters and underscores")
        .min(1)
        .max(40)
        .optional(),
      subjectType: z.string().optional(),
      subjectId: z.string().optional(),
      projectId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }),
    output: z.object({
      events: z.array(
        EventSchema.extend({
          /** Who did it; null when deevy itself did (a bootstrap, a sweep). */
          actor: MemberWithUserSchema.nullable(),
        }),
      ),
      /** The seq of the last Event returned, or null when the page is empty. */
      nextCursor: z.number().int().nullable(),
    }),
    handler: async ({ input, context }) => {
      const order = input.order ?? (input.before === undefined ? "asc" : "desc");
      const rows = await context.db
        .select()
        .from(eventTable)
        .where(
          and(
            eq(eventTable.workspaceId, context.workspace.id),
            input.after === undefined ? undefined : gt(eventTable.seq, input.after),
            input.before === undefined ? undefined : lt(eventTable.seq, input.before),
            // Kinds are dotted lowercase (events.ts), so the prefix needs no
            // escaping: the schema refuses anything LIKE could misread.
            input.kindPrefix === undefined
              ? undefined
              : like(eventTable.kind, `${input.kindPrefix}.%`),
            input.subjectType === undefined
              ? undefined
              : eq(eventTable.subjectType, input.subjectType),
            input.subjectId === undefined ? undefined : eq(eventTable.subjectId, input.subjectId),
            input.projectId === undefined ? undefined : eq(eventTable.projectId, input.projectId),
            // An invitation names an address and a role, and who was invited
            // is an admin's to read: `invitations.list` is admin-only, and the
            // Event log is every Member's, so these rows would have been the
            // way around it (docs/plans/sign-in.md).
            context.member.role === "admin" ? undefined : ne(eventTable.subjectType, "invitation"),
          ),
        )
        .orderBy(order === "desc" ? desc(eventTable.seq) : asc(eventTable.seq))
        .limit(input.limit);
      // The actors of the page in one query, the way inbox.list does it, so a
      // screen reads who did what without a Members lookup of its own.
      const actorIds = [
        ...new Set(rows.flatMap((row) => (row.actorMemberId ? [row.actorMemberId] : []))),
      ];
      const actors =
        actorIds.length > 0
          ? await context.db.query.member.findMany({
              where: { id: { in: actorIds } },
              with: { user: true },
            })
          : [];
      const actorById = new Map(actors.map((actor) => [actor.id, actor]));
      // The cursor is the last row's seq either way: `after` it going forward,
      // `before` it going back.
      return {
        events: rows.map((row) => ({
          ...row,
          actor: row.actorMemberId ? (actorById.get(row.actorMemberId) ?? null) : null,
        })),
        nextCursor: rows.at(-1)?.seq ?? null,
      };
    },
  }),

  subscribe: defineStreamOperation({
    name: "events.subscribe",
    summary: "The Event log as it happens, from a cursor, with heartbeats",
    method: "GET",
    path: "/events/subscribe",
    auth: "member",
    input: z.object({
      /** Resume from here. Omitted, the stream starts with what happens next. */
      after: z.coerce.number().int().nonnegative().optional(),
      projectId: z.string().optional(),
    }),
    output: eventIterator(
      z.union([
        z.object({ type: z.literal("event"), event: EventSchema }),
        z.object({ type: z.literal("heartbeat"), cursor: z.number().int().nullable() }),
      ]),
    ),
    handler: ({ input, context, signal }) =>
      subscribeToEvents({
        db: context.db,
        workspaceId: context.workspace.id,
        projectId: input.projectId,
        // The rule `events.list` keeps, for the same reason: this is the same
        // log, and `after: 0` would otherwise replay every invitation.
        hideInvitations: context.member.role !== "admin",
        after: input.after,
        signal,
        // Whatever this runtime allows a stream. Absent on Node, where the
        // stream lives as long as the request does (docs/plans/m3.md).
        ...context.live,
      }),
  }),
};
