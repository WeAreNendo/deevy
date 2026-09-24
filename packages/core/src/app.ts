import { projectGrant, type Db } from "@deevy/db";
import type { SocketModules } from "./sockets/port.ts";
import { handleInbound, handleSetup } from "./sockets/hooks.ts";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferenceHandlerPlugin } from "@orpc/openapi/plugins";
import { COMMON_ERROR_STATUS_MAP, DEFAULT_ERROR_STATUS, ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { CORSHandlerPlugin } from "@orpc/server/plugins";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Auth, SignInProvider } from "./auth.ts";
import { discardingJobQueue, type JobQueue } from "./jobs.ts";
import type { LiveOptions } from "./live.ts";
import { createDeevyMcp } from "./mcp/server.ts";
import { generateSpec } from "./openapi.ts";
import { betterAuthKeys } from "./keys.ts";
import type { ResourcePath } from "./auth.ts";
import { API_PATH } from "./auth.ts";
import { resolvePrincipal } from "./principal.ts";
import { router } from "./operations/index.ts";
import type { AppContext } from "./operations/registry.ts";

export interface AppOptions {
  db: Db;
  /** Omitted only by the Workers smoke build in M0. */
  auth?: Auth;
  /** Browser origins allowed to call the API with credentials. */
  origin?: string[];
  /** The public origin of this instance, for the MCP surface's RFC 9728 challenge. */
  baseURL?: string;
  /**
   * What this deevy is, as a version string. It reaches the OpenAPI document a
   * client discovers the instance through, so a CLI built from a newer tree can
   * say which two versions disagree rather than only that they do.
   */
  version?: string;
  /**
   * The instance secret. The MCP surface signs the `requestState` of a Gate
   * elicitation with it (mcp/elicitation.ts).
   */
  secret?: string;
  /**
   * What this runtime allows an Event stream: how often it polls, and how long
   * it may live. Omitted, a stream runs until the request is aborted, which is
   * what a Node process wants; a Worker passes both, because each poll is one
   * D1 query against a per-invocation cap (docs/plans/m3.md slice 7).
   */
  live?: LiveOptions;
  /**
   * Where a write's tail nudges the deliveries it just owed (jobs.ts). The
   * default discards, because a queue is a latency optimisation and never a
   * correctness requirement: without one, the next sweep finds the same rows a
   * beat later, which is what `apps/server` and a Worker on an account with no
   * Queues both do (docs/plans/m3.md slice 9).
   */
  jobs?: JobQueue;
  /**
   * Called with errors an operation threw that nobody expected. A refusal the
   * handler chose — a `NOT_FOUND`, a `FORBIDDEN` — is not one of those and
   * never reaches here (`isDefinedRefusal`).
   */
  onError?: (error: unknown) => void;
  /**
   * Whether this instance signs Humans in through the OAuth stub, so the SPA
   * may offer "sign in as <email>" (apps/server reads it from
   * `DEEVY_DEV_STUB_OAUTH`). Reported on `health.ping`; the Worker never sets it.
   */
  devSignIn?: boolean;
  /**
   * The providers this deployment can speak, built by the entry from
   * `@deevy/sockets` (ADR-0024). The core holds the port and never a provider,
   * so a build without one refuses the Socket rather than failing to compile.
   */
  sockets?: SocketModules;
  /**
   * What this deployment seals a Socket's credentials with (`DEEVY_SECRET`,
   * secrets.ts). Deliberately not Better Auth's secret: rotating that one
   * invalidates sessions, which an operator may reasonably do, and it must not
   * also mean every connected tool has to be connected again. Without it a
   * Socket that holds a credential cannot be connected or used.
   */
  socketSecret?: string;
  /**
   * Which providers this deployment offers a Human to sign in with, from
   * `signInProviders(env)` in the entry that built the identity configuration.
   * Reported on `health.ping`, so the sign-in page renders what the server
   * registered rather than a constant of its own (docs/plans/sign-in.md).
   */
  signInProviders?: SignInProvider[];
  /**
   * Where a Human's browser finds this deevy, when the SPA is not served from
   * the origin the API answers on (`DEEVY_WEB_ORIGIN`). A Gate link and an
   * invitation link are built on it; everything bound to this instance's own
   * identity — the OAuth issuer, the MCP resource — stays on `baseURL`
   * (docs/plans/sign-in.md).
   */
  webURL?: string;
}

/**
 * Whether this is a refusal a handler chose rather than a failure nobody
 * expected.
 *
 * The line is the status rather than the class: a handler throwing `NOT_FOUND`
 * or `FORBIDDEN` has answered the request correctly, which is the operation
 * working. A 5xx is the opposite, and an `INTERNAL_SERVER_ERROR` deevy raised
 * on purpose still deserves a log — so what decides is what the caller ends up
 * being told, not what was thrown.
 */
