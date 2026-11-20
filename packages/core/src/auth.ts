import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { allowlistRule, invitation, member, workspace, type Db } from "@deevy/db";
import { and, eq, isNull } from "drizzle-orm";
import { allocateHandle, slugify } from "./handles.ts";
import { betterAuth, type AuthContext, type BetterAuthOptions } from "better-auth";
import { isAPIError } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { genericOAuth, lastLoginMethod } from "better-auth/plugins";
import { appendEvent } from "./events.ts";
import { authId, newId } from "./ids.ts";
import { basePathOf } from "./base-path.ts";
import { signInRelay } from "./sign-in-relay.ts";

/**
 * Both halves of an OAuth client. Half a pair is not a provider: a `clientId`
 * of `""` still registers one with Better Auth, and the failure then arrives
 * as a redirect to the provider's own error page rather than as a sign-in page
 * that can say this instance offers nothing (docs/plans/sign-in.md).
 */
export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/**
 * A generic OpenID Connect client: the pair, the issuer everything else is
 * discovered from, and what the button should say. One entry, not a list — a
 * self-hosted instance has one IdP, and a list of them would put JSON in a
 * wrangler secret to serve a case nobody has (docs/plans/sign-in.md).
 *
 * `issuer` is required, because there is nothing to default it to: Okta,
 * Entra, Keycloak and Authentik are all somewhere else. `name` is what the
 * operator calls their own IdP, so naming it is a variable rather than an edit
 * to the SPA.
 */
export interface OidcClient extends OAuthClient {
  issuer: string;
  name?: string;
}

/**
 * A Microsoft Entra ID client, and which accounts it takes: `common` (the
 * default) is work, school and personal accounts; `organizations` leaves out
 * personal ones; a tenant's own id takes only that tenant. Microsoft vouches
 * for an address only when the tenant sends a verified-email claim, so a
 * sign-in without one comes in by invitation (docs/OPERATIONS.md).
 */
export interface MicrosoftClient extends OAuthClient {
  tenantId?: string;
}

/**
 * What a deployment configures: one optional entry per provider deevy offers,
 * which are four (docs/plans/simplify.md, slice 10). A sign-in is who a Human
 * is in deevy and nothing more — no account on a tool vouches for anybody
 * (ADR-0036) — so a provider is here because a team signs in with it, not
 * because deevy works in it.
 */
export interface AuthProviders {
  github?: OAuthClient;
  google?: OAuthClient;
  microsoft?: MicrosoftClient;
  oidc?: OidcClient;
}

/**
 * The order the sign-in page offers providers in when the operator names none
 * (docs/plans/sign-in.md, "More ways to sign in"): the ones an engineering team
 * reaches for first — GitHub, Google, Microsoft — and the operator's own IdP
 * last, unless they pin it first with `DEEVY_SIGN_IN_ORDER`.
 */
const DEFAULT_SIGN_IN_ORDER = ["github", "google", "microsoft", "oidc"] as const;

/**
 * The providers a relay carries: every configured one whose App is the
 * platform's. A Workspace's own OpenID Connect IdP is registered with the
 * Workspace, and comes back to the deevy that asked, as it would without a
 * relay.
 */
export function relayedProviders(providers: AuthProviders): string[] {
  return Object.keys(socialProvidersOf(providers)).filter((id) => id !== OIDC_PROVIDER_ID);
}

/** What deevy calls its one generic OIDC provider, in every URL it appears in. */
export const OIDC_PROVIDER_ID = "oidc";

/** What the button says when the operator did not name their own IdP. */
const DEFAULT_OIDC_LABEL = "Single sign-on";

/**
 * How the SPA starts a sign-in with a provider. One value, and honest: Better
 * Auth 1.7.3's `genericOAuth` registers its configuration as a first-class
 * social provider, so a generic OIDC entry is started with `signIn.social` and
 * comes back on `callback/oidc` exactly as GitHub does. The field stays
 * because what the server registered is what the page has to know, and a
 * release that gives the generic plugin its own endpoints again would say so
 * here rather than in `App.tsx` (docs/plans/sign-in.md).
 */
export type SignInProviderKind = "social";

/** One provider, as the sign-in page needs it: what to call, and what to say. */
export interface SignInProvider {
  id: string;
  label: string;
  kind: SignInProviderKind;
}

