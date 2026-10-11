import type { AuthProviders } from "./auth.ts";

/** The variables a deployment names its sign-in providers with, on every runtime. */
export interface ProviderVariables {
  GITHUB_CLIENT_ID?: string | undefined;
  GITHUB_CLIENT_SECRET?: string | undefined;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  GITLAB_CLIENT_ID?: string | undefined;
  GITLAB_CLIENT_SECRET?: string | undefined;
  GITLAB_ISSUER?: string | undefined;
  MICROSOFT_CLIENT_ID?: string | undefined;
  MICROSOFT_CLIENT_SECRET?: string | undefined;
  MICROSOFT_TENANT_ID?: string | undefined;
  LINEAR_CLIENT_ID?: string | undefined;
  LINEAR_CLIENT_SECRET?: string | undefined;
  SLACK_CLIENT_ID?: string | undefined;
  SLACK_CLIENT_SECRET?: string | undefined;
  ATLASSIAN_CLIENT_ID?: string | undefined;
  ATLASSIAN_CLIENT_SECRET?: string | undefined;
  DEEVY_OIDC_CLIENT_ID?: string | undefined;
  DEEVY_OIDC_CLIENT_SECRET?: string | undefined;
  DEEVY_OIDC_ISSUER?: string | undefined;
  DEEVY_OIDC_NAME?: string | undefined;
}

/**
 * Every sign-in provider a deployment configured, read the same way by every
 * entry — the image, the Worker and the many-Workspaces Worker — so one
 * variable means one thing wherever it is set (docs/OPERATIONS.md). A pair
 * left empty is a provider that is neither registered nor offered.
 */
export function providersFromEnv(env: ProviderVariables): AuthProviders {
  return {
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
    microsoft: {
      clientId: env.MICROSOFT_CLIENT_ID ?? "",
      clientSecret: env.MICROSOFT_CLIENT_SECRET ?? "",
      // `common` unless the operator narrows it: `organizations`, or one
      // tenant's id (docs/OPERATIONS.md).
      tenantId: env.MICROSOFT_TENANT_ID,
    },
    linear: {
      clientId: env.LINEAR_CLIENT_ID ?? "",
      clientSecret: env.LINEAR_CLIENT_SECRET ?? "",
    },
    slack: {
      clientId: env.SLACK_CLIENT_ID ?? "",
      clientSecret: env.SLACK_CLIENT_SECRET ?? "",
    },
    atlassian: {
      clientId: env.ATLASSIAN_CLIENT_ID ?? "",
      clientSecret: env.ATLASSIAN_CLIENT_SECRET ?? "",
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
}
