import { createDb, createQueueJobQueue, jobIn } from "@deevy/adapters/workers";
import type { QueueBatch } from "@deevy/adapters/workers";
import type { App } from "@deevy/core/app";
import {
  createApp,
  createAuth,
  deliverWebhook,
  runDueWork,
  signInProviders,
  type AuthEnv,
  type DueWorkLimits,
} from "@deevy/core";
import { socketModules } from "@deevy/sockets";
import type { WorkerBindings, WorkerEnv } from "./env.ts";
import { readWorkerEnv, workerAuthEnv } from "./env.ts";

/** Written by the build from package.json; see vite.config.ts. */
declare const __DEEVY_VERSION__: string | undefined;
const DEEVY_VERSION = typeof __DEEVY_VERSION__ === "string" ? __DEEVY_VERSION__ : undefined;

/**
 * One app per isolate, not one per request. `createApp` builds the oRPC
 * handlers, the OpenAPI document and the MCP server, none of which depend on
 * the request; `buildContext` is the only per-request work. Better Auth is
 * built here for the same reason and one more: its constructor touches the
 * database, and `principal.ts` caches a verified JWKS keyed by the `Auth`
 * object, so an instance per request would re-fetch the key set for every
 * token it verifies. The key is the binding set itself, so there is no global
 * to reset between tests and an isolate serving a second environment builds a
 * second app (docs/plans/m3.md).
 */
const apps = new WeakMap<WorkerBindings, Isolate>();

/** The app this isolate serves, and the initialisation it owes the next request. */
interface Isolate {
  app: App;
  /** The same D1 the app writes through, for work no request asked for. */
  db: ReturnType<typeof createDb>;
  /** The bindings, read once, so the Cron Trigger configures itself like the app. */
  env: WorkerEnv;
  /**
   * What this isolate handed Better Auth. Kept so the one thing that differs
   * between the two runtimes is assertable where it is decided rather than
   * where it is assembled: a test that only checked `workerAuthEnv`'s return
   * value would stay green through a refactor that inlined the object here and
   * lost the transport with it (docs/plans/m3.md slice 8).
   */
  authEnv: AuthEnv;
  /**
   * Better Auth starts initialising inside its constructor, and that touches
   * the database. workerd abandons any I/O still in flight when the request
   * that started it returns, so a `$context` left pending by the request that
   * built the app never settles and every later request that awaits it hangs
   * — silently, with no error to read. The request that builds the app
   * therefore finishes the initialisation too, and every later one awaits a
   * promise that has already settled, which is free and crosses no context.
   * A failed initialisation stays failed for the isolate, exactly as it does
   * on Node, and is reported by the handler that needed it. The smoke's
   * sign-in phase opens with a `/healthz` for this reason and no other: it
   * makes the request that builds the app one that needs no auth, so deleting
   * the await below hangs the sign-in that follows (apps/web/scripts/smoke-workers.ts).
   */
  ready: Promise<void>;
}

export function isolateFor(bindings: WorkerBindings): Isolate {
  const cached = apps.get(bindings);
  if (cached) return cached;
  const env = readWorkerEnv(bindings);
  const db = createDb(bindings.DB);
  // The Worker serves the SPA from the same origin, so the only cross-origin
  // caller is a browser on a separately deployed one.
  const origin = [env.webOrigin, env.baseURL].filter((o): o is string => Boolean(o));
  const authEnv = workerAuthEnv(env);
  const auth = createAuth({ db, env: authEnv });
  const isolate: Isolate = {
    app: createApp({
      version: DEEVY_VERSION,
      db,
      auth,
      origin,
      baseURL: env.baseURL,
      // Where a Human's browser finds this instance, when the SPA is somewhere
      // else: a Gate link and an invitation link are built on it, and the API's
      // own origin serves no page in the dev loop (docs/plans/sign-in.md).
      ...(env.webOrigin ? { webURL: env.webOrigin } : {}),
      secret: env.secret,
      // A stream ends before the platform ends it: one D1 query per poll
      // against a per-invocation cap makes a stream's life arithmetic, and a
      // stream that ends itself signs off with the cursor the next one resumes
      // from (docs/plans/m3.md slice 7).
      live: env.live,
      // The buttons the sign-in page draws, from the same entries Better Auth
      // was just registered with (docs/plans/sign-in.md).
      signInProviders: signInProviders(authEnv),
      // The tools this build can speak (ADR-0024). The stub is registered only
      // where the entry says it may be, which is never in production.
      // A Worker is never the deployment a stub belongs in.
      sockets: socketModules(),
      // Only when the account has Queues. Absent, `createApp` discards jobs
      // and every delivery waits for the next Cron pass, which is the whole
      // difference an optional binding makes (docs/plans/m3.md slice 9).
      ...(bindings.JOBS ? { jobs: createQueueJobQueue(bindings.JOBS) } : {}),
    }),
    db,
    env,
    authEnv,
    ready: auth.$context.then(
      () => undefined,
      () => undefined,
    ),
  };
  apps.set(bindings, isolate);
  return isolate;
}