/**
 * Why an entry will not run without `BETTER_AUTH_SECRET`, in the words both
 * say it in. Better Auth falls back to a default it publishes and refuses it
 * only where it reads `NODE_ENV=production`: in the image that is inside its
 * context, so the server comes up, `/healthz` answers and every sign-in fails;
 * on a Worker without `nodejs_compat` there is no `NODE_ENV` to read, so
 * sessions, the links deevy sends and the provider tokens it seals all rest on
 * a value anybody can look up. The Node server refuses to start instead, and
 * the Worker refuses every request (docs/OPERATIONS.md).
 */
export const MISSING_AUTH_SECRET =
  "BETTER_AUTH_SECRET is not set. deevy signs sessions and the links it sends with it, and seals sign-in providers' tokens under it, so it does not run without one: set it to at least 32 random characters, such as the output of `openssl rand -base64 32`.";

export interface AuthEnv {
  /** Public URL of the server; callbacks derive from it. */
  baseURL?: string;
  /**
   * A relay to sign in through, when this deevy is one of many behind one
   * set of provider Apps — a hosted Workspace, or one of an operator's several
   * deployments (`DEEVY_SIGN_IN_RELAY_URL`, sign-in-relay.ts, ADR-0030). Every
   * provider but this deevy's own OpenID Connect IdP then comes back through
   * the relay's `/callback/<provider>`.
   */
  signInRelay?: { url: string; secret: string };
  /** At least 32 random characters in production. */
  secret?: string;
  /** Browser origins allowed to use the session cookie (the Vite dev server). */
  trustedOrigins?: string[];
  /** Which sign-in providers this deployment offers. Absent offers none. */
  providers?: AuthProviders;
  /**
   * The providers to offer first, by id, in this order (`DEEVY_SIGN_IN_ORDER`);
   * the rest follow in the default order. What is named and not configured is
   * ignored.
   */
  signInOrder?: string[];
  /** The first sign-in with this email creates the Workspace and becomes admin. */
  adminEmail?: string;
  workspaceName?: string;
}

export interface CreateAuthOptions {
  db: Db;
  env: AuthEnv;
  /**
   * Where Better Auth's own log lines go: its console, unless an entry says
   * otherwise. A hosted Workspace says otherwise, because a line Better Auth
   * writes about a failed query carries the values it was bound to, and its
   * log promises nothing from the database (apps/hosted/src/log.ts).
   */
  logger?: AuthLogger;
  /**
   * Hand an error Better Auth did not expect — a failed query in one of its
   * endpoints, or in deevy's own hooks on a new user or session — back to
   * whoever called its handler. Left to itself, better-call writes such an
   * error whole to the console (`# SERVER_ERROR`, past any `logger`) and
   * answers an empty 500; handed back, it reaches the app's error handler,
   * which reports it through the entry's reporter and answers a 500 too
   * (app.ts). A refusal Better Auth chose, an `APIError`, is still its own
   * response, and one that is an internal error is still said through
   * `logger`. A hosted Workspace asks for this; the image and the Worker keep
   * Better Auth's own lines (apps/hosted/src/log.ts).
   */
  rethrowUnexpected?: boolean;
}

/** Better Auth's log option, which `createAuth` passes through as it is. */
export type AuthLogger = NonNullable<BetterAuthOptions["logger"]>;

/**
 * Better Auth is identity for Humans and, from M2, Agents (ADR-0007). Every
 * Member is a Better Auth user; deevy keeps its own workspace and member tables.
 */
