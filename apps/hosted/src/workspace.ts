import { DurableObject } from "cloudflare:workers";
import { createCloudflareSender } from "@deevy/adapters/workers";
import {
  createAlarmJobQueue,
  createDurableDb,
  dumpDatabase,
  migrateDurable,
  type DurableDb,
  type DurableMigrationResult,
} from "@deevy/adapters/durable";
import {
  createApp,
  createAuth,
  emailsSince,
  invitationsSince,
  limitWindowStart,
  runDueWork,
  signInProviders,
  type App,
  type AuthEnv,
  type DueWorkLimits,
  type WorkspaceLimits,
} from "@deevy/core";
import { fetchClientMetadataResource } from "@deevy/core/cimd";
import type { EmailSenders } from "@deevy/core/email";
import { member, run, socket } from "@deevy/db";
import { migrations } from "@deevy/db/durable-migrations";
import { emailSenders } from "@deevy/email";
import { socketModules } from "@deevy/sockets";
import { count, eq, gte } from "drizzle-orm";
import { readHostedEnv, type HostedBindings, type HostedEnv } from "./env.ts";
import { workspaceSecret } from "./secrets.ts";

/** Written by the build from package.json (wrangler.jsonc `define`). */
declare const __DEEVY_VERSION__: string | undefined;
const VERSION = typeof __DEEVY_VERSION__ === "string" ? __DEEVY_VERSION__ : undefined;

/** Who a Workspace is, set by `Platform` and kept in its own storage. */
export interface WorkspaceConfig {
  key: string;
  slug: string;
  name: string;
  adminEmail: string;
  status: "active" | "suspended";
  createdAt: number;
  /**
   * Its own limits, where `Platform.configure` set them over the platform's
   * (`DEEVY_HOSTED_*_PER_DAY`). Absent from a Workspace provisioned before
   * there were any, which takes the platform's.
   */
  limits?: WorkspaceLimits;
}

/**
 * What `Platform.configure` may change. A limit set to null is forgotten, so
 * the Workspace takes the platform's again.
 */
export interface WorkspacePatch {
  name?: string;
  status?: WorkspaceConfig["status"];
  limits?: { [K in keyof WorkspaceLimits]?: number | null };
}

/** What a Workspace says about itself to the platform. */
export interface WorkspaceStatus {
  version: string | null;
  slug: string | null;
  status: WorkspaceConfig["status"] | "unprovisioned";
  migrations: DurableMigrationResult;
  /** The limits in force: its own where it has them, the platform's otherwise. */
  limits: Required<WorkspaceLimits> | null;
  /**
   * What it holds and what it did, for a console to show and later to meter.
   * Today is the last 24 hours, the window the limits count; a month is the
   * calendar month so far, in UTC.
   */
  counts: {
    humans: number;
    agents: number;
    sockets: number;
    invitationsToday: number;
    emailsToday: number;
    runsThisMonth: number;
  } | null;
}

/**
 * The background work an alarm may do. A Workspace's alarm is its own and costs
 * nobody else a query, so it has the Node runner's room — up to five passes
 * while each finds more — rather than a Cron Trigger's single pass.
 */
const passLimits: DueWorkLimits = {
  maxPasses: 5,
  sweepLimit: 100,
  deliveryLimit: 50,
  socketPageLimit: 25,
};
const CONFIG = "deevy:config";

/**
 * One hosted Workspace: its SQLite database, and deevy running beside it
 * (ADR-0028). The core is the one every deployment runs; what is the
 * object's own is where the database is, what wakes it, and who it is.
 *
 * It wakes for a request the router sent, for its alarm, or for the platform.
 * The constructor reads who it is and migrates; the app is built the first
 * time a request needs one, since an alarm needs only the database, the tools
 * and the senders. A failed migration is kept and answered as a 503 rather
 * than thrown, because a throw here resets the object and repeats on every
 * request after it.
 */
export class WorkspaceObject extends DurableObject<HostedBindings> {
  #hosted: HostedEnv;
  #db: DurableDb;
  #config: WorkspaceConfig | null = null;
  #migrations: DurableMigrationResult = { applied: [], error: null };
  #app: Promise<App> | null = null;

