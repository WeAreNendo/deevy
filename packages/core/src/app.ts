import { projectGrant, type Db } from "@deevy/db";
import type { SocketModules } from "./sockets/port.ts";
import { finishAccountLink } from "./account-links.ts";
import type { EmailSenders, EmailSetup } from "./email/port.ts";
import { confirmChannel, emailChannelOf, readConfirmToken } from "./email/team.ts";
import { appendEvent } from "./events.ts";
import {
  kindLabels,
  readUnsubscribeToken,
  unsubscribe,
  unsubscribePage,
} from "./email/unsubscribe.ts";
import { handleInbound, handleSetup } from "./sockets/hooks.ts";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferenceHandlerPlugin } from "@orpc/openapi/plugins";
import { COMMON_ERROR_STATUS_MAP, DEFAULT_ERROR_STATUS, ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { StandardLazyRequest } from "@orpc/client";
import type { StandardHandlerInterceptor } from "@orpc/server/standard";
import { CORSHandlerPlugin } from "@orpc/server/plugins";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Auth, SignInProvider } from "./auth.ts";
import { discardingJobQueue, type JobQueue } from "./jobs.ts";
import type { LiveOptions } from "./live.ts";
import { createDeevyMcp } from "./mcp/server.ts";
import { generateSpec } from "./openapi.ts";
import { SCALAR_SCRIPT, securityHeaders } from "./headers.ts";
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
   * Whether this deployment registered the in-process Socket stub. Reported on
   * `health.ping` like `devSignIn`, so a developer can tell a stubbed instance
   * from a real one without reading its environment (packages/sockets/src/stub).
   */
  devSockets?: boolean;
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
   * The email senders this runtime can run, and the one the environment chose
   * (docs/plans/email-channel.md). What an operation sends now — a team
   * address's confirmation, a test email — goes through them.
   */
  emailSenders?: EmailSenders;
  email?: EmailSetup | null;
  /** Why the environment's sender could not be read: Settings › Email says it. */
  emailProblem?: string | null;
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
/** What a confirmation link that was changed, is too old, or names a removed Channel says. */
const expiredConfirmation = {
  title: "This link doesn't work any more",
  body: "It is too old, the Channel was removed, or it was changed on the way. Ask the admin who added this address to send a new one from Settings › Channels.",
};

function confirmedPage(address: string) {
  return {
    title: "Confirmed",
    body: `${address} now gets the Notifications routed to it. To stop them, ask an admin to remove the Channel.`,
  };
}