export function createAuth({ db, env, logger, rethrowUnexpected = false }: CreateAuthOptions) {
  const base = basePathOf(env.baseURL);
  const auth = betterAuth({
    ...(logger ? { logger } : {}),
    // Better Auth's router calls this for every error but a redirect, in place
    // of its own handling: an internal `APIError` is said through `logger` as
    // Better Auth says one, any `APIError` is answered as it would be, and
    // anything else is thrown on, so better-call never reaches the line that
    // logs it whole.
    ...(rethrowUnexpected
      ? {
          onAPIError: {
            onError: (error: unknown, context: AuthContext) => {
              if (!isAPIError(error)) throw error;
              if (error.status === "INTERNAL_SERVER_ERROR")
                context.logger.error(error.status, error);
            },
          },
        }
      : {}),
    // Better Auth routes on the path of its own URL, and keeps a URL that
    // already has one exactly as given, so it is handed `…/api/auth` outright:
    // at the root of a host that is what it worked out before, and under a
    // path it is the only way its routes land under the base (base-path.ts).
    ...(env.baseURL ? { baseURL: `${env.baseURL.replace(/\/+$/, "")}${AUTH_BASE_PATH}` } : {}),
    secret: env.secret,
    basePath: `${base}${AUTH_BASE_PATH}`,
    trustedOrigins: env.trustedOrigins,
    database: drizzleAdapter(db, { provider: "sqlite" }),
    advanced: {
      // Its rows get deevy's prefixed ids too (ids.ts, ADR-0015): usr_, ses_, acct_, key_…
      database: { generateId: ({ model }) => authId(model) },
      // Under a path, a session is the path's: two deployments on one host —
      // two hosted Workspaces, say — would otherwise overwrite each other's
      // cookie, and signing in to one would sign you out of the other.
      ...(base ? { defaultCookieAttributes: { path: base } } : {}),
    },
    emailAndPassword: { enabled: false },
    // An Agent's key is issued by its Sponsor through `agents.keys.*`, which
    // calls the plugin from the server, and never over HTTP: the plugin's own
    // routes would let a signed-in Human mint a key that stands for them, a
    // delegated credential deevy no longer has (ADR-0035).
    disabledPaths: apiKeyRoutes,
    plugins: [
      ...apiKeyPlugins(),
      ...oidcPlugins(env.providers ?? {}),
      // Which provider this browser signed in with last, in a cookie of its
      // own (no account, no address), so the sign-in page can offer it first
      // with "Last used" (docs/plans/sign-in.md, "More ways to sign in").
      lastLoginMethod(),
      ...(env.signInRelay && env.baseURL
        ? [
            signInRelay({
              ...env.signInRelay,
              providers: relayedProviders(env.providers ?? {}),
              own: `${env.baseURL.replace(/\/+$/, "")}${AUTH_BASE_PATH}`,
            }),
          ]
        : []),
    ],
    socialProviders: socialProvidersOf(env.providers ?? {}),
    account: {
      accountLinking: accountLinkingOf(env),
      // A provider's access and refresh tokens are sealed under the instance
      // secret as Better Auth writes them, so a database dump or a table
      // viewer never shows one in the clear. The id token is not a credential
      // and stays as it came. A row
      // written before this was on stays readable (`plainOAuthToken`) and is
      // sealed the next time its Human signs in with that provider.
      encryptOAuthTokens: true,
    },
    user: {
      additionalFields: {
        kind: {
          type: ["human", "agent"],
          required: false,
          defaultValue: "human",
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await admit(db, env, readToken, {
              userId: user.id,
              email: user.email,
              name: user.name,
              emailVerified: user.emailVerified,
            });
          },
        },
      },
      // Also on every new session, so an admin email configured after the
      // first sign-in still bootstraps the Workspace. Idempotent.
      session: {
        create: {
          after: async (session) => {
            const user = await db.query.user.findFirst({ where: { id: session.userId } });
            if (user) {
              await admit(db, env, readToken, {
                userId: user.id,
                email: user.email,
                name: user.name,
                emailVerified: user.emailVerified,
              });
            }
          },
        },
      },
    },
  });
  // What a join asks GitHub with: the token as the provider issued it, read
  // through the same context Better Auth sealed it with. The hooks above run
  // inside a request, long after `$context` settled.
  const readToken = async (stored: string) =>
    plainOAuthToken(stored, (await auth.$context).secretConfig);
  // Better Auth starts initialising the moment it is constructed, so the
  // context is a promise that may fail before anyone has awaited it. This handler only
  // marks that promise as observed: every real `await auth.$context` still
  // sees a failure, but a caller that builds an instance and never uses it
  // does not turn one into an unhandled rejection.
  void auth.$context.catch(() => {});
  return auth;
}

/**
 * The providers this deployment offers, in the order the sign-in page renders
 * them. Public through `health.ping`: an instance that cannot say what it
 * offers cannot render its own sign-in page (docs/plans/sign-in.md).
 */
