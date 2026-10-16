import { eq } from "drizzle-orm";
import { z } from "zod";
import { allowlistRule as allowlistRuleTable } from "@deevy/db";
import { AllowlistRuleSchema } from "../schemas.ts";
import { ORPCError } from "@orpc/server";
import { appendEvent } from "../events.ts";
import { NoInput, defineOperation } from "./registry.ts";
import { AllowlistRuleInput, allowlistRuleSignIn } from "./shared.ts";
import { newId } from "../ids.ts";

export const allowlist = {
  list: defineOperation({
    name: "allowlist.list",
    summary: "The rules that admit a sign-in to this Workspace",
    method: "GET",
    path: "/allowlist",
    auth: "admin",
    input: NoInput,
    output: z.object({ rules: z.array(AllowlistRuleSchema) }),
    handler: async ({ context }) => {
      const rules = await context.db.query.allowlistRule.findMany({
        where: { workspaceId: context.workspace.id },
        orderBy: { createdAt: "asc" },
      });
      return { rules };
    },
  }),

  add: defineOperation({
    name: "allowlist.add",
    summary:
      "Admit every sign-in matching an email domain, a GitHub organization or a GitLab group",
    method: "POST",
    path: "/allowlist",
    auth: "admin",
    input: AllowlistRuleInput,
    output: AllowlistRuleSchema,
    handler: async ({ input, context }) => {
      // A rule decided by a provider's account is a rule that admits nobody
      // where nobody signs in with that provider, which an admin could not
      // tell from the saved chip. What this deployment offers is what
      // `health.ping` reports: configured, and registered (app.ts).
      const needs = allowlistRuleSignIn[input.kind];
      if (needs && !context.signInProviders?.some((offered) => offered.id === needs.id)) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: `Nobody can sign in here with ${needs.label}, so a ${needs.rule} rule would let nobody in. Add an email domain rule or invite people instead.`,
        });
      }
      const existing = await context.db.query.allowlistRule.findFirst({
        where: { workspaceId: context.workspace.id, kind: input.kind, value: input.value },
      });
      if (existing) throw new ORPCError("CONFLICT", { message: "That rule is already in place" });

      const [row] = await context.db
        .insert(allowlistRuleTable)
        .values({
          id: newId("allowlistRule"),
          workspaceId: context.workspace.id,
          kind: input.kind,
          value: input.value,
          createdBy: context.member.id,
        })
        .returning();
      if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
      await appendEvent(context, {
        kind: "allowlist.rule_added",
        subjectType: "allowlist_rule",
        subjectId: row.id,
        payload: { kind: row.kind, value: row.value },
      });
      return row;
    },
  }),

  remove: defineOperation({
    name: "allowlist.remove",
    summary: "Stop admitting sign-ins that only this rule matched",
    method: "DELETE",
    path: "/allowlist/{ruleId}",
    auth: "admin",
    input: z.object({ ruleId: z.string() }),
    output: z.object({ removed: z.literal(true) }),
    handler: async ({ input, context }) => {
      const found = await context.db.query.allowlistRule.findFirst({
        where: { id: input.ruleId, workspaceId: context.workspace.id },
      });
      if (!found) throw new ORPCError("NOT_FOUND", { message: "No such allowlist rule" });

      await context.db.delete(allowlistRuleTable).where(eq(allowlistRuleTable.id, found.id));
      await appendEvent(context, {
        kind: "allowlist.rule_removed",
        subjectType: "allowlist_rule",
        subjectId: found.id,
        payload: { kind: found.kind, value: found.value },
      });
      return { removed: true as const };
    },
  }),
};
