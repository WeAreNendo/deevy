import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { agent as agentTable, member as memberTable, user as userTable } from "@deevy/db";
import { projectGrant as projectGrantTable } from "@deevy/db";
import {
  AgentSchema,
  createAgent,
  handleTaken,
  liftCascade,
  listAgents,
  loadAgent,
  setAgentWebhook,
} from "../agents.ts";
import { ApiKeySummarySchema, IssuedKeySchema, apiKeysOf } from "../keys.ts";
import { ProjectSchema } from "../schemas.ts";
import { ORPCError } from "@orpc/server";
import { appendEvent } from "../events.ts";
import { NoInput, defineOperation } from "./registry.ts";
import {
  HandleInput,
  findMember,
  grantedProjects,
  reloadAgent,
  requireSponsoredAgent,
  SubscriptionSecret,
  SubscriptionUrl,
} from "./shared.ts";

/**
 * What the key an Agent is created with is called, so a Sponsor reading the
 * list later knows which one deevy issued and which ones they did.
 */
const FIRST_KEY_NAME = "first key";

/**
 * A new Agent, and the key it was created with — the only time that key is
 * ever returned. Null when this instance cannot mint one at all.
 */
const CreatedAgentSchema = AgentSchema.extend({ key: IssuedKeySchema.nullable() });