export function signInProviders(env: Pick<AuthEnv, "providers" | "signInOrder">): SignInProvider[] {
  const providers = env.providers ?? {};
  const oidc = configuredOidc(providers.oidc);
  const labels: Record<(typeof DEFAULT_SIGN_IN_ORDER)[number], string | null> = {
    github: configuredClient(providers.github) ? "GitHub" : null,
    google: configuredClient(providers.google) ? "Google" : null,
    microsoft: configuredClient(providers.microsoft) ? "Microsoft" : null,
    oidc: oidc?.label ?? null,
  };
  const known = new Set<string>(DEFAULT_SIGN_IN_ORDER);
  const first = (env.signInOrder ?? []).filter((id) => known.has(id));
  const order = [...new Set([...first, ...DEFAULT_SIGN_IN_ORDER])] as Array<
    (typeof DEFAULT_SIGN_IN_ORDER)[number]
  >;
  return order.flatMap((id) => {
    const label = labels[id];
    return label ? [{ id, label, kind: "social" as const }] : [];
  });
}

/**
 * One Human, one Member (docs/plans/sign-in.md). A teammate who signed in with
 * one provider in March and another in April is one user row with two accounts
 * — one handle, one inbox, one Member — rather than two strangers who share an
 * address. Better Auth links that way by default; this says so, because what a
 * Workspace's identity model is should not be inherited from a minor release.
 *
 * **No provider is trusted by name.** Better Auth's `trustedProviders` does not
 * mean "a provider this deployment offers"; it means "link this provider's
 * sign-in without reading whether it says the address is verified". Every
 * provider deevy ships reports a verified address when it has one — GitHub and
 * Google always do — so naming them buys no case that works and costs the one refusal that matters:
 * an IdP with open self-registration, telling the truth about an address it has
 * not verified, would otherwise link a stranger onto the Member who holds it
 * (docs/OPERATIONS.md).
 *
 * The cost of the empty list is a provider that reports nothing at all. An
 * OpenID Connect IdP that omits `email_verified` — Entra does — cannot become
 * somebody's second provider, and says so with `account_not_linked` rather than
 * linking on a claim nobody made.
 *
 * The gate that stays is Better Auth's `requireLocalEmailVerified`, left at its
 * default `true` — the row already holding the address must itself have proved
 * it, so nobody collects somebody else's next sign-in by registering an
 * unverified account at their address first. It is set nowhere here because the
 * option is deprecated on its way to being unconditional, and a value written
 * down now is a value to delete later.
 *
 * Two sign-ins are one Human only on one verified address. Nothing in deevy
 * links an account on another address any more — an account on a tool vouches
 * for nobody (ADR-0036) — so Better Auth's `allowDifferentEmails` is left at
 * its default, and its `link-social` route, which a signed-in session could
 * still call, links only a second sign-in at the address it already has.
 */
export function accountLinkingOf(_env: Pick<AuthEnv, "providers">) {
  return { enabled: true, trustedProviders: [] };
}

/**
 * The social providers Better Auth registers: the configured entries, and only
 * those. What `signInProviders` reports and what `createAuth` registers are
 * decided by the same predicate, so a button on the page is a provider the
 * server will actually start a sign-in with.
 */
function socialProvidersOf(providers: AuthProviders) {
  const github = configuredClient(providers.github);
  const google = configuredClient(providers.google);
  const microsoft = configuredClient(providers.microsoft);
  return {
    // GitHub's default scopes are all deevy asks for: who the user is and the
    // addresses they verified. Nothing reads their organizations any more.
    ...(github ? { github } : {}),
    // Google's default scopes are all deevy asks for: the address and the
    // name, both of which arrive in the `id_token`. `hd` is deliberately
    // unset — a Google Workspace is an email domain, and who may join is an
    // `email_domain` rule in deevy's own UI, so there is one place to look
    // rather than two that can disagree (docs/plans/sign-in.md).
    ...(google ? { google } : {}),
    // Microsoft's `email` claim is whatever the tenant says, which is why an
    // address counts only with a verified-email claim beside it (Better Auth
    // reads `email_verified`, `verified_primary_email` and
    // `verified_secondary_email`). The profile photo is left alone: deevy
    // draws initials, and a Graph call per sign-in buys nothing.
    ...(microsoft
      ? {
          microsoft: {
            ...microsoft,
            tenantId: providers.microsoft?.tenantId?.trim() || "common",
            disableProfilePhoto: true,
          },
        }
      : {}),
  };
}

