import { runDueWork, type Cron, type DueWorkLimits, type SocketModules } from "@deevy/core";
import type { Db } from "@deevy/db";

/**
 * deevy's background work, on the Node deployment.
 *
 * What it does is `runDueWork` in `packages/core/src/work.ts`, which the
 * Cloudflare Worker's Cron Trigger calls too. What is left here is everything
 * only a long-lived process has: the timer, the guarantee that ticks do not
 * overlap, and a stop that waits for the pass in flight so the database is not
 * closed under it (apps/server/src/index.ts).
 *
 * It lives beside the listener rather than in `createApp` on purpose:
 * `apps/web/src/worker.ts` builds one app per isolate, and a schedule started
 * inside it would be a timer nobody owns.
 */

export interface RunnerOptions {
  db: Db;
  /** The schedule. Node passes `createTimerCron()`. */
  cron: Cron;
  /** Silence after which a Run is presumed stale. `DEEVY_RUN_STALE_MINUTES`. */
  staleMinutes?: number;
  /** Hours a Gate may sit undecided before its approvers are asked again. */
  gateReminderHours?: number;
  /** How often the sweep runs. `DEEVY_SWEEP_INTERVAL_SECONDS`, and Node's alone. */
  sweepIntervalSeconds?: number;
  /** Runs one sweep pass may move. */
  sweepLimit?: number;
  /** Passes one tick may take before it leaves the rest for the next tick. */
  maxPassesPerTick?: number;
  /**
   * The public origin of this instance, so a Slack message links back to the
   * Issue it is about. `BETTER_AUTH_URL`.
   */
  baseUrl?: string;
  /** Messages to a Channel one delivery pass may send. */
  deliveryLimit?: number;
  /**
   * The tools this build can speak, so the pass can ask one what changed
   * (ADR-0024). This is what keeps an instance no tool can reach working.
   */
  sockets?: SocketModules;
  /** What a Socket's credentials are sealed with. */
  socketSecret?: string;
  /** Silence after which a Socket is asked rather than waited on. */
  socketCatchupMinutes?: number;
}

export interface Runner {
  /** Ends the schedule and waits for the pass in flight. */
  stop(): Promise<void>;
}

export function startRunner({
  db,
  cron,
  staleMinutes = 30,
  gateReminderHours = 4,
  sweepIntervalSeconds = 60,
  sweepLimit,
  maxPassesPerTick = 5,
  baseUrl,
  deliveryLimit,
  sockets,
  socketSecret,
  socketCatchupMinutes,
}: RunnerOptions): Runner {
  const limits: DueWorkLimits = {
    silenceMs: staleMinutes * 60_000,
    gateSilenceMs: gateReminderHours * 3_600_000,
    maxPasses: maxPassesPerTick,
    ...(sweepLimit === undefined ? {} : { sweepLimit }),
    ...(deliveryLimit === undefined ? {} : { deliveryLimit }),
    ...(socketCatchupMinutes === undefined ? {} : { catchupMs: socketCatchupMinutes * 60_000 }),
  };

  let inFlight: Promise<unknown> = Promise.resolve();
  const stopSchedule = cron.every(sweepIntervalSeconds, async (signal) => {
    // A long-lived process drains: it goes again while a pass says there is
    // more, up to `maxPasses`. The Worker asks for one pass instead, because
    // the thing that comes back there is the platform (docs/plans/m3.md).
    inFlight = runDueWork({
      db,
      limits,
      signal,
      ...(baseUrl ? { baseUrl } : {}),
      ...(sockets ? { sockets } : {}),
      ...(socketSecret ? { socketSecret } : {}),
    });
    await inFlight;
  });

  return {
    async stop() {
      stopSchedule();
      // The cron already reported whatever went wrong; shutting down is not
      // the moment to fail on it.
      await inFlight.catch(() => {});
    },
  };
}
