import type { SocketModules } from "../sockets/port.ts";
import type { Db, Member, Workspace } from "@deevy/db";
import type { AnySchema, InferSchemaInput, InferSchemaOutput } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { defineMeta, ORPCError, os } from "@orpc/server";
import { z } from "zod";
import type { Session, SignInProvider } from "../auth.ts";
import type { JobQueue } from "../jobs.ts";
import type { LiveOptions } from "../live.ts";

/**
 * The operation registry (ADR-0009). Every API operation is described by this
 * shape and projected to HTTP, OpenAPI, the typed client, and (M2) MCP tools.
 * oRPC is the implementation behind it; nothing outside this file builds
 * procedures directly, so a forced exit costs adapters, not the domain.
 */

export type AuthRule = "public" | "session" | "member" | "admin";

/**
 * How the caller authenticated. An Agent's API key and a Human MCP client's
 * OAuth token arrive on the same header at the same endpoint, so the three are
 * told apart once, in resolvePrincipal, and carried from there (docs/plans/m2.md).
 */
export type Principal =
  | { kind: "anonymous" }
  | { kind: "cookie" }
  | { kind: "api_key"; keyId: string }
  | { kind: "oauth"; clientId: string; scopes: string[] };
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AppContext {
  db: Db;
  session: Session | null;
  member: Member | null;
  workspace: Workspace | null;
  /**
   * The Projects an Agent principal may see, resolved once per request. `null`
   * means every Project: a Human is not scoped in v1 (docs/plans/m2.md).
   */
  grantedProjectIds?: string[] | null;
  /** How the caller authenticated. Absent is treated as a cookie session. */
  principal?: Principal;
  /**
   * The public origin of this instance, so a handler can hand a Human a link
   * back into deevy. Absent leaves those links site-relative.
   */
  baseURL?: string;
  /**
   * Where a Human's browser finds this deevy, when that is not the origin the
   * API answers on: a split-origin deployment, or the dev loop, where the SPA
   * is a second port (`DEEVY_WEB_ORIGIN`). Absent means the two are the same
   * origin, which is what the image and the Worker do. `linkOrigin` in
   * `operations/shared.ts` is what reads it (docs/plans/sign-in.md).
   */
  webURL?: string;
  /**
   * How long an Event stream may run on this runtime, and how often it looks.
   * The entry decides: a Node process holds a connection for as long as the
   * browser does, a Worker cannot (docs/plans/m3.md).
   */
  live?: LiveOptions;
  /**
   * Where a write's tail nudges the deliveries it just owed, when this
   * deployment has a queue to nudge (jobs.ts). It rides on the context because
   * `appendEvent` takes the context as its `EventSource`, so an operation goes
   * on knowing nothing about it.
   */
  jobs?: JobQueue;
  /**
   * Whether sign-in goes through the development GitHub stub (app.ts). Only
   * `health.ping` reads it, so a signed-out SPA can offer the dev form.
   */
  devSignIn?: boolean;
  /**
   * The providers this deployment can speak (ADR-0024). Injected by the entry,
   * so the core holds the port and never a provider.
   */
  sockets?: SocketModules;
  /**
   * What this deployment seals a Socket's credentials with (secrets.ts).
   * Absent, an operation that would store one refuses rather than keeping a
   * credential in plaintext.
   */
  socketSecret?: string;
  /**
   * This instance's own secret (`BETTER_AUTH_SECRET`). Nothing is sealed with
   * it; what it signs is short-lived and public-facing — the `state` a
   * provider echoes back on a redirect, and the MCP elicitation's
   * `requestState` — so rotating it ends those in flight and nothing else.
   */
  secret?: string;
  /**
   * The sign-in providers this deployment configured, in the order the sign-in
   * page renders them. Only `health.ping` reads it, so a signed-out SPA knows
   * which buttons to draw; absent means this instance offers none
   * (docs/plans/sign-in.md).
   */
  signInProviders?: SignInProvider[];
}

export type ContextFor<TAuth extends AuthRule> = TAuth extends "member" | "admin"
  ? AppContext & { session: Session; member: Member; workspace: Workspace }
  : TAuth extends "session"
    ? AppContext & { session: Session }
    : AppContext;