/**
 * The generic OpenID Connect provider, when the deployment configured one
 * (docs/plans/sign-in.md). Everything but the client pair is discovered from
 * the issuer's well-known document, so an operator behind Okta, Entra,
 * Keycloak or Authentik configures four variables and nothing else.
 *
 * In Better Auth 1.7.3 `genericOAuth` registers what it is given as a
 * first-class social provider, so this entry is signed in with
 * `signIn.social` and comes back on `/api/auth/callback/oidc` the way GitHub
 * does — there is no second endpoint shape for the SPA to know about.
 *
 * `requireIdTokenVerification` is on: an OIDC sign-in's identity is the
 * `id_token`'s claims, so a discovery document that hands back no issuer and
 * no `jwks_uri` must leave the provider unregistered rather than quietly
 * downgrade it to decoding a token nobody checked. PKCE is on for the same
 * reason it is on everywhere else — OAuth 2.1 requires it of every
 * authorization code flow.
 */
function oidcPlugins(providers: AuthProviders) {
  const oidc = configuredOidc(providers.oidc);
  if (!oidc) return [];
  return [
    genericOAuth({
      config: [
        {
          providerId: OIDC_PROVIDER_ID,
          name: oidc.label,
          discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
          clientId: oidc.clientId,
          clientSecret: oidc.clientSecret,
          // The three every OpenID Provider serves, and no more: deevy wants
          // the subject, the name and the address, and asks an IdP's admin to
          // approve nothing beyond them.
          scopes: ["openid", "profile", "email"],
          pkce: true,
          requireIdTokenVerification: true,
        },
      ],
    }),
  ];
}

/**
 * A generic OIDC entry with both halves of its pair *and* an issuer, or
 * nothing. An issuer is as load-bearing as the pair here: without one there is
 * no discovery document, so there is nothing to register and nothing a button
 * could start.
 */
function configuredOidc(
  client: OidcClient | undefined,
): { clientId: string; clientSecret: string; issuer: string; label: string } | null {
  const pair = configuredClient(client);
  const issuer = client?.issuer.trim().replace(/\/+$/, "");
  if (!pair || !issuer) return null;
  return { ...pair, issuer, label: client?.name?.trim() || DEFAULT_OIDC_LABEL };
}

