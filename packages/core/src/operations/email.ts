import { delivery as deliveryTable, emailSender as emailSenderTable } from "@deevy/db";
import { ORPCError } from "@orpc/server";
import { and, count, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { appendEvent } from "../events.ts";
import { senderKinds, type EmailSetup } from "../email/port.ts";
import { resolveSender } from "../email/sender.ts";
import { availableSenders, saveSender, senderOptionsFor, setupInForce } from "../email/settings.ts";
import { maxEmailAttempts } from "../email/deliver.ts";
import { renderPlain } from "../email/render.ts";
import { emailsSince, limitWindowStart, mailsSomebody, nextEmailAt } from "../limits.ts";
import { sendNow } from "../email/team.ts";
import { requireSealingSecret } from "../secrets.ts";
import { NoInput, defineOperation, type ContextFor } from "./registry.ts";
import { linkOrigin } from "./shared.ts";

/**
 * Settings › Email (docs/plans/email-channel.md, slice 3): which sender this
 * Workspace sends through, set by an admin over the environment's.
 *
 * Admin only, and only from a signed-in session: a key that can send email as
 * this Workspace is not something a program holding a token sets, and an Agent
 * never administers (ADR-0004). No output carries a credential.
 */

const SenderKind = z.enum(senderKinds);

const StatusView = z.object({
  /** The sender in force, or null when there is none. */
  sender: SenderKind.nullable(),
  from: z.string().nullable(),
  /** Where it came from: Settings › Email, or the environment. */
  source: z.enum(["settings", "environment"]).nullable(),
  /** Whether it can send from here: built, on a runtime that can run it. */
  runnable: z.boolean(),
  /** Why it cannot, in words an admin can act on. */
  problem: z.string().nullable(),
  /** What Settings › Email may choose on this runtime. */
  available: z.array(SenderKind),
  /** What is not secret, so the form can show it; credentials never leave. */
  config: z.record(z.string(), z.string()),
  /**
   * How many emails this Workspace may send in a day, when this deployment
   * limits it, and where it stands: what went in the last 24 hours and, once
   * that is the limit, how many wait and when the next may go.
   */
  limit: z
    .object({
      perDay: z.number().int(),
      sent: z.number().int(),
      waiting: z.number().int(),
      nextAt: z.date().nullable(),
    })
    .nullable(),
});

/** The day's email limit and where the Workspace stands against it, or null without one. */
async function limitOf(context: ContextFor<"admin">) {
  const perDay = context.limits?.emailsPerDay;
  if (perDay === undefined) return null;
  const now = new Date();
  const workspaceId = context.workspace.id;
  const sent = await emailsSince(context.db, workspaceId, limitWindowStart(now));
  if (sent < perDay) return { perDay, sent, waiting: 0, nextAt: null };
  // Full: what is owed and not given up on is what waits for the window.
  const [owed] = await context.db
    .select({ n: count() })
    .from(deliveryTable)
    .where(
      and(
        isNull(deliveryTable.deliveredAt),
        eq(deliveryTable.workspaceId, workspaceId),
        mailsSomebody(),
        lt(deliveryTable.attempts, maxEmailAttempts),
      ),
    );
  return {
    perDay,
    sent,
    waiting: owed?.n ?? 0,
    nextAt: perDay < 1 ? null : await nextEmailAt(context.db, workspaceId, perDay, now),
  };
}

/** The sender in force and everything said about it. */
async function statusOf(context: ContextFor<"admin">) {
  const inForce = await setupInForce({
    db: context.db,
    workspaceId: context.workspace.id,
    ...(context.socketSecret ? { socketSecret: context.socketSecret } : {}),
    ...(context.email ? { email: context.email } : {}),
  });
  const resolved = inForce.setup
    ? resolveSender({
        ...(context.emailSenders ? { emailSenders: context.emailSenders } : {}),
        email: inForce.setup,
      })
    : null;
  const problem =
    inForce.problem ??
    (resolved && "reason" in resolved ? resolved.reason : null) ??
    (inForce.setup ? null : (context.emailProblem ?? "No email sender is configured."));
  return {
    sender: inForce.setup?.sender ?? null,
    from: inForce.setup?.from ?? null,
    source: inForce.source,
    runnable: problem === null,
    problem,
    available: availableSenders(context.emailSenders),
    config: inForce.setup?.config ?? {},
    limit: await limitOf(context),
  };
}

export const email = {
  status: defineOperation({
    name: "email.status",
    summary: "The email sender this Workspace sends through, and where it was set",
    method: "GET",
    path: "/email",
    auth: "admin",
    sessionOnly: true,
    input: NoInput,
    output: StatusView,
    handler: async ({ context }) => statusOf(context),
  }),

  configure: defineOperation({
    name: "email.configure",
    summary: "Set the email sender, over the environment's",
    method: "PUT",
    path: "/email",
    auth: "admin",
    sessionOnly: true,
    input: z.object({
      sender: SenderKind.exclude(["stub"]),
      /** `deevy <deevy@example.com>`: its domain is the one the sender must have verified. */
      from: z.string().trim().min(3).max(320),
      config: z.record(z.string(), z.string().max(500)),
      /**
       * The sender's secrets. Empty keeps what was saved for the same sender,
       * so changing the From does not mean pasting the key again.
       */
      credentials: z.record(z.string(), z.string().max(4000)),
    }),
    output: StatusView,
    handler: async ({ input, context }) => {
      const socketSecret = requireSealingSecret(context.socketSecret);
      const saved = await setupInForce({
        db: context.db,
        workspaceId: context.workspace.id,
        socketSecret,
      });
      const keep =
        Object.keys(input.credentials).length === 0 &&
        saved.source === "settings" &&
        saved.setup?.sender === input.sender;
      const setup: EmailSetup = {
        sender: input.sender,
        from: input.from,
        config: input.config,
        credentials: keep && saved.setup ? saved.setup.credentials : input.credentials,
      };
      // Built before it is saved: a sender that cannot be built, or cannot
      // run here, is refused with the reason rather than saved to fail later.
      const resolved = resolveSender({
        ...(context.emailSenders ? { emailSenders: context.emailSenders } : {}),
        email: setup,
      });
      if ("reason" in resolved) throw new ORPCError("BAD_REQUEST", { message: resolved.reason });
      await saveSender(context.db, {
        workspaceId: context.workspace.id,
        memberId: context.member.id,
        setup,
        socketSecret,
      });
      await appendEvent(context, {
        kind: "email.configured",
        subjectType: "workspace",
        subjectId: context.workspace.id,
        payload: { sender: setup.sender, from: setup.from },
      });
      return statusOf(context);
    },
  }),

  clear: defineOperation({
    name: "email.clear",
    summary: "Forget the email sender set here, so the environment's is used again",
    method: "DELETE",
    path: "/email",
    auth: "admin",
    sessionOnly: true,
    input: NoInput,
    output: StatusView,
    handler: async ({ context }) => {
      const removed = await context.db
        .delete(emailSenderTable)
        .where(eq(emailSenderTable.workspaceId, context.workspace.id))
        .returning({ sender: emailSenderTable.sender });
      if (removed.length > 0) {
        await appendEvent(context, {
          kind: "email.cleared",
          subjectType: "workspace",
          subjectId: context.workspace.id,
          payload: { sender: removed[0]?.sender ?? null },
        });
      }
      return statusOf(context);
    },
  }),

  test: defineOperation({
    name: "email.test",
    summary: "Send a test email to yourself through the sender in force",
    method: "POST",
    path: "/email/test",
    auth: "admin",
    sessionOnly: true,
    input: NoInput,
    output: z.object({
      delivered: z.boolean(),
      status: z.number().int(),
      error: z.string().nullable(),
      to: z.string(),
    }),
    handler: async ({ context }) => {
      const me = await context.db.query.user.findFirst({
        where: { id: context.member.userId },
        columns: { email: true, emailVerified: true },
      });
      if (!me?.emailVerified) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message:
            "deevy can't email you: the account you signed in with didn't confirm your address.",
        });
      }
      const options = await senderOptionsFor(context);
      const sent = await sendNow(
        options,
        me.email,
        renderPlain({
          workspaceName: context.workspace.name,
          subject: `A test from ${context.workspace.name} on deevy`,
          headline: "Email from deevy works",
          lines: [
            `This came through ${options.email?.sender ?? "the sender"}, as ${options.email?.from ?? "deevy"}. Gates and Runs waiting on people will arrive like this.`,
          ],
          action: linkOrigin(context) ? { label: "Open deevy", url: linkOrigin(context) } : null,
          footer: `You sent this from Settings › Email in ${context.workspace.name}.`,
        }),
      );
      return { ...sent, to: me.email };
    },
  }),
};
