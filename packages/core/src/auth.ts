import { apiKey } from "@better-auth/api-key";
import { cimd } from "@better-auth/cimd";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { mcp } from "@better-auth/mcp";
import { allowlistRule, invitation, member, workspace, type Db } from "@deevy/db";
import { and, eq, isNull } from "drizzle-orm";
import { allocateHandle, slugify } from "./handles.ts";
import { betterAuth } from "better-auth";
import { genericOAuth, jwt } from "better-auth/plugins";
import { fetchClientMetadataResource, type MetadataResourceFetch } from "./cimd.ts";
import { appendEvent } from "./events.ts";
import { authId, newId } from "./ids.ts";

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
 * A GitLab client, and the instance it belongs to. `issuer` is what makes one
 * entry serve both gitlab.com and a self-hosted GitLab: every endpoint —
 * authorization, token, `/api/v4` — is built from it, so an operator points
 * deevy at their own instance without a second provider (docs/plans/sign-in.md).
 */
export interface GitLabClient extends OAuthClient {
  issuer?: string;
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
 * What a deployment configures: one optional entry per provider deevy offers.
 * A provider is configuration, not a constant, so offering another one is an
 * entry here and in `signInProviders` rather than an edit to the sign-in page
 * (docs/plans/sign-in.md).
 */
export interface AuthProviders {
  github?: OAuthClient;
  google?: OAuthClient;
  gitlab?: GitLabClient;
  oidc?: OidcClient;
}

/** Where a GitLab client lives when the deployment names no instance of its own. */
const DEFAULT_GITLAB_ISSUER = "https://gitlab.com";

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

export interface AuthEnv {
  /** Public URL of the server; callbacks derive from it. */
  baseURL?: string;
  /** At least 32 random characters in production. */
  secret?: string;
  /** Browser origins allowed to use the session cookie (the Vite dev server). */
  trustedOrigins?: string[];
  /** Which sign-in providers this deployment offers. Absent offers none. */
  providers?: AuthProviders;
  /** The first sign-in with this email creates the Workspace and becomes admin. */
  adminEmail?: string;
  workspaceName?: string;
  /**
   * How a Client ID Metadata Document is dereferenced. Defaults to the
   * web-standard transport in `cimd.ts`; a deployment that can pin a resolved
   * address supplies a stricter one here.
   */
  fetchClientMetadataResource?: MetadataResourceFetch;
}

export interface CreateAuthOptions {
  db: Db;
  env: AuthEnv;
}

/**
 * Better Auth is identity for Humans and, from M2, Agents (ADR-0007). Every
 * Member is a Better Auth user; deevy keeps its own workspace and member tables.
 */
export function createAuth({ db, env }: CreateAuthOptions) {
  const auth = betterAuth({
    baseURL: env.baseURL,
    secret: env.secret,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: env.trustedOrigins,
    database: drizzleAdapter(db, { provider: "sqlite" }),
    // Its rows get deevy's prefixed ids too (ids.ts, ADR-0015): usr_, ses_, acct_, key_…
    advanced: { database: { generateId: ({ model }) => authId(model) } },
    emailAndPassword: { enabled: false },
    plugins: [...apiKeyPlugins(), ...oauthServerPlugins(env), ...oidcPlugins(env.providers ?? {})],
    socialProviders: socialProvidersOf(env.providers ?? {}),
    account: { accountLinking: accountLinkingOf(env) },
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
            await admit(db, env, { userId: user.id, email: user.email, name: user.name });
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
              await admit(db, env, { userId: user.id, email: user.email, name: user.name });
            }
          },
        },
      },
    },
  });
  // Better Auth starts initialising the moment it is constructed, and the
  // OAuth provider seeds its resource rows there, so the context is a promise
  // that touches the database before anyone has awaited it. This handler only
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
export function signInProviders(env: Pick<AuthEnv, "providers">): SignInProvider[] {
  const providers = env.providers ?? {};
  const offered: SignInProvider[] = [];
  if (configuredClient(providers.github))
    offered.push({ id: "github", label: "GitHub", kind: "social" });
  if (configuredClient(providers.google))
    offered.push({ id: "google", label: "Google", kind: "social" });
  if (configuredClient(providers.gitlab))
    offered.push({ id: "gitlab", label: "GitLab", kind: "social" });
  const oidc = configuredOidc(providers.oidc);
  if (oidc) offered.push({ id: OIDC_PROVIDER_ID, label: oidc.label, kind: "social" });
  return offered;
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
 * Google always do, GitLab through the `confirmed_at` its profile carries — so
 * naming them buys no case that works and costs the one refusal that matters:
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
 * `allowDifferentEmails: false`: a link is one address at both ends. Two
 * addresses are two Humans until deevy has a screen that says otherwise.
 */
export function accountLinkingOf(_env: Pick<AuthEnv, "providers">) {
  return {
    enabled: true,
    trustedProviders: [],
    allowDifferentEmails: false,
  };
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
  const gitlab = configuredClient(providers.gitlab);
  return {
    ...(github
      ? {
          github: {
            ...github,
            // The organizations a github_org allowlist rule matches are only
            // listable with this scope (docs/plans/m1.md).
            scope: ["read:org"],
          },
        }
      : {}),
    // Google's default scopes are all deevy asks for: the address and the
    // name, both of which arrive in the `id_token`. `hd` is deliberately
    // unset — a Google Workspace is an email domain, and who may join is an
    // `email_domain` rule in deevy's own UI, so there is one place to look
    // rather than two that can disagree (docs/plans/sign-in.md).
    ...(google ? { google } : {}),
    // GitLab hands `read_user` out by default, which is the profile; the
    // groups a gitlab_group allowlist rule matches are only listable with
    // `read_api`, the same bargain `read:org` strikes above. GitLab has no
    // narrower scope for a user's groups, so the sign-in's token can read the
    // API it can reach — it is stored by Better Auth, read on the join and
    // never again (docs/OPERATIONS.md).
    ...(gitlab
      ? {
          gitlab: {
            ...gitlab,
            issuer: gitlabIssuer(providers.gitlab),
            scope: ["read_api"],
            mapProfileToUser: gitlabUser,
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
 * Whether GitLab has proved the address it just handed over. Better Auth reads
 * `email_verified`, which is an OpenID Connect claim GitLab's `/api/v4/user`
 * does not carry: it says `confirmed_at`, the moment the address answered
 * GitLab's own confirmation mail. Without this mapping every GitLab sign-in
 * lands as an unverified `user` row, and `requireLocalEmailVerified` — the gate
 * one Human, one Member rests on (docs/plans/sign-in.md slice 3) — then refuses
 * that Human every later link, so a teammate whose first provider was GitLab
 * could never add a second one.
 *
 * A GitLab that does report the claim is believed first: a self-hosted instance
 * or a later release may say so directly, and what the provider states about an
 * address beats what deevy infers from a timestamp.
 */
function gitlabUser(profile: { email_verified?: boolean; confirmed_at?: string | null }) {
  return { emailVerified: profile.email_verified ?? Boolean(profile.confirmed_at) };
}

/** The GitLab instance this deployment signs in against. */
function gitlabIssuer(client: GitLabClient | undefined): string {
  return client?.issuer?.trim().replace(/\/+$/, "") || DEFAULT_GITLAB_ISSUER;
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

/** Where the MCP endpoint is mounted. RFC 8707 and RFC 9728 both build on it. */
export const MCP_PATH = "/mcp";
/**
 * Where the operation API is mounted, and the second protected resource this
 * server issues tokens for. `/api` and `/rpc` are two transports for one API,
 * so they share one resource identifier: the resource names what a token may
 * reach, not how it gets there.
 *
 * It is a separate resource from MCP rather than a widened one because that
 * separation is the whole point of RFC 8707. A Human who consents to some MCP
 * client is consenting to the tools deevy projects, not to the ninety-four
 * operations behind them, and a token minted for one is refused at the other
 * (principal.ts).
 */
export const API_PATH = "/api";

/**
 * Which protected resource a request is reaching, as a path under the issuer.
 * A union rather than a string, so a surface cannot invent an audience by
 * typo and quietly accept nothing.
 */
export type ResourcePath = typeof API_PATH | typeof MCP_PATH;

/** Where Better Auth's own routes are mounted, and so where `/jwks` lives. */
export const AUTH_BASE_PATH = "/api/auth";

/** The SPA route the OAuth provider sends a Human to for consent. */
export const CONSENT_PATH = "/consent";

/**
 * deevy as an OAuth 2.1 authorization server for a Human's own MCP client
 * (ADR-0007, docs/plans/m2.md). `mcp()` *is* the provider, so no separate
 * `oauthProvider` sits beside it, and `jwt()` supplies the signing keys the
 * access tokens and the JWKS come from.
 *
 * The issuer is pinned to the instance origin rather than left to default to
 * Better Auth's base path. RFC 8414 builds a metadata URL by inserting the
 * well-known segment after the issuer's host, so an issuer of `…/api/auth`
 * would publish the document at `/.well-known/oauth-authorization-server/api/auth`
 * and nowhere a client looking at the origin would find it.
 *
 * Nothing is enabled without a configured `baseURL`: a resource identifier is
 * an absolute URL (RFC 8707) and guessing it per request would mint tokens
 * bound to whatever host the caller sent (docs/OPERATIONS.md).
 *
 * Mirrored in packages/db/auth.generate.config.ts, which the schema generator
 * reads; only the plugin list shapes the schema, and `cimd()` adds no tables.
 */
export function oauthServerPlugins(env: AuthEnv) {
  const baseURL = env.baseURL?.replace(/\/+$/, "");
  if (!baseURL) return [];
  return [
    jwt({ jwt: { issuer: baseURL } }),
    mcp({
      loginPage: "/",
      consentPage: CONSENT_PATH,
      // RFC 8707: every token this server mints is bound to this audience, and
      // one minted for anything else is refused at /mcp (principal.ts).
      resource: `${baseURL}${MCP_PATH}`,
      // The API beside it. `mcp()` appends its own resource to this list, so
      // the server issues for both.
      resources: [`${baseURL}${API_PATH}`],
      // Allowed, deliberately not default. `clientRegistrationDefaultResources`
      // links a resource to every client that registers, which would have given
      // the whole operation API to any MCP client that asked for nothing — the
      // opposite of what the second resource is for. This way a client is
      // linked to the API only if it names it in its registration, so an MCP
      // client that does not ask holds a token for the tools and nothing else.
      clientRegistrationAllowedResources: [`${baseURL}${API_PATH}`],
      // MCP 2026-07-28 prefers a Client ID Metadata Document and deprecates
      // dynamic registration, but the clients that only speak DCR are the ones
      // deevy cannot ask to change, so both stay open.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
    cimd({
      fetchClientMetadataResource: env.fetchClientMetadataResource ?? fetchClientMetadataResource,
      // The revision pins CIMD draft-00, which the profile enforces on top of
      // the plugin's generic draft-02 validation.
      metadataProfile: "mcp-2026-07-28",
    }),
  ];
}

/** The Authorization bearer of a request, whatever kind of credential it is. */
export function bearerToken(headers: Headers | undefined): string | null {
  const [scheme, token] = (headers?.get("authorization") ?? "").split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/**
 * The bearer, only when it is a deevy API key. A Human MCP client's OAuth
 * access token arrives on the same header, and the plugin must not try to look
 * it up as a key.
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
async function admit(db: Db, env: AuthEnv, user: JoiningUser): Promise<void> {
  await bootstrapWorkspace(db, user, env);
  await joinWorkspace(db, user, joinPorts(db, env, user.userId));
}

/**
 * What a join can ask a provider about this sign-in, one port per provider
 * that has something to answer. Each dispatches on the account's `providerId`,
 * so a Human with both accounts linked is asked of whichever provider the rule
 * is about, and one with neither is simply not in the group.
 *
 * Every port is lazy: a `github_org` or `gitlab_group` rule is the only reason
 * to spend a round trip, and `joinWorkspace` skips them all when an email
 * domain already matched.
 */
/** How long a forge has to answer a question about a sign-in's memberships. */
const FORGE_TIMEOUT_MS = 5_000;

export function joinPorts(db: Db, env: AuthEnv, userId: string): JoinOptions {
  const token = async (providerId: string) => {
    const account = await db.query.account.findFirst({ where: { userId, providerId } });
    return account?.accessToken ?? null;
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
      // A join costs a teammate their Member and never their sign-in, which was
      // true of a forge that fails and not of one that is merely slow: this
      // runs inside a Better Auth hook, so a host that accepts the connection
      // and never answers held the sign-in open for as long as the runtime
      // allowed. The abort is caught where the ports are read, so a timed-out
      // question is a question with no answer (docs/plans/sign-in.md).
      signal: AbortSignal.timeout(FORGE_TIMEOUT_MS),
    });
    return res.ok ? ((await res.json()) as T) : null;
  };
  /**
   * Every page of a list, not the first one. Both forges page by default — 30
   * organizations, 20 groups — and a rule that names the one on page two
   * matched nothing, which looks exactly like a rule that did not match
   * (docs/plans/sign-in.md). `PAGE_CAP` bounds a sign-in's cost at five round
   * trips; a Human in more than five hundred groups is not the case to spend a
   * sixth on.
   */
  const getAll = async <T>(providerId: string, url: string, accept: string): Promise<T[]> => {
    const items: T[] = [];
    const separator = url.includes("?") ? "&" : "?";
    for (let page = 1; page <= PAGE_CAP; page++) {
      const batch = await get<T[]>(
        providerId,
        `${url}${separator}per_page=${PAGE_SIZE}&page=${page}`,
        accept,
      );
      // A page that failed is not the end of the list. Treating it as one
      // handed back a short list that looked complete, so a rule naming
      // something on the page the forge refused matched nothing and read
      // exactly like a rule that did not match. The throw lands where a failing
      // port already lands: no memberships, so no join.
      if (!batch) throw new Error(`${providerId} answered no page ${String(page)}`);
      if (batch.length === 0) break;
      items.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return items;
  };
  return {
    listOrgs: async () => {
      const orgs = await getAll<{ login: string }>(
        "github",
        "https://api.github.com/user/orgs",
        "application/vnd.github+json",
      );
      return orgs.map((org) => org.login);
    },
    listGroups: async () => {
      // Every group the sign-in is in at all: 10 is Guest, GitLab's lowest
      // membership. A rule says who may join deevy, not what they may do in
      // GitLab, so a Guest of the group the rule names is in the group.
      const groups = await getAll<{ full_path: string }>(
        "gitlab",
        `${gitlabIssuer(env.providers?.gitlab)}/api/v4/groups?min_access_level=10`,
        "application/json",
      );
      return groups.map((group) => group.full_path);
    },
    // Whichever account this sign-in has: `get` spends no round trip on a
    // provider the Human never signed in with, so asking GitHub first costs a
    // query rather than a request.
    login: async () => {
      const github = await get<{ login?: string }>(
        "github",
        "https://api.github.com/user",
        "application/vnd.github+json",
      );
      if (github?.login) return github.login;
      const gitlab = await get<{ username?: string }>(
        "gitlab",
        `${gitlabIssuer(env.providers?.gitlab)}/api/v4/user`,
        "application/json",
      );
      return gitlab?.username ?? null;
    },
  };
}

/** What one page of a forge's list asks for, and how many pages a join will read. */
const PAGE_SIZE = 100;
const PAGE_CAP = 5;

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
}

export interface JoinOptions {
  /**
   * What the provider calls this sign-in — a GitHub login, a GitLab username —
   * preferred over a slug of the name as the handle. Provider-neutral, because
   * a handle is deevy's and every provider hands out the same kind of thing.
   *
   * A port rather than a string, and asked only when a Member is actually
   * being created: the sign-in's own profile is a round trip, and `admit` runs
   * on every session as well as every user (docs/plans/sign-in.md).
   */
  login?: () => Promise<string | null>;
  /**
   * The GitHub organizations this sign-in belongs to, for `github_org` rules.
   * A port rather than a fetch so the rule can be decided without a network
   * call; production supplies the sign-in's access token (needs `read:org`).
   */
  listOrgs?: () => Promise<string[]>;
  /**
   * The GitLab groups this sign-in belongs to, as full paths
   * (`acme/platform`), for `gitlab_group` rules. A port for the same reason;
   * production reads them from the sign-in's own token (needs `read_api`).
   */
  listGroups?: () => Promise<string[]>;
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
  if (!(await matchesAllowlist(db, ws.id, user, options))) return;

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

async function matchesAllowlist(
  db: Db,
  workspaceId: string,
  user: JoiningUser,
  options: JoinOptions,
): Promise<boolean> {
  const domain = user.email.toLowerCase().split("@").at(-1) ?? "";
  const rules = await db
    .select()
    .from(allowlistRule)
    .where(eq(allowlistRule.workspaceId, workspaceId));
  if (rules.some((rule) => rule.kind === "email_domain" && rule.value === domain)) return true;

  // Each of these costs a round trip to a provider, so each is asked only when
  // a rule of its kind exists and no email domain matched.
  if (await matchesMemberships(rules, "github_org", options.listOrgs)) return true;
  return matchesMemberships(rules, "gitlab_group", options.listGroups);
}

/**
 * One rule kind decided against what a provider says this sign-in belongs to.
 * A port that is absent, that answers with nothing, or that fails is not a
 * match: a join deevy could not verify is a join that does not happen.
 *
 * A provider that is down therefore costs a Member their join and not their
 * sign-in — this runs inside a Better Auth database hook, where a thrown error
 * is a sign-in that fails — and the next sign-in asks again, because `admit`
 * runs from the session hook every time.
 */
async function matchesMemberships(
  rules: Array<{ kind: string; value: string }>,
  kind: string,
  list: (() => Promise<string[]>) | undefined,
): Promise<boolean> {
  const matching = rules.filter((rule) => rule.kind === kind);
  if (matching.length === 0 || !list) return false;
  const memberships = await list().catch(() => []);
  const held = new Set(memberships.map((value) => value.toLowerCase()));
  return matching.some((rule) => held.has(rule.value));
}
