import type { AuthEnv, AuthProviders, LiveOptions } from "@deevy/core";
import { fetchClientMetadataResource } from "@deevy/core/cimd";
import type { createDb, QueueProducer } from "@deevy/adapters/workers";

/**
 * How often a stream on Workers looks for new Events. Slower than Node's
 * second on purpose: each poll is one D1 query, and D1 caps the queries one
 * invocation may run, so doubling the interval doubles a stream's life for a
 * second of latency on a board nobody is watching that closely
 * (docs/plans/m3.md slice 7).
 */
export const STREAM_POLL_MS = 2000;

/**
 * How long a stream lives before ending itself, when no binding says
 * otherwise. Thirty polls, against a per-invocation cap of fifty queries that
 * a signed-in request has already spent a handful of.
 */
const defaultStreamSeconds = 60;

/**
 * What the platform hands the Worker: the D1 binding, plus the vars and
 * secrets `wrangler secret put` and `.dev.vars` supply. The names are the ones
 * `apps/server/src/env.ts` reads from the environment, so one variable
 * configures deevy on either runtime (docs/OPERATIONS.md).
 */
/** What a Durable Object namespace is, narrowed to what routing a room needs. */
export interface DurableObjectBinding {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}
type DurableObjectId = { toString(): string };

export interface WorkerBindings {
  DB: Parameters<typeof createDb>[0];
  /**
   * The Queue a delivery is nudged on, when this account has Queues. Optional
   * on purpose and absent from the committed `wrangler.jsonc`: Queues are a
   * paid feature and M3's definition of done is a free account, so a deploy
   * must not fail on a queue it is not allowed to create. Present, a delivery
   * goes out when it is written; absent, the Cron Trigger finds the same row a
   * beat later (docs/OPERATIONS.md, docs/plans/m3.md slice 9).
   */
  JOBS?: QueueProducer;
  /**
   * One Durable Object per live Document (ADR-0021). Optional for the same
   * reason `JOBS` is: Durable Objects are a paid feature, and a deployment
   * without them still serves every Document the way it did before — read,
   * write, and a save refused rather than landing on somebody else's
   * (docs/OPERATIONS.md).
   */
  ROOMS?: DurableObjectBinding;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  DEEVY_WEB_ORIGIN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITLAB_CLIENT_ID?: string;
  GITLAB_CLIENT_SECRET?: string;
  GITLAB_ISSUER?: string;
  DEEVY_OIDC_ISSUER?: string;
  DEEVY_OIDC_CLIENT_ID?: string;
  DEEVY_OIDC_CLIENT_SECRET?: string;
  DEEVY_OIDC_NAME?: string;
  DEEVY_ADMIN_EMAIL?: string;
  DEEVY_WORKSPACE_NAME?: string;
  DEEVY_RUN_STALE_MINUTES?: string;
  DEEVY_GATE_REMINDER_HOURS?: string;
  DEEVY_STREAM_SECONDS?: string;
}

/**
 * `ServerEnv` in `apps/server/src/env.ts` minus what only a filesystem has —
 * no port, no database file, no migrations folder, no built SPA — and minus
 * `DEEVY_SWEEP_INTERVAL_SECONDS`, because on Workers the schedule belongs to
 * `triggers.crons` in `wrangler.jsonc` and not to deevy (docs/OPERATIONS.md).
 * Everything left keeps its name and its default, so the two entries visibly
 * configure one app.
 */
export interface WorkerEnv {
  baseURL?: string;
  secret?: string;
  webOrigin?: string;
  /**
   * The sign-in providers this instance offers, one optional entry each, read
   * from the same names `apps/server/src/env.ts` reads (docs/plans/sign-in.md).
   */
  providers: AuthProviders;
  adminEmail?: string;
  workspaceName?: string;
  /** Silence after which a Run is presumed stale (docs/plans/m2.md). */
  runStaleMinutes: number;
  /** Hours a Gate may sit undecided before its approvers are asked again. */
  gateReminderHours: number;
  /**
   * What this runtime allows an Event stream. Workers-only: on Node the stream
   * lives as long as the request, and `apps/server` passes nothing
   * (docs/plans/m3.md slice 7).
   */
  live: LiveOptions;
}

/** A positive number from a binding, or the default when it is absent or nonsense. */
function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The Worker's configuration, read once per isolate from the bindings the
 * request carried. Nothing here reads `process.env`, which does not exist on
 * workerd (docs/plans/m3.md).
 */
export function readWorkerEnv(env: WorkerBindings): WorkerEnv {
  return {
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    webOrigin: env.DEEVY_WEB_ORIGIN,
    providers: {
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
        issuer: env.GITLAB_ISSUER,
      },
      // The generic OpenID Connect entry: the pair, the issuer everything else
      // is discovered from, and what the button says (docs/plans/sign-in.md).
      oidc: {
        clientId: env.DEEVY_OIDC_CLIENT_ID ?? "",
        clientSecret: env.DEEVY_OIDC_CLIENT_SECRET ?? "",
        issuer: env.DEEVY_OIDC_ISSUER ?? "",
        name: env.DEEVY_OIDC_NAME,
      },
    },
    adminEmail: env.DEEVY_ADMIN_EMAIL,
    workspaceName: env.DEEVY_WORKSPACE_NAME,
    runStaleMinutes: positive(env.DEEVY_RUN_STALE_MINUTES, 30),
    gateReminderHours: positive(env.DEEVY_GATE_REMINDER_HOURS, 4),
    live: {
      pollMs: STREAM_POLL_MS,
      maxDurationMs: positive(env.DEEVY_STREAM_SECONDS, defaultStreamSeconds) * 1000,
    },
  };
}

/**
 * The identity configuration this entry hands Better Auth, beside
 * `apps/server`'s `authEnv` and different in exactly one thing. Node resolves
 * a Client ID Metadata Document's name and connects to the address it
 * checked; workerd has no primitive that pins an address while keeping the
 * name for SNI and certificate validation, so the Worker takes the core's
 * transport — a shape check with a DNS-over-HTTPS pre-resolution in front of
 * it — and the residual race is written down instead (docs/OPERATIONS.md).
 */
export function workerAuthEnv(env: WorkerEnv): AuthEnv {
  return {
    baseURL: env.baseURL,
    secret: env.secret,
    trustedOrigins: [env.webOrigin, env.baseURL].filter((o): o is string => Boolean(o)),
    providers: env.providers,
    adminEmail: env.adminEmail,
    workspaceName: env.workspaceName,
    fetchClientMetadataResource,
  };
}