/** An entry with both halves of its pair, or nothing. */
function configuredClient(client: OAuthClient | undefined): OAuthClient | null {
  const clientId = client?.clientId.trim();
  const clientSecret = client?.clientSecret.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** The prefix every deevy API key carries, and the discriminator resolvePrincipal reads. */
export const apiKeyPrefix = "deevy_sk_";

/**
 * How an Agent authenticates (ADR-0007). The plugin's default header is
 * x-api-key; MCP clients send a bearer, and so does curl, so the key is read
 * from Authorization instead. Rate limiting is off: it would silently 429 an
 * agent loop, and rate limits belong at the edge (docs/plans/m2.md). Mirrored
 * in packages/db/auth.generate.config.ts, which the schema generator reads.
 */
export function apiKeyPlugins() {
  return [
    apiKey({
      defaultPrefix: apiKeyPrefix,
      rateLimit: { enabled: false },
      customAPIKeyGetter: (ctx) => bearerApiKey(ctx.headers),
    }),
  ];
}

/**
 * The api-key plugin's own routes, closed to HTTP (`disabledPaths` above). The
 * plugin still verifies a key, and deevy still issues and revokes one, through
 * `auth.api`, which no browser reaches.
 */
const apiKeyRoutes = [
  "/api-key/create",
  "/api-key/get",
  "/api-key/update",
  "/api-key/delete",
  "/api-key/list",
  "/api-key/verify",
  "/api-key/delete-all-expired-api-keys",
];

/** Where the MCP endpoint is mounted, which only an Agent's key reaches (ADR-0035). */
export const MCP_PATH = "/mcp";
/** Where the operation API is mounted; `/rpc` is a second transport for the same operations. */
export const API_PATH = "/api";

/** Where Better Auth's own routes are mounted. */
export const AUTH_BASE_PATH = "/api/auth";

/** The Authorization bearer of a request, whatever kind of credential it is. */
export function bearerToken(headers: Headers | undefined): string | null {
  const [scheme, token] = (headers?.get("authorization") ?? "").split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * The bearer, only when it is a deevy API key: anything else on the header is
 * nobody, and the plugin need not look it up.
 */
export function bearerApiKey(headers: Headers | undefined): string | null {
  const token = bearerToken(headers);
  return token?.startsWith(apiKeyPrefix) ? token : null;
}

/**
 * The two ways a sign-in becomes a Member, in order: the configured admin
 * bootstraps the Workspace, anyone else joins when an allowlist rule matches.
 * Both are idempotent, so the two Better Auth hooks may run either or both.
 */
async function admit(
  db: Db,
  env: AuthEnv,
  readToken: ReadOAuthToken,
  user: JoiningUser,
): Promise<void> {
  await bootstrapWorkspace(db, user, env);
  await joinWorkspace(db, user, joinPorts(db, user.userId, readToken));
}

/** Turns an access token as the `account` table holds it into the one the provider issued. */
export type ReadOAuthToken = (stored: string) => Promise<string>;

/**
 * An access or refresh token as the provider issued it, from the `account`
 * row Better Auth wrote (`encryptOAuthTokens`), opened with the secret Better
 * Auth sealed it with (its context's `secretConfig`).
 *
 * Better Auth's own reader, `decryptOAuthToken`, takes a value that is not hex
 * for one written in the clear, which covers GitHub's and Google's tokens —
 * but a token that happens to be all hex (GitLab's were sixty-four hex
 * characters) reads to it as sealed, and throws. A sealed value is authenticated, so one that does not open was never
 * sealed: it is a row from before the option was on, and it is the token
 * itself. That is also why this opens the value directly rather than asking
 * whether the option is on: a row sealed while it was stays readable.
 */
export async function plainOAuthToken(
  stored: string,
  secretConfig: AuthContext["secretConfig"],
): Promise<string> {
  try {
    return await symmetricDecrypt({ key: secretConfig, data: stored });
  } catch {
    return stored;
  }
}

/** How long GitHub has to answer a question about a sign-in. */
const FORGE_TIMEOUT_MS = 5_000;

/**
 * What a join can ask a provider about this sign-in: the GitHub login a
 * Human's handle is made from, which is the one thing a provider is asked
 * about a sign-in now that who may join is an address's domain or an
 * invitation (docs/plans/simplify.md, slice 10). Lazy, so a sign-in with no
 * GitHub account, or one already a Member, costs no round trip.
 */

export function joinPorts(db: Db, userId: string, readToken: ReadOAuthToken): JoinOptions {
  const token = async (providerId: string) => {
    const account = await db.query.account.findFirst({ where: { userId, providerId } });
    return account?.accessToken ? await readToken(account.accessToken) : null;
  };
  const get = async <T>(providerId: string, url: string, accept: string): Promise<T | null> => {
    const accessToken = await token(providerId);
    if (!accessToken) return null;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept,
        "user-agent": "deevy",
      },
      // A join never costs a teammate their sign-in, which was true of a forge
      // that fails and not of one that is merely slow: this runs inside a
      // Better Auth hook, so a host that accepts the connection and never
      // answers held the sign-in open for as long as the runtime allowed.
      signal: AbortSignal.timeout(FORGE_TIMEOUT_MS),
    });
    return res.ok ? ((await res.json()) as T) : null;
  };
  return {
    login: async () => {
      const github = await get<{ login?: string }>(
        "github",
        "https://api.github.com/user",
        "application/vnd.github+json",
      ).catch(() => null);
      return github?.login ?? null;
    },
  };
}

export { allocateHandle, slugify } from "./handles.ts";

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];

/**
 * Deterministic first-admin bootstrap (ADR-0007): when the configured admin
 * email signs in and no Workspace exists yet, create the Workspace and the
 * admin Member; if the Workspace exists but the admin has no Member row yet,
 * add it. Each write appends its Event with no actor, since deevy itself is
 * doing the writing. Sequential writes, no transaction (ADR-0006). Anyone else
 * gets a user row and no Member until M1's allowlist.
 */