export const agents = {
  list: defineOperation({
    name: "agents.list",
    summary: "Every Agent in this Workspace, with its Sponsor and its Project grants",
    method: "GET",
    path: "/agents",
    auth: "member",
    input: NoInput,
    output: z.object({ agents: z.array(AgentSchema) }),
    handler: async ({ context }) => ({
      agents: await listAgents(context.db, context.workspace.id),
    }),
  }),

  create: defineOperation({
    name: "agents.create",
    summary: "Sponsor a new Agent; the Human who creates it is accountable for it",
    method: "POST",
    path: "/agents",
    auth: "member",
    input: z.object({
      name: z.string().trim().min(1).max(80),
      /** Left out, the handle is slugged from the name and suffixed on collision. */
      handle: HandleInput.nullish(),
    }),
    output: CreatedAgentSchema,
    handler: async ({ input, context }) => {
      const memberId = await createAgent({
        db: context.db,
        workspace: context.workspace,
        sponsorMemberId: context.member.id,
        name: input.name,
        handle: input.handle ?? null,
      });
      const created = await loadAgent(context.db, memberId);
      if (!created) throw new ORPCError("INTERNAL_SERVER_ERROR");
      await appendEvent(context, {
        kind: "agent.created",
        subjectType: "member",
        subjectId: memberId,
        payload: { handle: created.handle, name: input.name },
      });
      // An Agent with no key cannot reach deevy at all, so it is born with one
      // rather than with a second errand for its Sponsor. Through the same
      // store and the same Event as `agents.keys.issue`, so the log reads the
      // same either way, and shown exactly once because deevy keeps a hash.
      // Null where nothing wired a key store up: an instance without auth
      // cannot mint one, and refusing to create the Agent would be worse.
      const key = context.apiKeys
        ? await apiKeysOf(context).issue({
            userId: created.userId,
            name: FIRST_KEY_NAME,
            expiresInDays: null,
          })
        : null;
      if (key) {
        await appendEvent(context, {
          kind: "agent.key_issued",
          subjectType: "member",
          subjectId: memberId,
          payload: { keyId: key.id, name: FIRST_KEY_NAME },
        });
      }
      return { ...created, key };
    },
  }),

  update: defineOperation({
    name: "agents.update",
    summary: "Change an Agent's name, handle, delivery URL, or schedule",
    method: "PATCH",
    path: "/agents/{memberId}",
    auth: "member",
    input: z.object({
      memberId: z.string(),
      name: z.string().trim().min(1).max(80).optional(),
      handle: HandleInput.optional(),
      /** Null clears it: the Agent polls its inbox over MCP instead (ADR-0003). */
      webhookUrl: SubscriptionUrl.nullish(),
      /**
       * The secret deevy signs its deliveries with. Required the first time a
       * URL is set, because deevy returns no secret by construction and one it
       * invented would sign with a value the receiver could never hold.
       */
      webhookSecret: SubscriptionSecret.optional(),
      /**
       * How often the schedule trigger wakes this Agent on the Issues assigned
       * to it (docs/plans/m2.md). Null is no schedule, which is the default: an
       * Agent that only reacts.
       */
      scheduleMinutes: z.number().int().min(1).max(10_080).nullish(),
    }),
    output: AgentSchema,
    handler: async ({ input, context }) => {
      const found = await requireSponsoredAgent(context, input.memberId);
      const changed: Record<string, unknown> = {};

      if (input.handle !== undefined && input.handle !== found.handle) {
        const taken = await handleTaken(context.db, input.handle);
        if (taken) throw new ORPCError("CONFLICT", { message: "That handle is already taken" });
        await context.db
          .update(memberTable)
          .set({ handle: input.handle })
          .where(eq(memberTable.id, found.id));
        changed.handle = input.handle;
      }
      if (input.name !== undefined) {
        await context.db
          .update(userTable)
          .set({ name: input.name })
          .where(eq(userTable.id, found.userId));
        changed.name = input.name;
      }
      if (input.webhookUrl !== undefined) {
        await setAgentWebhook(
          context.db,
          found.id,
          context.workspace.id,
          input.webhookUrl ?? null,
          input.webhookSecret,
        );
        // The URL is a destination, not a credential, so it is safe in the log;
        // the subscription's secret never is (slice 5).
        changed.webhookUrl = input.webhookUrl ?? null;
      }
      const onAgent: { scheduleMinutes?: number | null } = {};
      if (input.scheduleMinutes !== undefined) {
        onAgent.scheduleMinutes = input.scheduleMinutes ?? null;
        changed.scheduleMinutes = input.scheduleMinutes ?? null;
      }
      if (Object.keys(onAgent).length > 0) {
        await context.db.update(agentTable).set(onAgent).where(eq(agentTable.memberId, found.id));
      }

      await appendEvent(context, {
        kind: "agent.updated",
        subjectType: "member",
        subjectId: found.id,
        payload: { changed: Object.keys(changed).sort() },
      });
      return reloadAgent(context, found.id);
    },
  }),

  setSponsor: defineOperation({
    name: "agents.setSponsor",
    summary: "Hand accountability for an Agent to another Human",
    method: "POST",
    path: "/agents/{memberId}/sponsor",
    auth: "admin",
    input: z.object({ memberId: z.string(), sponsorMemberId: z.string() }),
    output: AgentSchema,
    handler: async ({ input, context }) => {
      const found = await requireSponsoredAgent(context, input.memberId);
      const sponsor = await findMember(context, input.sponsorMemberId);
      if (sponsor.kind !== "human") {
        throw new ORPCError("BAD_REQUEST", { message: "Only a Human can sponsor an Agent" });
      }
      if (sponsor.id === found.sponsorId) return reloadAgent(context, found.id);

      await context.db
        .update(memberTable)
        .set({ sponsorId: sponsor.id })
        .where(eq(memberTable.id, found.id));
      await appendEvent(context, {
        kind: "agent.sponsor_changed",
        subjectType: "member",
        subjectId: found.id,
        payload: { from: found.sponsorId, to: sponsor.id },
      });
      // An Agent stopped only because its Sponsor was works again as soon as an
      // active Human answers for it (docs/plans/m2.md).
      if (found.suspendedAt && !sponsor.suspendedAt && found.sponsorId) {
        await liftCascade(context, found.id, found.sponsorId);
      }
      return reloadAgent(context, found.id);
    },
  }),

  suspend: defineOperation({
    name: "agents.suspend",
    summary: "Stop an Agent without deleting its trail",
    method: "POST",
    path: "/agents/{memberId}/suspend",
    auth: "member",
    input: z.object({ memberId: z.string() }),
    output: AgentSchema,
    handler: async ({ input, context }) => {
      const found = await requireSponsoredAgent(context, input.memberId);
      if (found.suspendedAt) return reloadAgent(context, found.id);

      await context.db
        .update(memberTable)
        .set({ suspendedAt: new Date() })
        .where(eq(memberTable.id, found.id));
      await appendEvent(context, {
        kind: "member.suspended",
        subjectType: "member",
        subjectId: found.id,
      });
      return reloadAgent(context, found.id);
    },
  }),

  reinstate: defineOperation({
    name: "agents.reinstate",
    summary: "Let a suspended Agent work again",
    method: "POST",
    path: "/agents/{memberId}/reinstate",
    auth: "member",
    input: z.object({ memberId: z.string() }),
    output: AgentSchema,
    handler: async ({ input, context }) => {
      const found = await requireSponsoredAgent(context, input.memberId);
      if (!found.suspendedAt) return reloadAgent(context, found.id);

      await context.db
        .update(memberTable)
        .set({ suspendedAt: null })
        .where(eq(memberTable.id, found.id));
      await appendEvent(context, {
        kind: "member.reinstated",
        subjectType: "member",
        subjectId: found.id,
      });
      return reloadAgent(context, found.id);
    },
  }),

  keys: {
    list: defineOperation({
      name: "agents.keys.list",
      summary: "The API keys an Agent holds, without any plaintext",
      method: "GET",
      path: "/agents/{memberId}/keys",
      auth: "member",
      input: z.object({ memberId: z.string() }),
      output: z.object({ keys: z.array(ApiKeySummarySchema) }),
      handler: async ({ input, context }) => {
        const found = await requireSponsoredAgent(context, input.memberId);
        return { keys: await apiKeysOf(context).list({ userId: found.userId }) };
      },
    }),

    issue: defineOperation({
      name: "agents.keys.issue",
      summary: "Mint an API key for an Agent; the plaintext is shown exactly once",
      method: "POST",
      path: "/agents/{memberId}/keys",
      auth: "member",
      input: z.object({
        memberId: z.string(),
        name: z.string().trim().min(1).max(80),
        /** Null never expires, which is what an agent loop needs. */
        expiresInDays: z.number().int().min(1).max(3650).nullish(),
      }),
      output: IssuedKeySchema,
      handler: async ({ input, context }) => {
        const found = await requireSponsoredAgent(context, input.memberId);
        const issued = await apiKeysOf(context).issue({
          userId: found.userId,
          name: input.name,
          expiresInDays: input.expiresInDays ?? null,
        });
        await appendEvent(context, {
          kind: "agent.key_issued",
          subjectType: "member",
          subjectId: found.id,
          payload: { keyId: issued.id, name: input.name },
        });
        return issued;
      },
    }),

    revoke: defineOperation({
      name: "agents.keys.revoke",
      summary: "Retire one of an Agent's API keys",
      method: "DELETE",
      path: "/agents/{memberId}/keys/{keyId}",
      auth: "member",
      input: z.object({ memberId: z.string(), keyId: z.string() }),
      output: z.object({ revoked: z.literal(true) }),
      handler: async ({ input, context }) => {
        const found = await requireSponsoredAgent(context, input.memberId);
        const revoked = await apiKeysOf(context).revoke({
          userId: found.userId,
          keyId: input.keyId,
        });
        if (!revoked) throw new ORPCError("NOT_FOUND", { message: "No such API key" });
        await appendEvent(context, {
          kind: "agent.key_revoked",
          subjectType: "member",
          subjectId: found.id,
          payload: { keyId: input.keyId },
        });
        return { revoked: true as const };
      },
    }),
  },

  grants: {
    list: defineOperation({
      name: "agents.grants.list",
      summary: "The Projects an Agent may see",
      method: "GET",
      path: "/agents/{memberId}/grants",
      auth: "member",
      input: z.object({ memberId: z.string() }),
      output: z.object({ projects: z.array(ProjectSchema) }),
      handler: async ({ input, context }) => {
        const found = await requireSponsoredAgent(context, input.memberId);
        const row = await context.db.query.member.findFirst({
          where: { id: found.id },
          with: { grantedProjects: true },
        });
        return { projects: row?.grantedProjects ?? [] };
      },
    }),

    add: defineOperation({
      name: "agents.grants.add",
      summary: "Let an Agent see a Project",
      method: "POST",
      path: "/agents/{memberId}/grants",
      auth: "member",
      input: z.object({ memberId: z.string(), projectId: z.string() }),
      output: z.object({ projects: z.array(ProjectSchema) }),
      handler: async ({ input, context }) => {
        const found = await requireSponsoredAgent(context, input.memberId);
        const project = await context.db.query.project.findFirst({
          where: { id: input.projectId, workspaceId: context.workspace.id },
        });
        if (!project) throw new ORPCError("NOT_FOUND", { message: "No such Project" });

        const already = await context.db.query.projectGrant.findFirst({
          where: { memberId: found.id, projectId: project.id },
        });
        if (!already) {
          await context.db.insert(projectGrantTable).values({
            memberId: found.id,
            projectId: project.id,
            grantedBy: context.member.id,
          });
          await appendEvent(context, {
            kind: "agent.project_granted",
            subjectType: "member",
            subjectId: found.id,
            projectId: project.id,
            payload: { projectSlug: project.slug },
          });
        }
        return grantedProjects(context, found.id);
      },
    }),

    remove: defineOperation({
      name: "agents.grants.remove",
      summary: "Take a Project back from an Agent",
      method: "DELETE",
      path: "/agents/{memberId}/grants/{projectId}",
      auth: "member",
      input: z.object({ memberId: z.string(), projectId: z.string() }),
      output: z.object({ projects: z.array(ProjectSchema) }),
      handler: async ({ input, context }) => {
        const found = await requireSponsoredAgent(context, input.memberId);
        const [removed] = await context.db
          .delete(projectGrantTable)
          .where(
            and(
              eq(projectGrantTable.memberId, found.id),
              eq(projectGrantTable.projectId, input.projectId),
            ),
          )
          .returning();
        if (removed) {
          await appendEvent(context, {
            kind: "agent.project_revoked",
            subjectType: "member",
            subjectId: found.id,
            projectId: input.projectId,
          });
        }
        return grantedProjects(context, found.id);
      },
    }),
  },
};