/** What a link that was changed, or is too old, says instead. */
function expiredLink(settingsUrl: string) {
  return {
    title: "This link doesn't work any more",
    body: "It is too old, or it was changed on the way. You can still choose what deevy emails you in Settings.",
    settingsUrl,
  };
}

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
  devSockets = false,
  sockets,
  socketSecret,
  emailSenders,
  email,
  emailProblem,
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

  // First, so every response leaves with them: the API's, the pages the server
  // writes, and on Node the SPA `mountSpa` adds after the fact. The Worker's
  // static assets are answered before this app runs and carry the same
  // through `apps/web/public/_headers` (headers.ts).
  app.use("*", securityHeaders);

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
      // Where a Human opens deevy, which a chat reply names when it tells
      // somebody where to link their account (sockets/chat.ts).
      ...((webURL ?? baseURL) ? { origin: webURL ?? baseURL } : {}),
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
    devSockets,
    ...(sockets ? { sockets } : {}),
    ...(socketSecret ? { socketSecret } : {}),
    ...(emailSenders ? { emailSenders } : {}),
    ...(email ? { email } : {}),
    ...(emailProblem ? { emailProblem } : {}),
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
  // Where a tool with an OAuth grant of its own — Linear — sends a Human's
  // browser back after they consented to link their account there. A route
  // rather than an operation, because what answers a browser mid-redirect is a
  // redirect, and after the context so the session is the one that started it
  // (account-links.ts, ADR-0025).
  app.get("/api/identities/:provider/callback", async (c) => {
    const { location } = await finishAccountLink(c.get("ctx"), {
      provider: c.req.param("provider"),
      ...(c.req.query("code") ? { code: c.req.query("code") } : {}),
      ...(c.req.query("state") ? { state: c.req.query("state") } : {}),
      ...(c.req.query("error") ? { error: c.req.query("error") } : {}),
    });
    return c.redirect(location, 302);
  });

  // The one-click unsubscribe every personal email carries (RFC 8058,
  // email/unsubscribe.ts). Opening it changes nothing — a mail scanner opens
  // every link in an email — and only a POST, from the page's button or from
  // a client's own "unsubscribe", turns the kind off. Routes rather than
  // operations, because what answers is a page and the caller is a browser or
  // a mail client with no session.
  const settingsUrl = `${(webURL ?? baseURL ?? "").replace(/\/+$/, "")}/settings/notifications`;
  app.get("/api/email/unsubscribe/:token", async (c) => {
    const read = secret ? await readUnsubscribeToken(secret, c.req.param("token")) : null;
    if (!read) return c.html(unsubscribePage(expiredLink(settingsUrl)), 400);
    return c.html(
      unsubscribePage({
        title: "Stop these emails?",
        body: `You'll no longer get emails for “${kindLabels[read.kind]}”. The inbox and Slack stay as they are.`,
        form: { action: c.req.path, label: "Stop these emails" },
        settingsUrl,
      }),
    );
  });
  app.post("/api/email/unsubscribe/:token", async (c) => {
    const read = secret ? await readUnsubscribeToken(secret, c.req.param("token")) : null;
    if (!read) return c.html(unsubscribePage(expiredLink(settingsUrl)), 400);
    // A Member who has since left has nothing left to turn off.
    await unsubscribe(db, read).catch(() => undefined);
    return c.html(
      unsubscribePage({
        title: "Done",
        body: `deevy won't email you for “${kindLabels[read.kind]}” any more. You can turn it back on any time.`,
        settingsUrl,
      }),
    );
  });

  // The link a team address is mailed to confirm it (email/team.ts): opening
  // it asks, as the unsubscribe does, and only the button confirms.
  app.get("/api/email/confirm/:token", async (c) => {
    const found = secret ? await readConfirmToken(db, secret, c.req.param("token")) : null;
    const email = found ? emailChannelOf(found) : null;
    if (!found || !email) return c.html(unsubscribePage(expiredConfirmation), 400);
    if (email.confirmedAt) return c.html(unsubscribePage(confirmedPage(email.address)));
    return c.html(
      unsubscribePage({
        title: "Confirm this address?",
        body: `${email.address} will get the Notifications routed to the Channel "${found.name}".`,
        form: { action: c.req.path, label: "Confirm this address" },
      }),
    );
  });
  app.post("/api/email/confirm/:token", async (c) => {
    const found = secret ? await readConfirmToken(db, secret, c.req.param("token")) : null;
    const email = found ? emailChannelOf(found) : null;
    if (!found || !email) return c.html(unsubscribePage(expiredConfirmation), 400);
    if (await confirmChannel(db, found)) {
      await appendEvent(
        { db, workspace: { id: found.workspaceId }, member: null },
        {
          kind: "channel.confirmed",
          subjectType: "channel",
          subjectId: found.id,
          payload: { name: found.name, address: email.address },
        },
      );
    }
    return c.html(unsubscribePage(confirmedPage(email.address)));
  });

  const corsPlugin = new CORSHandlerPlugin<AppContext>({ origin, credentials: true });
  // The browser origins a page of deevy's may call from: the same list CORS
  // answers, since the SPA may be served from an origin of its own. Checked
  // once an operation has matched, so the refusal is encoded the way each
  // surface encodes every other error, and reaches a client as one.
  const sameOriginWrites = refuseCrossSiteWrites(originsOf(origin));
  const rpc = new RPCHandler(router, {
    plugins: [corsPlugin],
    interceptors: [onError(reportUnexpected), sameOriginWrites],
  });
  const api = new OpenAPIHandler(router, {
    plugins: [
      corsPlugin,
      new OpenAPIReferenceHandlerPlugin({
        docsPath: "/docs",
        specPath: "/spec.json",
        spec: () => generateSpec(version),
        // The version the page's policy names, never jsDelivr's latest (headers.ts).
        providerScriptUrl: SCALAR_SCRIPT,
      }),
    ],
    interceptors: [onError(reportUnexpected), sameOriginWrites],
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

/** The methods a browser sends from any page without anything changing. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** A URL's origin as a browser writes it in `Origin`; null for what is not a URL. */
function webOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** The configured browser origins, each as the browser writes it in `Origin`. */
function originsOf(configured: string[]): ReadonlySet<string> {
  // What is not a URL at all no browser will ever send, so it allows nothing.
  return new Set(configured.map(webOrigin).filter((found): found is string => found !== null));
}

/**
 * Why a change this request asks for is refused, when the session cookie is
 * what authenticated it and a page of deevy's own is not what sent it; null
 * when it may go on.
 *
 * CORS keeps another site from reading an answer, not from sending the
 * request: a form or a no-cors fetch on any page reaches `/rpc` with the
 * browser's cookie attached, and SameSite stops that only across sites — a
 * sibling subdomain is the same site. So a write signed in by the cookie must
 * say where it came from. `Sec-Fetch-Site: same-origin` is the browser's own
 * word for a page on this origin; an `Origin` this instance was configured with
 * (the SPA may be served from one of its own), or the context's `baseURL` —
 * which is the request's own origin where none was configured — is the same
 * claim from a browser too old for the first, or over plain http, where it is
 * not sent. A request that says neither is refused: every browser sends
 * `Origin` on a POST, and a script or a CLI holds a bearer.
 *
 * A bearer — an Agent's key, an MCP client's token — is untouched, since no
 * browser attaches one by itself; so is a read, and a request no session
 * signed in, which has nothing of anybody's to spend.
 */
function crossSiteWrite(
  request: Pick<StandardLazyRequest, "method" | "headers">,
  context: Pick<AppContext, "principal" | "baseURL">,
  origins: ReadonlySet<string>,
): ORPCError<"FORBIDDEN", unknown> | null {
  if (SAFE_METHODS.has(request.method) || context.principal?.kind !== "cookie") return null;
  const header = (name: string) => {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  if (header("sec-fetch-site") === "same-origin") return null;
  const from = header("origin");
  if (from && (origins.has(from) || from === webOrigin(context.baseURL))) return null;
  return new ORPCError("FORBIDDEN", {
    message:
      "deevy only takes a change signed in with your session from its own pages. Use deevy itself, or an API key or access token from a script.",
  });
}

/**
 * `crossSiteWrite` as an interceptor on both surfaces: it runs once an
 * operation has matched, so what it throws is encoded as that surface's error
 * — an RPC client reads `FORBIDDEN`, an OpenAPI caller a 403 body.
 */
function refuseCrossSiteWrites(
  origins: ReadonlySet<string>,
): StandardHandlerInterceptor<AppContext> {
  return async (options) => {
    const refused = crossSiteWrite(options.request, options.context, origins);
    if (refused) {
      // Read and dropped before the refusal goes out: a request answered with
      // its body still unread left the connection it came on unusable under
      // workerd on Linux, and the next request on it was "Network connection
      // lost" (apps/web/scripts/smoke-workers.ts).
      await options.request.resolveBody().catch(() => undefined);
      throw refused;
    }
    return options.next();
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
