import type { AuthProviders } from "@deevy/core";

export interface ServerEnv {
  port: number;
  databasePath: string;
  migrationsFolder: string;
  baseURL?: string;
  secret?: string;
  /**
   * What a Socket's credentials are sealed with (`DEEVY_SECRET`, secrets.ts).
   * Separate from Better Auth's on purpose: rotating that one signs everybody
   * out, which an operator may do, and it must not also mean reconnecting
   * every tool. Losing this one does mean that, so it is backed up with the
   * volume (docs/OPERATIONS.md).
   */
  socketSecret?: string;
  /** Silence after which deevy asks a Socket rather than waiting to be told. */
  socketCatchupMinutes: number;
  /**
   * GitHub's REST root for a Socket that names none: a GitHub Enterprise
   * Server, or the acceptance walk's stand-in (`DEEVY_GITHUB_API`).
   */
  githubApi?: string;
  webOrigin?: string;
  /**
   * The sign-in providers this instance offers, one optional entry each. A
   * provider is configuration: what is set here is what `createAuth` registers
   * and what the sign-in page draws a button for (docs/plans/sign-in.md).
   */
  providers: AuthProviders;
  adminEmail?: string;
  workspaceName?: string;
  webDist?: string;
  /** Silence after which a Run is presumed stale (docs/plans/m2.md). */
  runStaleMinutes: number;
  /** How often the background runner sweeps for silent Runs. */
  sweepIntervalSeconds: number;
  gateReminderHours: number;
  /**
   * Replace every sign-in provider with the stub the acceptance walk signs
   * in through (apps/web/scripts/stub-oauth.js), so a developer needs no
   * account anywhere and the OAuth `code` is the email address. Development
   * only, by construction:
   * `readEnv` refuses it under `NODE_ENV=production` rather than ignoring it,
   * because a flag that is silently dropped is a flag somebody will one day
   * believe is on.
   */
  devStubOAuth: boolean;
}

/** A positive number from the environment, or the default when it is absent or nonsense. */
function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The client pair the stub signs in with. It answers whatever pair it is
 * handed — the OAuth `code` is the email address — so a stubbed instance needs
 * no credential anywhere, which is the whole point of the flag.
 */
const STUB_CLIENT = { clientId: "stub-client", clientSecret: "stub-secret" };

/**
 * Where a stubbed OpenID Connect provider publishes its discovery document.
 * Any host but loopback, which is deevy itself: the stub matches an issuer by
 * path, because it cannot know where an operator's IdP lives
 * (apps/web/scripts/stub-oauth.js).
 */
const STUB_OIDC_ISSUER = "https://idp.stub.test/realms/deevy";

/** Whether an entry has both halves of its pair, the way `signInProviders` asks. */
function hasPair(client: { clientId: string; clientSecret: string } | undefined): boolean {
  return Boolean(client?.clientId.trim() && client?.clientSecret.trim());
}

/**
 * Every provider deevy offers, standing in for the ones this environment left
 * unconfigured (docs/DEVELOPMENT.md, "Running without an OAuth App"). Half a
 * pair is not a provider, so without this a checkout of `.env.example` — whose
 * pairs are all empty — offers no button at all under `DEEVY_DEV_STUB_OAUTH=1`
 * and the stub has nothing to stand in for: the sign-in page says the
 * deployment has no provider configured, and the development form's sign-in
 * answers `PROVIDER_NOT_FOUND`.
 *
 * A pair the environment did set is kept, because a developer who is stubbing
 * a real client id wants their own client id in the authorization URL; only
 * the gaps are filled.
 */
export function stubbedProviders(providers: AuthProviders): AuthProviders {
  const oidc = providers.oidc;
  return {
    github: hasPair(providers.github) ? providers.github : { ...STUB_CLIENT },
    google: hasPair(providers.google) ? providers.google : { ...STUB_CLIENT },
    gitlab: hasPair(providers.gitlab)
      ? providers.gitlab
      : { ...STUB_CLIENT, issuer: providers.gitlab?.issuer },
    // An issuer is as load-bearing as the pair here: without one there is no
    // discovery document, so a stubbed OIDC entry gets a stubbed issuer too.
    oidc:
      hasPair(oidc) && oidc?.issuer.trim()
        ? oidc
        : {
            ...STUB_CLIENT,
            issuer: oidc?.issuer.trim() || STUB_OIDC_ISSUER,
            name: oidc?.name,
          },
  };
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const devStubOAuth = env.DEEVY_DEV_STUB_OAUTH === "1";
  if (devStubOAuth && env.NODE_ENV === "production") {
    throw new Error(
      "DEEVY_DEV_STUB_OAUTH replaces every sign-in provider and cannot be set in production",
    );
  }
  const providers: AuthProviders = {
    github: {
      clientId: env.GITHUB_CLIENT_ID ?? "",
      clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    },
    gitlab: {
      clientId: env.GITLAB_CLIENT_ID ?? "",
      clientSecret: env.GITLAB_CLIENT_SECRET ?? "",
      // gitlab.com unless the deployment names its own instance; every
      // GitLab endpoint deevy calls is built from it (docs/OPERATIONS.md).
      issuer: env.GITLAB_ISSUER,
    },
    // One generic OpenID Connect provider, discovered from its issuer. The
    // name is what the button says, so an operator calls their own IdP what
    // their teammates call it (docs/plans/sign-in.md).
    oidc: {
      clientId: env.DEEVY_OIDC_CLIENT_ID ?? "",
      clientSecret: env.DEEVY_OIDC_CLIENT_SECRET ?? "",
      issuer: env.DEEVY_OIDC_ISSUER ?? "",
      name: env.DEEVY_OIDC_NAME,
    },
  };
  return {
    // DEEVY_PORT first: tooling commonly injects a generic PORT meant for something else.
    port: Number(env.DEEVY_PORT ?? env.PORT ?? 3000),
    databasePath: env.DEEVY_DATABASE_PATH ?? "./data/deevy.sqlite",
    migrationsFolder: env.DEEVY_MIGRATIONS_DIR ?? new URL("./drizzle", import.meta.url).pathname,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    socketSecret: env.DEEVY_SECRET,
    socketCatchupMinutes: positive(env.DEEVY_SOCKET_CATCHUP_MINUTES, 30),
    githubApi: env.DEEVY_GITHUB_API,
    webOrigin: env.DEEVY_WEB_ORIGIN,
    // Under the flag every provider is the stub, including the ones this
    // environment configured no pair for: a developer with no OAuth App has
    // none of them, and that is who the flag is for.
    providers: devStubOAuth ? stubbedProviders(providers) : providers,
    adminEmail: env.DEEVY_ADMIN_EMAIL,
    workspaceName: env.DEEVY_WORKSPACE_NAME,
    webDist: env.DEEVY_WEB_DIST,
    runStaleMinutes: positive(env.DEEVY_RUN_STALE_MINUTES, 30),
    sweepIntervalSeconds: positive(env.DEEVY_SWEEP_INTERVAL_SECONDS, 60),
    gateReminderHours: positive(env.DEEVY_GATE_REMINDER_HOURS, 4),
    devStubOAuth,
  };
}
