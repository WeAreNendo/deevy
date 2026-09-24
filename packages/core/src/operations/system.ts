import { z } from "zod";
import { MemberSchema, UserSchema, WorkspaceSchema } from "../schemas.ts";
import { NoInput, defineOperation } from "./registry.ts";

export const health = {
  ping: defineOperation({
    name: "health.ping",
    summary: "Liveness check",
    method: "GET",
    path: "/health/ping",
    auth: "public",
    input: NoInput,
    output: z.object({
      ok: z.literal(true),
      time: z.string(),
      /** True when this instance signs in through the development GitHub stub. */
      devSignIn: z.boolean(),
      /**
       * True when it also registered the Socket provider that is not a tool, so
       * a tool can be connected with no App and no tunnel (ADR-0024). Public
       * for the same reason as the rest of this: it says what this deployment
       * can do, not what anyone may do with it.
       */
      devSockets: z.boolean(),
      /**
       * The sign-in providers this deployment configured, in the order the
       * sign-in page renders them. Public on purpose: an instance that cannot
       * say what it offers cannot render its own sign-in page, and "this
       * deployment has GitHub configured" is not a secret worth a session
       * (docs/plans/sign-in.md).
       */
      providers: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          /** How the SPA starts the sign-in. */
          kind: z.enum(["social"]),
        }),
      ),
      /**
       * Whether Documents on this deployment are live (ADR-0021). A Worker
       * without a Durable Object binding says false and every editor stays what
       * it was, rather than a page opening a socket that answers 501 — the same
       * reason this endpoint says which providers exist.
       */
    }),
    handler: async ({ context }) => ({
      ok: true as const,
      time: new Date().toISOString(),
      devSignIn: context.devSignIn === true,
      devSockets: context.devSockets === true,
      providers: context.signInProviders ?? [],
    }),
  }),
};

export const me = {
  get: defineOperation({
    name: "me.get",
    summary: "The signed-in Human, their Member row, and the Workspace",
    method: "GET",
    path: "/me",
    auth: "session",
    // An Agent asking who it is: it names itself nowhere else, and the answer
    // is about the caller rather than the Workspace.
    agents: true,
    input: NoInput,
    output: z.object({
      user: UserSchema,
      member: MemberSchema.nullable(),
      workspace: WorkspaceSchema.nullable(),
      /**
       * How this caller arrived: deevy's own UI, an Agent's API key, or a
       * Human's MCP client over OAuth. The SPA says so, because "you are
       * signed in" and "something is acting as you" are different facts
       * (docs/plans/m2.md).
       */
      principal: z.enum(["anonymous", "cookie", "api_key", "oauth"]),
    }),
    handler: async ({ context }) => ({
      // Absent means a cookie session: the only caller that builds a context
      // without a principal is a test driving the router directly (registry.ts).
      principal: context.principal?.kind ?? "cookie",
      user: {
        id: context.session.user.id,
        name: context.session.user.name,
        email: context.session.user.email,
        image: context.session.user.image ?? null,
        kind: context.session.user.kind ?? "human",
      },
      member: context.member,
      workspace: context.workspace,
    }),
  }),
};