/**
 * What Cloudflare hands a Cron Trigger, narrowed to what deevy uses. The types
 * are written out rather than imported from `@cloudflare/workers-types`
 * because `tsconfig.app.json` compiles this file beside the SPA, and pulling
 * the Workers globals in would put `caches` and `fetch` on the browser too.
 */
interface ScheduledContext {
  waitUntil(work: Promise<unknown>): void;
}

/**
 * Tighter than Node's on purpose. A Cron Trigger has a CPU budget and a
 * per-invocation D1 query cap, and it comes back on its own a minute later, so
 * one bounded pass is the whole strategy: `more: true` has meant "come back
 * rather than raise the limit" since M2, and here the thing that comes back is
 * the platform (docs/plans/m3.md). Twenty is also the chunk `work.ts` writes
 * Events in, so a full pass is one SELECT, one UPDATE and one INSERT.
 */
const cronLimits: DueWorkLimits = { maxPasses: 1, sweepLimit: 20, deliveryLimit: 10 };

export default {
  async fetch(request: Request, bindings: WorkerBindings): Promise<Response> {
    const isolate = isolateFor(bindings);
    await isolate.ready;
    return isolate.app.fetch(request);
  },

  /**
   * deevy's background work, once per trigger: the same `runDueWork` the Node
   * runner's timer calls, with the limits a trigger can afford. There is no
   * `Cron` port here on purpose — Cloudflare owns the schedule, and a port
   * handing back a stop function would be lying about who holds the timer.
   *
   * `ready` is awaited for the reason a request awaits it: whichever
   * invocation builds the isolate has to finish Better Auth's initialisation
   * before it returns, or workerd abandons the I/O and every later awaiter
   * hangs on a promise that never settles.
   */
  scheduled(_controller: unknown, bindings: WorkerBindings, ctx: ScheduledContext): void {
    const isolate = isolateFor(bindings);
    ctx.waitUntil(
      isolate.ready.then(() =>
        runDueWork({
          db: isolate.db,
          limits: {
            ...cronLimits,
            silenceMs: isolate.env.runStaleMinutes * 60_000,
            gateSilenceMs: isolate.env.gateReminderHours * 3_600_000,
          },
          // As in the request path: a link a Human clicks is built on the
          // SPA's origin when it has one (docs/plans/sign-in.md).
          ...((isolate.env.webOrigin ?? isolate.env.baseURL)
            ? { baseUrl: isolate.env.webOrigin ?? isolate.env.baseURL }
            : {}),
        }),
      ),
    );
  },

  /**
   * One delivery per message, on an account that has Queues (docs/plans/m3.md
   * slice 9). The message is a pointer to a durable row, so this handler adds
   * no behaviour the Cron path does not already have — it only arrives sooner.
   *
   * Queues are at-least-once, which is why the same message twice has to cost
   * one POST: `deliverWebhook` claims the row before it sends, and refuses to
   * claim one that already landed, so the second arrival makes no request at
   * all. Acked when the delivery landed, when it ran out of attempts, and when
   * there was nothing left to claim; retried only while another attempt is
   * still owed, and the row's own attempt count — not the queue's — decides
   * when `webhook.exhausted` is appended, exactly as it would in a sweep.
   */
  async queue(batch: QueueBatch, bindings: WorkerBindings): Promise<void> {
    const isolate = isolateFor(bindings);
    await isolate.ready;
    for (const message of batch.messages) {
      const job = jobIn(message.body);
      // A message this version cannot read will not become readable by being
      // sent again, so it is a permanent failure rather than a retry.
      if (!job) {
        message.ack();
        continue;
      }
      try {
        const sent = await deliverWebhook({ db: isolate.db, deliveryId: job.id });
        if (sent.delivered > 0 || sent.gaveUp > 0 || sent.scanned === 0) message.ack();
        else message.retry();
      } catch {
        // D1 refused, or the POST threw where `postWebhook` could not catch it.
        // The row is untouched, so the message is worth another look — and if
        // the queue gives up first, the next Cron pass still finds it.
        message.retry();
      }
    }
  },
};