export interface OperationMeta {
  /** Dotted, stable identifier: also the OpenAPI operationId and the MCP tool name. */
  name: string;
  summary: string;
  method: HttpMethod;
  path: `/${string}`;
  auth: AuthRule;
  /**
   * An Agent Member may call this operation, scoped to its granted Projects
   * (ADR-0004). Default-deny: omitted means Humans only, so an operation added
   * later is refused to Agents until someone decides otherwise. Only sayable on
   * a `member` operation, which is how ADR-0004's "never administer" becomes a
   * compile error rather than a test.
   */
  agents?: true;
  /**
   * Only an Agent Member may call this: the operation is one side of a Run,
   * which is one Agent's attempt on an Issue, so a Human is refused with the
   * same middleware that refuses an Agent an unmarked operation (ADR-0016).
   * Sayable only beside `agents: true` on a `member` operation. The MCP
   * `tools/list` filter reads it, so a Human's own client is never offered a
   * tool it cannot call.
   */
  agentsOnly?: true;
  /**
   * Only a cookie session may call this: a Human present in deevy's own UI. A
   * delegated credential, an Agent's API key or a Human MCP client's OAuth
   * token, is refused. assertHuman checks the Member's kind, which would let a
   * Human's own MCP client approve on their behalf; this checks how they
   * arrived (docs/plans/m2.md).
   */
  sessionOnly?: true;
  /**
   * The handler returns an async generator rather than a value: the Event
   * stream, and anything that joins it. Set by `defineStreamOperation` rather
   * than by hand, because it describes the handler's shape and not a choice.
   * A surface that awaits one of these as if it were a value waits forever, so
   * every projection needs to be able to tell them apart without inspecting
   * the output schema — which is an oRPC event iterator here and a zod schema
   * everywhere else.
   */
  stream?: true;
  /**
   * This operation is projected as an MCP tool. Independent of `agents`:
   * authorization is who may call it, this is which surface carries it. The
   * list stays curated because a seventy-tool list costs an agent its context
   * window, and it is snapshotted in CI (ADR-0009, docs/plans/m2.md).
   */
  mcp?: true;
}

/**
 * `agents` is sayable on the rungs an Agent could reach, and never on `admin`:
 * ADR-0004's "never administer" is a compile error rather than a test.
 * `agentsOnly` is sayable only beside `agents: true` on a `member` operation,
 * so an operation cannot be an Agent's alone without first being an Agent's.
 */
export type AgentAccess<TAuth extends AuthRule> = TAuth extends "member"
  ? { agents?: true; agentsOnly?: never } | { agents: true; agentsOnly?: true }
  : TAuth extends "session"
    ? { agents?: true; agentsOnly?: never }
    : { agents?: never; agentsOnly?: never };

/**
 * A streaming operation: the same shape, but its handler returns an async
 * iterator and its output is an oRPC event iterator. The SSE stream is the
 * third surface of ADR-0005, so it stays inside the registry like the rest
 * (ADR-0009).
 */
export type StreamOperationDef<TAuth extends AuthRule, TInput extends AnySchema> = OperationMeta &
  AgentAccess<TAuth> & {
    auth: TAuth;
    input: TInput;
    output: AnySchema;
    handler: (args: {
      input: InferSchemaOutput<TInput>;
      context: ContextFor<TAuth>;
      signal?: AbortSignal;
    }) => AsyncGenerator<unknown, void, unknown>;
  };

export type OperationDef<
  TAuth extends AuthRule,
  TInput extends AnySchema,
  TOutput extends AnySchema,
> = OperationMeta &
  AgentAccess<TAuth> & {
    auth: TAuth;
    input: TInput;
    output: TOutput;
    handler: (args: {
      input: InferSchemaOutput<TInput>;
      context: ContextFor<TAuth>;
    }) => Promise<InferSchemaInput<TOutput>>;
  };

/** Input for operations that take nothing: the RPC link sends undefined, the OpenAPI handler an empty object (GET inputs must be objects). */
export const NoInput = z.object({}).optional();