export async function bootstrapWorkspace(
  db: Db,
  user: JoiningUser,
  env: Pick<AuthEnv, "adminEmail" | "workspaceName">,
): Promise<void> {
  if (!env.adminEmail || user.email.toLowerCase() !== env.adminEmail.toLowerCase()) return;
  // The admin is an address, so only an address the provider verified is it.
  if (!user.emailVerified) return;
  if (await db.query.member.findFirst({ where: { userId: user.userId } })) return;
  let workspaceId = (await db.query.workspace.findFirst())?.id;
  const source = { db, workspace: { id: "" }, member: null };
  if (!workspaceId) {
    const name = env.workspaceName?.trim() || "deevy";
    workspaceId = newId("workspace");
    await db.insert(workspace).values({ id: workspaceId, name, slug: slugify(name) });
    source.workspace.id = workspaceId;
    await appendEvent(source, {
      kind: "workspace.created",
      subjectType: "workspace",
      subjectId: workspaceId,
      payload: { name },
    });
  }
  source.workspace.id = workspaceId;
  const memberId = newId("member");
  await db.insert(member).values({
    id: memberId,
    workspaceId,
    userId: user.userId,
    role: "admin",
    kind: "human",
    handle: await allocateHandle(db, user.name ?? user.email),
  });
  await appendEvent(source, {
    kind: "member.joined",
    subjectType: "member",
    subjectId: memberId,
    payload: { role: "admin", kind: "human" },
  });
}

/** The sign-in a join decision is made about. */
export interface JoiningUser {
  userId: string;
  email: string;
  name?: string | null;
  /**
   * Whether the provider vouched for the address. Only a verified address
   * makes the admin or matches an `email_domain` rule: a provider that does
   * not vouch — an Entra tenant without verified-email claims — would
   * otherwise let anybody claim an address and be let in by it ("nOAuth"). An
   * invitation still admits, because its link is the proof.
   */
  emailVerified: boolean;
}

export interface JoinOptions {
  /**
   * What the provider calls this sign-in — a GitHub login — preferred over a
   * slug of the name as the handle. Provider-neutral, because a handle is
   * deevy's and any provider with a login hands out the same kind of thing.
   *
   * A port rather than a string, and asked only when a Member is actually
   * being created: the sign-in's own profile is a round trip, and `admit` runs
   * on every session as well as every user (docs/plans/sign-in.md).
   */
  login?: () => Promise<string | null>;
}

/**
 * The M1 allowlist (docs/plans/m1.md): a sign-in that is not yet a Member joins
 * the Workspace as a `member` when any rule matches. Runs from the same two
 * Better Auth hooks as `bootstrapWorkspace` and is idempotent, so a repeat
 * sign-in changes nothing. Sequential writes, no transaction (ADR-0006).
 */
export async function joinWorkspace(
  db: Db,
  user: JoiningUser,
  options: JoinOptions = {},
): Promise<void> {
  if (await db.query.member.findFirst({ where: { userId: user.userId } })) return;
  const ws = await db.query.workspace.findFirst();
  if (!ws) return;
  if (!(await matchesAllowlist(db, ws.id, user))) return;

  const memberId = newId("member");
  await db.insert(member).values({
    id: memberId,
    workspaceId: ws.id,
    userId: user.userId,
    role: "member",
    kind: "human",
    handle: await allocateHandle(db, (await options.login?.()) ?? user.name ?? user.email),
  });
  await appendEvent(
    { db, workspace: ws, member: null },
    {
      kind: "member.joined",
      subjectType: "member",
      subjectId: memberId,
      payload: { role: "member", kind: "human" },
    },
  );
  // Somebody who was invited and then matched a rule is in, so the invitation
  // is spent: an open row for an address that is already a Member is one an
  // admin reads as "has not answered yet" and cannot replace, because one live
  // invitation per address refuses the next (docs/plans/sign-in.md).
  await db
    .update(invitation)
    .set({ acceptedAt: new Date(), acceptedMemberId: memberId })
    .where(
      and(
        eq(invitation.workspaceId, ws.id),
        eq(invitation.email, user.email.toLowerCase()),
        isNull(invitation.acceptedAt),
        isNull(invitation.revokedAt),
      ),
    );
}

async function matchesAllowlist(db: Db, workspaceId: string, user: JoiningUser): Promise<boolean> {
  const domain = user.email.toLowerCase().split("@").at(-1) ?? "";
  const rules = await db
    .select()
    .from(allowlistRule)
    .where(eq(allowlistRule.workspaceId, workspaceId));
  // A domain rule is about the address, so it takes only one the provider
  // verified. It is the only rule there is: an organisation or a group on a
  // tool admits nobody (docs/plans/simplify.md, slice 10).
  return (
    user.emailVerified &&
    rules.some((rule) => rule.kind === "email_domain" && rule.value === domain)
  );
}