export function isDefinedRefusal(error: unknown): boolean {
  if (!(error instanceof ORPCError)) return false;
  // The status is filled in by the handler on its way out, so an error caught
  // on the way there has only its code. oRPC's own map is what turns one into
  // the other, and using it means a code this file has never heard of is
  // classified exactly as the response to it will be.
  const known: Record<string, number | undefined> = COMMON_ERROR_STATUS_MAP;
  const status = known[error.code] ?? DEFAULT_ERROR_STATUS;
  return status >= 400 && status < 500;
}

/**
 * The Hono app shared by the Node server and the Cloudflare Worker (ADR-0005,
 * ADR-0006): Better Auth under /api/auth, the RPC surface under /rpc, the
 * OpenAPI surface with its reference UI under /api.
 */
export function createApp({
  db,
  auth,
  origin = [],
  baseURL,
  version,
  secret,
  live,
  jobs = discardingJobQueue(),
  onError: report = console.error,
  devSignIn = false,
  sockets,
  socketSecret,
  signInProviders = [],
  webURL,
}: AppOptions) {
  // A client asking for a Run that does not exist is a 404, not something for
  // an operator to read. Reporting every refusal buried the ones that matter in
  // stack traces, and dumped the whole oRPC context — the database handle and
  // the caller's session included — into the log beside them.
  const reportUnexpected = (error: unknown) => {
    if (isDefinedRefusal(error)) return;
    report(error);
  };
  const app = new Hono<{ Variables: { ctx: AppContext } }>();

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Before everything else, and outside every middleware that builds a
  // session: the caller here is a tool with a signature over the raw body, and
  // a framework that read the body first would have changed what it signed
  // (ADR-0024). `/hooks/*` is in the Worker's `run_worker_first` list, which
  // `worker-routes.test.ts` holds.
  app.post("/hooks/:socketId", (c) =>
    handleInbound(c.req.raw, {
      db,
      socketId: c.req.param("socketId"),
      ...(sockets ? { sockets } : {}),
      ...(socketSecret ? { socketSecret } : {}),
      jobs,
    }),
  );
  // Where a provider's own flow sends an operator back: GitHub's App manifest
  // conversion and its installation callback are both redirects, so this is a
  // GET as often as it is a POST (ADR-0024).
  app.all("/hooks/:socketId/setup", (c) =>
    handleSetup(c.req.raw, {
      db,
      socketId: c.req.param("socketId"),
      ...(sockets ? { sockets } : {}),
      ...(socketSecret ? { socketSecret } : {}),
      ...(secret ? { secret } : {}),
      ...(baseURL ? { baseURL } : {}),
      ...(webURL ? { webURL } : {}),
      jobs,
    }),
  );

  if (auth) {
    app.use("/api/auth/*", cors({ origin, credentials: true }));
    app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

    // OAuth discovery lives at the origin, not under Better Auth's base path:
    // RFC 8414 and RFC 9728 both insert the well-known segment right after the
    // host, and a client that derives the URL rather than reading the 401's
    // header looks nowhere else. The plugins answer these from `onRequest`,
    // which runs on the raw request before any base-path routing, so handing
    // them the request unchanged is all it takes (docs/plans/m2.md).
    app.all("/.well-known/oauth-authorization-server", wellKnown(auth));
    app.all("/.well-known/oauth-authorization-server/*", wellKnown(auth));
    app.all("/.well-known/openid-configuration", wellKnown(auth));
    app.all("/.well-known/oauth-protected-resource", wellKnown(auth));
    app.all("/.well-known/oauth-protected-resource/*", wellKnown(auth));
  }

  // Before the oRPC handlers: the MCP surface builds its own context, because
  // an unauthenticated call there is a 401 challenge rather than an error body.
  const mcp = createDeevyMcp({
    db,
    auth,
    baseURL,
    // An Agent asking for a ruling over MCP is handed a link for a Human to
    // open, so the tool surface builds one the same way the API does.
    ...(webURL ? { webURL } : {}),
    secret,
    jobs,
    // The same registry the operation surfaces get: a tool that opens a record
    // in a tracker is refused without it (ADR-0024).
    ...(sockets ? { sockets } : {}),
    ...(socketSecret ? { socketSecret } : {}),
    onError: reportUnexpected,
  });
  app.all("/mcp", (c) => mcp.fetch(c.req.raw));

  // The origin a handler builds a link back into deevy from: what this
  // instance was configured with, or, in development, whatever it was reached
  // on. Wrong only behind a proxy that rewrites the host and sets no baseURL.
  const originOf = (url: string) => baseURL ?? new URL(url).origin;
  // The stream settings ride on the context beside the caller's identity: the
  // handler is the same on both runtimes and the entry supplies the numbers,
  // so there is no `if (workers)` anywhere in here (docs/plans/m3.md).
  // A configured provider is not always a registered one. `genericOAuth`
  // fetches its discovery document while the app is being built and skips the
  // entry when the IdP cannot be reached, logging rather than throwing — so an
  // IdP that was down at startup left a button on the sign-in page that
  // answered PROVIDER_NOT_FOUND until the process was restarted. What
  // `health.ping` offers is therefore what Better Auth actually registered.
  // Asked once per app: `$context` settles at startup, and an instance that
  // cannot be asked reports what it was configured with (docs/plans/sign-in.md).
  let registeredIds: Promise<Set<string> | null> | undefined;
  const offeredProviders = async (): Promise<SignInProvider[]> => {
    if (!auth || signInProviders.length === 0) return signInProviders;
    registeredIds ??= auth.$context
      .then((context) => new Set(context.socialProviders.map((provider) => provider.id)))
      .catch(() => null);
    const ids = await registeredIds;
    return ids ? signInProviders.filter((provider) => ids.has(provider.id)) : signInProviders;
  };
  const contextFor = async (request: Request) => ({
    ...(await buildContext(db, auth, request.headers, originOf(request.url), API_PATH)),
    ...(live ? { live } : {}),
    ...(webURL ? { webURL } : {}),
    jobs,
    devSignIn,
    ...(sockets ? { sockets } : {}),
    ...(socketSecret ? { socketSecret } : {}),
    ...(secret ? { secret } : {}),
    signInProviders: await offeredProviders(),
  });
  app.use("/rpc/*", async (c, next) => {
    c.set("ctx", await contextFor(c.req.raw));
    await next();
  });
  app.use("/api/*", async (c, next) => {
    c.set("ctx", await contextFor(c.req.raw));
    await next();
  });

  const corsPlugin = new CORSHandlerPlugin<AppContext>({ origin, credentials: true });
  const rpc = new RPCHandler(router, {
    plugins: [corsPlugin],
    interceptors: [onError(reportUnexpected)],
  });
  const api = new OpenAPIHandler(router, {
    plugins: [
      corsPlugin,
      new OpenAPIReferenceHandlerPlugin({
        docsPath: "/docs",
        specPath: "/spec.json",
        spec: () => generateSpec(version),
      }),
    ],
    interceptors: [onError(reportUnexpected)],
  });

  app.use("/rpc/*", async (c, next) => {
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: "/rpc",
      context: c.get("ctx"),
    });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });
  app.use("/api/*", async (c, next) => {
    const { matched, response } = await api.handle(c.req.raw, {
      prefix: "/api",
      context: c.get("ctx"),
    });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

/**
 * One OAuth metadata document. It is public by definition and an MCP client
 * reads it from wherever it is running, so it answers any origin; the document
 * itself carries nothing a caller could not learn by asking for a token.
 */
function wellKnown(auth: Auth) {
  return async (c: { req: { raw: Request } }) => {
    const response = await auth.handler(c.req.raw);
    const headers = new Headers(response.headers);
    headers.set("access-control-allow-origin", "*");
    return new Response(response.body, { status: response.status, headers });
  };
}

/**
 * The context every operation sees: how the caller authenticated, the Member
 * row behind that credential, and, for an Agent, the Projects it may see.
 */
export async function buildContext(
  db: Db,
  auth: Auth | undefined,
  headers: Headers,
  // Not optional, so the required parameter after it may be required too; every
  // caller already had one to pass.
  baseURL: string | undefined,
  /**
   * Which surface this request reached, so an access token is checked against
   * the resource it was minted for (auth.ts). No default: every caller says
   * which surface it is, because the one that forgets would accept tokens
   * minted for the other.
   */
  resourcePath: ResourcePath,
): Promise<AppContext> {
  const { principal, session } = await resolvePrincipal({ auth, headers, baseURL, resourcePath });
  // An instance without auth cannot mint keys; apiKeysOf turns that into a
  // NOT_IMPLEMENTED rather than a caller's mistake (keys.ts).
  const base = {
    db,
    principal,
    grantedProjectIds: null,
    ...(baseURL ? { baseURL } : {}),
    ...(auth ? { apiKeys: betterAuthKeys(auth, db) } : {}),
  };
  if (!session) return { ...base, session: null, member: null, workspace: null };
  const found = await db.query.member.findFirst({
    where: { userId: session.user.id },
    with: { workspace: true },
  });
  if (!found) return { ...base, session, member: null, workspace: null };
  const { workspace, ...member } = found;
  return {
    ...base,
    session,
    member,
    workspace,
    // A Human is not scoped in v1, so null means every Project and costs no
    // query; only an Agent pays for its grants (docs/plans/m2.md).
    grantedProjectIds: member.kind === "agent" ? await grantedProjectIds(db, member.id) : null,
  };
}

async function grantedProjectIds(db: Db, memberId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: projectGrant.projectId })
    .from(projectGrant)
    .where(eq(projectGrant.memberId, memberId));
  return rows.map((row) => row.projectId);
}
