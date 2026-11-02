import {
  providersFromEnv,
  type AuthProviders,
  type ProviderVariables,
  type WorkspaceLimits,
} from "@deevy/core";
import type { Meter } from "./meter.ts";

/**
 * What the many-Workspaces Worker is bound to (wrangler.jsonc). The platform's
 * half of every Workspace's configuration — the same for all of them — is
 * here; each Workspace's own half lives in its object (docs/plans/hosted.md,
 * "Configuration, in three layers").
 */
export interface HostedBindings extends ProviderVariables {
  /** One SQLite Durable Object per Workspace (ADR-0028). */
  WORKSPACES: DurableObjectNamespace;
  /** Slug → the object a Workspace lives in, written by `Platform` only. */
  DIRECTORY: KVNamespace;
  /** The SPA every Workspace serves, built by apps/web. */
  ASSETS: Fetcher;
  /** The console, behind its own paths of the host, when the platform has one. */
  CONSOLE?: Fetcher;
  /** Workers Analytics Engine: a data point per request, by Workspace (meter.ts). Optional. */
  ANALYTICS?: Meter;
  /** The Worker version serving this request (`version_metadata`): a random id under `wrangler dev`, absent where nothing binds it (unit tests). */
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string };
  /** Where every Workspace lives: `https://app.deevy.dev`, each under `/<slug>`. */
  DEEVY_HOSTED_ORIGIN?: string;
  /** What every Workspace's secrets are derived from (secrets.ts). Never a Workspace's. */
  DEEVY_HOSTED_MASTER_SECRET?: string;
  /** Where each Workspace's object is created: `eu` (ADR-0028). Fixed at creation. */
  DEEVY_HOSTED_JURISDICTION?: string;
  /** The sign-in relay's shared secret; the relay is this Worker, at `/auth` (ADR-0030). */
  DEEVY_SIGN_IN_RELAY_SECRET?: string;
  /**
   * The console's own Better Auth URL, when it signs in through the relay too,
   * such as `https://app.deevy.dev/console/api/auth`: the one URL besides a
   * Workspace's the relay sends a browser back to.
   */
  DEEVY_HOSTED_CONSOLE_AUTH_URL?: string;
  DEEVY_STREAM_SECONDS?: string;
  /** How often a Workspace's alarm runs its background work when nothing asks sooner. */
  DEEVY_HOSTED_PASS_SECONDS?: string;
  /**
   * What every Workspace may do in a day unless `Platform.configure` set its
   * own: invitations made.
   */
  DEEVY_HOSTED_INVITATIONS_PER_DAY?: string;
  DEEVY_RUN_STALE_MINUTES?: string;
  DEEVY_GITHUB_API?: string;
  DEEVY_DEV_STUB_SOCKETS?: string;
  DEEVY_DEV_STUB_CONTAINERS?: string;
}

/** The platform's configuration, read once per isolate. */
export interface HostedEnv {
  origin: string;
  masterSecret: string;
  jurisdiction: string | null;
  relaySecret: string;
  consoleAuthURL: string | null;
  providers: AuthProviders;
  streamSeconds: number;
  passSeconds: number;
  runStaleMinutes: number;
  githubApi: string | undefined;
  devStubSockets: boolean;
  devStubContainers: string | undefined;
  /** Every Workspace's limits, before its own configuration says otherwise. */
  limits: Required<WorkspaceLimits>;
}

/** The limits a platform that says nothing gets: room for a team, not for a mailing list. */
export const defaultHostedLimits: Required<WorkspaceLimits> = {
  invitationsPerDay: 50,
};

/**
 * The limits a Workspace was given of its own, as far as the platform still
 * has them. One stored before a limit was retired — `emailsPerDay`, until
 * deevy stopped sending email — is dropped as it is read, rather than
 * reported, or written back on the next `Platform.configure`, forever.
 */
export function ownLimits(
  platform: Required<WorkspaceLimits>,
  stored: object | undefined,
): WorkspaceLimits {
  return Object.fromEntries(
    Object.entries(stored ?? {}).filter(
      ([name, value]) => name in platform && typeof value === "number",
    ),
  ) as WorkspaceLimits;
}

/** A whole number, nought included: a limit of nought turns the thing off. */
function whole(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Whether this Worker serves a machine's own loopback, which is the only place
 * the development stubs may be on: a hosted Workspace is a team's real work,
 * and a stub would invent its tools.
 */
function isLoopback(origin: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * The platform's half, or what is missing from it. Nothing here is optional
 * in production: a hosted Workspace with no origin has no URL, one with no
 * master secret could seal nothing, and one with no relay secret could not
 * sign anybody in.
 */
export function readHostedEnv(bindings: HostedBindings): HostedEnv {
  const origin = bindings.DEEVY_HOSTED_ORIGIN?.trim().replace(/\/+$/, "") ?? "";
  if (!/^https?:\/\/[^/]+$/.test(origin)) {
    throw new Error("DEEVY_HOSTED_ORIGIN must be an origin, such as https://app.deevy.dev");
  }
  const masterSecret = bindings.DEEVY_HOSTED_MASTER_SECRET ?? "";
  if (masterSecret.length < 32) {
    throw new Error("DEEVY_HOSTED_MASTER_SECRET must be at least 32 random characters");
  }
  const relaySecret = bindings.DEEVY_SIGN_IN_RELAY_SECRET ?? "";
  if (relaySecret.length < 32) {
    throw new Error("DEEVY_SIGN_IN_RELAY_SECRET must be at least 32 random characters");
  }
  const loopback = isLoopback(origin);
  const devStubSockets = bindings.DEEVY_DEV_STUB_SOCKETS === "1";
  if (devStubSockets && !loopback) {
    throw new Error(
      "The development stubs run only on a loopback origin, never for a hosted Workspace",
    );
  }
  return {
    origin,
    masterSecret,
    jurisdiction: bindings.DEEVY_HOSTED_JURISDICTION?.trim() || null,
    relaySecret,
    consoleAuthURL: bindings.DEEVY_HOSTED_CONSOLE_AUTH_URL?.trim().replace(/\/+$/, "") || null,
    providers: providersFromEnv(bindings),
    streamSeconds: positive(bindings.DEEVY_STREAM_SECONDS, 300),
    passSeconds: positive(bindings.DEEVY_HOSTED_PASS_SECONDS, 60),
    runStaleMinutes: positive(bindings.DEEVY_RUN_STALE_MINUTES, 30),
    githubApi: bindings.DEEVY_GITHUB_API,
    devStubSockets,
    devStubContainers: bindings.DEEVY_DEV_STUB_CONTAINERS,
    limits: {
      invitationsPerDay: whole(
        bindings.DEEVY_HOSTED_INVITATIONS_PER_DAY,
        defaultHostedLimits.invitationsPerDay,
      ),
    },
  };
}