export const [operationMeta, getOperationMeta] = defineMeta(
  "deevy",
  (incoming: OperationMeta) => incoming,
);

export const base = os.$context<AppContext>();

function authorize(meta: OperationMeta) {
  const rule = meta.auth;
  return base.middleware(async ({ context, next }) => {
    if (rule === "public") return next();
    if (!context.session) throw new ORPCError("UNAUTHORIZED");
    // These two are about who is asking, not how much authority the operation
    // wants, so they are checked for every rule above `public`. Returning at
    // the `session` rung first would make it a side door: an Agent's key would
    // reach an operation nobody marked for it, and `sessionOnly` would be
    // quietly ignored on the rung where a Human's own MCP client shows up.
    if (context.member?.kind === "agent" && !meta.agents) {
      throw new ORPCError("FORBIDDEN", { message: "An Agent cannot do that" });
    }
    if (meta.sessionOnly && context.principal && context.principal.kind !== "cookie") {
      throw new ORPCError("FORBIDDEN", {
        message: "Only a Human signed in to deevy can do that",
      });
    }
    if (rule === "session") return next();
    // A suspended Member keeps their row so the SPA can say why, but is no
    // Member as far as the Workspace is concerned (docs/plans/m1.md).
    if (!context.member || !context.workspace || context.member.suspendedAt) {
      throw new ORPCError("FORBIDDEN", { message: "Not a Member of this Workspace" });
    }
    // The mirror of the agent rule above: a Run is an Agent's, so its writing
    // side is refused to a Human here rather than in each handler (ADR-0016).
    if (meta.agentsOnly && context.member.kind !== "agent") {
      throw new ORPCError("FORBIDDEN", { message: "Only an Agent can do that" });
    }
    if (rule === "admin" && context.member.role !== "admin") {
      throw new ORPCError("FORBIDDEN", { message: "Only an admin of this Workspace can do that" });
    }
    return next();
  });
}

export function defineOperation<
  TAuth extends AuthRule,
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
>(def: OperationDef<TAuth, TInput, TOutput>) {
  const meta: OperationMeta = {
    name: def.name,
    summary: def.summary,
    method: def.method,
    path: def.path,
    auth: def.auth,
    ...(def.agents ? { agents: def.agents } : {}),
    ...(def.agentsOnly ? { agentsOnly: def.agentsOnly } : {}),
    ...(def.sessionOnly ? { sessionOnly: def.sessionOnly } : {}),
    ...(def.mcp ? { mcp: def.mcp } : {}),
  };
  return base
    .use(authorize(meta))
    .meta(operationMeta(meta))
    .meta(
      openapi({ method: def.method, path: def.path, operationId: def.name, summary: def.summary }),
    )
    .input(def.input)
    .output(def.output)
    .handler(({ input, context }) => def.handler({ input, context: context as ContextFor<TAuth> }));
}

/**
 * The streaming counterpart of defineOperation. Everything but the handler's
 * shape is the same, so an event stream carries the same auth rule, meta and
 * OpenAPI entry as any other operation.
 */
export function defineStreamOperation<TAuth extends AuthRule, TInput extends z.ZodType>(
  def: StreamOperationDef<TAuth, TInput>,
) {
  const meta: OperationMeta = {
    name: def.name,
    summary: def.summary,
    method: def.method,
    path: def.path,
    auth: def.auth,
    ...(def.agents ? { agents: def.agents } : {}),
    ...(def.agentsOnly ? { agentsOnly: def.agentsOnly } : {}),
    ...(def.sessionOnly ? { sessionOnly: def.sessionOnly } : {}),
    ...(def.mcp ? { mcp: def.mcp } : {}),
    stream: true,
  };
  return base
    .use(authorize(meta))
    .meta(operationMeta(meta))
    .meta(
      openapi({ method: def.method, path: def.path, operationId: def.name, summary: def.summary }),
    )
    .input(def.input)
    .output(def.output)
    .handler(({ input, context, signal }) =>
      def.handler({ input, context: context as ContextFor<TAuth>, signal }),
    );
}
