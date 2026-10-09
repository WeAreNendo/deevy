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
  onEventAppended,
  runDueWork,
  signInProviders,
  type App,
  type AuthEnv,
  type DueWorkLimits,
  type WorkspaceLimits,
  type LiveReader,
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

/** Written into the bundle by the build, from package.json (scripts/build.ts). */
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
  /**
   * When this object last woke, in epoch milliseconds: it is billed from then
   * while it stays awake, and an object that hibernates between Events with
   * its tabs open wakes again for each one (ADR-0032). Asking wakes it too, so
   * a Workspace that was asleep says "just now".
   */
  awakeSince: number;
  /** How many tabs hold a socket here. */
  openTabs: number;
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
 * What an open tab's socket remembers through hibernation (ADR-0032): whose
 * it is, when their session ends, and the last seq it was told. Kept on the
 * socket rather than in the object, because the object forgets everything
 * each time it sleeps and the socket does not.
 */
interface LiveAttachment {
  memberId: string;
  expiresAt: number;
  seq: number;
}

/** How long appends are gathered before one push, so a burst is one message. */
const PUSH_GATHER_MS = 25;

/** Close codes of deevy's own (4000–4999): why the object let a socket go. */
const CLOSED = {
  sessionEnded: [4401, "The session ended"],
  suspended: [4403, "This Workspace is suspended"],
  gone: [4404, "This Workspace is gone"],
} as const;

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
 *
 * An open tab holds a hibernatable WebSocket here rather than a stream
 * (ADR-0032): between Events the object sleeps with the sockets still open,
 * and when one is appended — always while it is awake, since the write
 * happened in it — it tells each socket the new seq. The tab reads what
 * changed through the operations, so the socket carries no authority.
 */
export class WorkspaceObject extends DurableObject<HostedBindings> {
  #hosted: HostedEnv;
  #db: DurableDb;
  #config: WorkspaceConfig | null = null;
  #migrations: DurableMigrationResult = { applied: [], error: null };
  #app: Promise<App> | null = null;
  #pushTo = 0;
  #gathering = false;
  #awakeSince = Date.now();

  constructor(ctx: DurableObjectState, env: HostedBindings) {
    super(ctx, env);
    this.#hosted = readHostedEnv(env);
    this.#db = createDurableDb(ctx.storage);
    // Every append in this Workspace goes through this handle, whoever made
    // it: a request, a tool's delivery, a sign-in, the alarm.
    onEventAppended(this.#db, (event) => this.#appended(event.seq));
    // A tab's keepalive is answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
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

  /** An open tab says nothing but its keepalive, which the runtime answers (constructor). */
  override webSocketMessage(): void {}

  /** The tab went away; answer its close, which a newer runtime has already done. */
  override webSocketClose(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // Already closed, or a code (1005, 1006) that is only ever received.
    }
  }

  override webSocketError(): void {}

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
      awakeSince: this.#awakeSince,
      openTabs: this.ctx.getWebSockets().length,
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
    // A suspended Workspace answers nobody, its open tabs included.
    if (this.#config.status === "suspended") this.#closeSockets(CLOSED.suspended);
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
    this.#closeSockets(CLOSED.gone);
    await this.ctx.storage.deleteAll();
    this.#config = null;
    this.#app = null;
  }

  /**
   * An open tab, admitted by the core under `events.subscribe`'s rule
   * (`/api/live`). Accepted through the hibernation API, so the socket stays
   * open while the object sleeps, and told the head of the log at once: a tab
   * coming back from hidden reads what it missed from there.
   */
  #accept(reader: LiveReader): Response {
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [reader.memberId]);
    const attachment: LiveAttachment = {
      memberId: reader.memberId,
      expiresAt: reader.expiresAt,
      seq: reader.head,
    };
    server.serializeAttachment(attachment);
    server.send(JSON.stringify({ seq: reader.head }));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The log grew; a burst of appends is gathered into one push. */
  #appended(seq: number): void {
    if (this.ctx.getWebSockets().length === 0) return;
    this.#pushTo = Math.max(this.#pushTo, seq);
    if (this.#gathering) return;
    this.#gathering = true;
    setTimeout(() => {
      this.#gathering = false;
      this.#push(this.#pushTo);
    }, PUSH_GATHER_MS);
  }

  /**
   * Tells every open tab the log reached `seq`. A number and nothing else: the
   * tab reads the Events through `events.list` with its own session, so what a
   * Member may not see is never sent to them. A socket whose session has ended
   * is closed instead; the tab opens another, and is refused if it is over.
   */
  #push(seq: number): void {
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const reader = socket.deserializeAttachment() as LiveAttachment | null;
      if (!reader) continue;
      try {
        if (reader.expiresAt <= now) {
          socket.close(...CLOSED.sessionEnded);
          continue;
        }
        if (reader.seq >= seq) continue;
        socket.send(JSON.stringify({ seq }));
        socket.serializeAttachment({ ...reader, seq } satisfies LiveAttachment);
      } catch {
        // A socket closing as this ran; its close handler tidies up.
      }
    }
  }

  #closeSockets([code, reason]: readonly [number, string]): void {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(code, reason);
      } catch {
        // Already closing.
      }
    }
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
      // and ends after minutes so a forgotten tab does not keep it awake. It
      // is the fallback: a tab here opens the socket below (ADR-0032).
      live: { pollMs: 1_000, maxDurationMs: this.#hosted.streamSeconds * 1_000 },
      // Every Workspace here mails through one sender whose quota and
      // reputation are all of theirs, so each is held to its day's share.
      limits: this.#limits(config),
      liveSocket: { accept: (_request, reader) => this.#accept(reader) },
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