  constructor(ctx: DurableObjectState, env: HostedBindings) {
    super(ctx, env);
    this.#hosted = readHostedEnv(env);
    this.#db = createDurableDb(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      this.#config = ctx.storage.kv.get<WorkspaceConfig>(CONFIG) ?? null;
      if (this.#config) this.#migrations = migrateDurable(this.#db, migrations);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (!this.#config) return new Response("There is no Workspace here.", { status: 404 });
    if (this.#config.status === "suspended") {
      return new Response("This Workspace is suspended.", { status: 403 });
    }
    if (this.#migrations.error) {
      return new Response("This Workspace is being upgraded. Try again in a minute.", {
        status: 503,
        headers: { "retry-after": "60" },
      });
    }
    this.#app ??= this.#build(this.#config).catch((failure: unknown) => {
      this.#app = null;
      throw failure;
    });
    return (await this.#app).fetch(request);
  }

  /** The Workspace's background work, then the next alarm (replaces Cron and the JOBS queue). */
  override async alarm(): Promise<void> {
    const config = this.#config;
    if (!config || config.status !== "active" || this.#migrations.error) return;
    try {
      await runDueWork({
        db: this.#db,
        limits: {
          ...passLimits,
          silenceMs: this.#hosted.runStaleMinutes * 60_000,
          gateSilenceMs: this.#hosted.gateReminderHours * 3_600_000,
          catchupMs: this.#hosted.socketCatchupMinutes * 60_000,
        },
        baseUrl: this.#urlOf(config),
        sockets: this.#sockets(),
        socketSecret: await workspaceSecret(this.#hosted.masterSecret, config.key, "seal"),
        emailSenders: this.#senders(),
        email: this.#hosted.email,
        secret: await workspaceSecret(this.#hosted.masterSecret, config.key, "auth"),
        workspaceLimits: this.#limits(config),
      });
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + this.#hosted.passSeconds * 1_000);
    }
  }

  /** Who this Workspace is, written once by `Platform.provision`, then migrated. */
  async provision(input: Omit<WorkspaceConfig, "status" | "createdAt">): Promise<WorkspaceStatus> {
    if (this.#config && this.#config.key !== input.key) {
      throw new Error("This object already holds another Workspace");
    }
    this.#config = this.#config ?? { ...input, status: "active", createdAt: Date.now() };
    this.ctx.storage.kv.put(CONFIG, this.#config);
    this.#migrations = migrateDurable(this.#db, migrations);
    await this.ctx.storage.setAlarm(Date.now() + this.#hosted.passSeconds * 1_000);
    return this.status();
  }

  async status(): Promise<WorkspaceStatus> {
    const config = this.#config;
    return {
      version: VERSION ?? null,
      slug: config?.slug ?? null,
      status: config?.status ?? "unprovisioned",
      migrations: this.#migrations,
      limits: config ? this.#limits(config) : null,
      counts: config && !this.#migrations.error ? await this.#counts() : null,
    };
  }

  async configure(patch: WorkspacePatch): Promise<void> {
    if (!this.#config) throw new Error("This Workspace was never provisioned");
    const { limits: changed = {}, ...rest } = patch;
    for (const [name, value] of Object.entries(changed)) {
      if (!(name in this.#hosted.limits)) throw new Error(`There is no limit called ${name}`);
      if (value !== null && value !== undefined && !(Number.isInteger(value) && value >= 0)) {
        throw new Error(`${name} must be a whole number, nought or more`);
      }
    }
    const limits = Object.fromEntries(
      Object.entries({ ...this.#config.limits, ...changed }).filter(
        ([, value]) => value !== null && value !== undefined,
      ),
    ) as WorkspaceLimits;
    this.#config = { ...this.#config, ...rest, limits };
    this.ctx.storage.kv.put(CONFIG, this.#config);
    // The app was built with the old name and limits; the next request builds it again.
    this.#app = null;
  }

  /**
   * Pulled to the end without awaiting anything, which makes it one consistent
   * snapshot: nothing else runs in this object until it returns.
   */
  async dump(): Promise<string> {
    return [...dumpDatabase(this.ctx.storage)].join("");
  }

  /**
   * The Workspace as it was at `at`, from the 30 days of point-in-time
   * recovery every SQLite Durable Object keeps. The restore happens when the
   * object next starts, so it is asked to start again.
   */
  async restore(at: number): Promise<void> {
    const bookmark = await this.ctx.storage.getBookmarkForTime(at);
    await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
    this.ctx.abort("Restoring to an earlier point in time");
  }

  /** Everything, alarm included (`deleteAll` takes the alarm since compatibility date 2026-02-24). */
  async destroy(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.#config = null;
    this.#app = null;
  }

  #urlOf(config: WorkspaceConfig): string {
    return `${this.#hosted.origin}/${config.slug}`;
  }

  /** The platform's limits, with whatever this Workspace was given over them. */
  #limits(config: WorkspaceConfig): Required<WorkspaceLimits> {
    return { ...this.#hosted.limits, ...config.limits };
  }

  #sockets() {
    return socketModules({
      ...(this.#hosted.githubApi ? { githubApiBase: this.#hosted.githubApi } : {}),
      ...(this.#hosted.devStubSockets
        ? {
            devStub: true,
            ...(this.#hosted.devStubContainers
              ? { devStubContainers: this.#hosted.devStubContainers }
              : {}),
          }
        : {}),
    });
  }

  #senders(): EmailSenders {
    const binding = this.env.EMAIL;
    return {
      ...emailSenders({ devStub: this.#hosted.devStubEmail }),
      ...(binding ? { cloudflare: () => createCloudflareSender(binding) } : {}),
    };
  }

  async #counts(): Promise<WorkspaceStatus["counts"]> {
    const [humans] = await this.#db
      .select({ n: count() })
      .from(member)
      .where(eq(member.kind, "human"));
    const [agents] = await this.#db
      .select({ n: count() })
      .from(member)
      .where(eq(member.kind, "agent"));
    const [sockets] = await this.#db.select({ n: count() }).from(socket);
    // Each a range on an index of its own (limits.ts, `run_createdAt_idx`).
    const now = new Date();
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [runs] = await this.#db.select({ n: count() }).from(run).where(gte(run.createdAt, month));
    // Nobody has signed in yet, so there is no Workspace row to have done anything.
    const workspace = await this.#db.query.workspace.findFirst({ columns: { id: true } });
    const since = limitWindowStart(now);
    return {
      humans: humans?.n ?? 0,
      agents: agents?.n ?? 0,
      sockets: sockets?.n ?? 0,
      invitationsToday: workspace ? await invitationsSince(this.#db, workspace.id, since) : 0,
      emailsToday: workspace ? await emailsSince(this.#db, workspace.id, since) : 0,
      runsThisMonth: runs?.n ?? 0,
    };
  }

  async #build(config: WorkspaceConfig): Promise<App> {
    const baseURL = this.#urlOf(config);
    const secret = await workspaceSecret(this.#hosted.masterSecret, config.key, "auth");
    const identity: AuthEnv = {
      baseURL,
      secret,
      trustedOrigins: [this.#hosted.origin],
      providers: this.#hosted.providers,
      adminEmail: config.adminEmail,
      workspaceName: config.name,
      // Every Workspace signs in through the relay this Worker is, at /auth (ADR-0030).
      signInRelay: { url: `${this.#hosted.origin}/auth`, secret: this.#hosted.relaySecret },
      fetchClientMetadataResource,
    };
    const auth = createAuth({ db: this.#db, env: identity });
    await auth.$context;
    return createApp({
      ...(VERSION ? { version: VERSION } : {}),
      db: this.#db,
      auth,
      origin: [this.#hosted.origin],
      baseURL,
      secret,
      // A stream reads this object's own SQLite, which costs no query budget,
      // and ends after minutes so a forgotten tab does not keep it awake.
      live: { pollMs: 1_000, maxDurationMs: this.#hosted.streamSeconds * 1_000 },
      // Every Workspace here mails through one sender whose quota and
      // reputation are all of theirs, so each is held to its day's share.
      limits: this.#limits(config),
      signInProviders: signInProviders(identity),
      sockets: this.#sockets(),
      socketSecret: await workspaceSecret(this.#hosted.masterSecret, config.key, "seal"),
      emailSenders: this.#senders(),
      email: this.#hosted.email,
      ...(this.#hosted.emailProblem ? { emailProblem: this.#hosted.emailProblem } : {}),
      // What a write owes goes out on this object's alarm, set to now.
      jobs: createAlarmJobQueue(this.ctx.storage),
      onError: (error) => console.error(`[${config.slug}]`, error),
    });
  }
}
