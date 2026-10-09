import type { CloudflareEmailBinding } from "@deevy/adapters/workers";
import { providersFromEnv, type AuthProviders, type ProviderVariables } from "@deevy/core";
import type { EmailSetup } from "@deevy/core/email";
import { readEmailEnv } from "@deevy/email";

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
  /** Cloudflare Email Service, the platform's sender (docs/plans/email-channel.md). */
  EMAIL?: CloudflareEmailBinding;
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
  /** The platform's sender, by the variables every deevy reads (docs/OPERATIONS.md, "Email"). */
  DEEVY_EMAIL_SENDER?: string;
  DEEVY_EMAIL_FROM?: string;
  DEEVY_STREAM_SECONDS?: string;
  /** How often a Workspace's alarm runs its background work when nothing asks sooner. */
  DEEVY_HOSTED_PASS_SECONDS?: string;
  DEEVY_RUN_STALE_MINUTES?: string;
  DEEVY_GATE_REMINDER_HOURS?: string;
  DEEVY_SOCKET_CATCHUP_MINUTES?: string;
  DEEVY_GITHUB_API?: string;
  DEEVY_DEV_STUB_SOCKETS?: string;
  DEEVY_DEV_STUB_CONTAINERS?: string;
  DEEVY_DEV_STUB_EMAIL?: string;
}

/** The platform's configuration, read once per isolate. */
export interface HostedEnv {
  origin: string;
  masterSecret: string;
  jurisdiction: string | null;
  relaySecret: string;
  consoleAuthURL: string | null;
  providers: AuthProviders;
  email: EmailSetup | null;
  emailProblem: string | null;
  streamSeconds: number;
  passSeconds: number;
  runStaleMinutes: number;
  gateReminderHours: number;
  socketCatchupMinutes: number;
  githubApi: string | undefined;
  devStubSockets: boolean;
  devStubContainers: string | undefined;
  devStubEmail: boolean;
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Whether this Worker serves a machine's own loopback, which is the only place
 * the development stubs may be on: a hosted Workspace is a team's real work,
 * and a stub would send its email nowhere and invent its tools.
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
  const devStubEmail = bindings.DEEVY_DEV_STUB_EMAIL === "1";
  if ((devStubSockets || devStubEmail) && !loopback) {
    throw new Error(
      "The development stubs run only on a loopback origin, never for a hosted Workspace",
    );
  }
  // Every sender's variables by name, whichever the platform chose; the same
  // reader the other two entries use (packages/email/src/env.ts).
  const email = readEmailEnv(bindings as unknown as Record<string, string | undefined>, {
    devStub: devStubEmail,
  });
  return {
    origin,
    masterSecret,
    jurisdiction: bindings.DEEVY_HOSTED_JURISDICTION?.trim() || null,
    relaySecret,
    consoleAuthURL: bindings.DEEVY_HOSTED_CONSOLE_AUTH_URL?.trim().replace(/\/+$/, "") || null,
    providers: providersFromEnv(bindings),
    email: email.setup,
    emailProblem: email.problem,
    streamSeconds: positive(bindings.DEEVY_STREAM_SECONDS, 300),
    passSeconds: positive(bindings.DEEVY_HOSTED_PASS_SECONDS, 60),
    runStaleMinutes: positive(bindings.DEEVY_RUN_STALE_MINUTES, 30),
    gateReminderHours: positive(bindings.DEEVY_GATE_REMINDER_HOURS, 4),
    socketCatchupMinutes: positive(bindings.DEEVY_SOCKET_CATCHUP_MINUTES, 30),
    githubApi: bindings.DEEVY_GITHUB_API,
    devStubSockets,
    devStubContainers: bindings.DEEVY_DEV_STUB_CONTAINERS,
    devStubEmail,
  };
}
