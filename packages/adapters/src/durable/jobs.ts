/**
 * The `JobQueue` port of `packages/core/src/jobs.ts` inside a Durable Object
 * (ADR-0028). A hosted Workspace has no Queue and no Cron Trigger: its alarm
 * is the sweep, running `runDueWork` and setting the next alarm. A job is a
 * pointer to a durable row the sweep finds anyway, so handing one over only
 * has to bring the sweep forward — the alarm is set to now — and an alarm is
 * durable and retried, which a queue message on a free account was not.
 *
 * Nothing here imports `@deevy/core`, for the reason `../workers/queue.ts`
 * gives; the entry that hands this to the core is where the compiler checks it.
 */

/**
 * A job as the port describes one: a pointer to a durable row, never a
 * payload. Its kind is not read here, since every kind is found by the same
 * sweep, so it is any string and a kind the port gains later needs nothing.
 */
export interface AlarmJob {
  kind: string;
  /** The durable row this job is about. */
  id: string;
  /** Earliest it should be picked up. The sweep reads the row's own time, so this is a hint. */
  delaySeconds?: number;
}

/** The part of a Durable Object's storage that holds its one alarm. */
export interface AlarmStorage {
  /** When the alarm is set for, in epoch milliseconds, or null when none is. */
  getAlarm(): Promise<number | null>;
  /** Sets it, replacing any alarm already set. A time in the past runs it at once. */
  setAlarm(scheduledTime: number): Promise<void>;
}

export interface AlarmJobQueueOptions {
  /** The clock, for tests. */
  now?: () => number;
}

/**
 * A job queue whose `enqueue` brings the object's alarm forward to when the job
 * is due — now, unless the job says to wait — and never pushes one back: an
 * alarm already set earlier stays. It neither throws nor rejects, because the
 * port says so: it runs in the tail of a request that has already written the
 * row, and the object's next alarm finds that row whatever happens here.
 */
export function createAlarmJobQueue(
  storage: AlarmStorage,
  { now = Date.now }: AlarmJobQueueOptions = {},
): { enqueue(job: AlarmJob): Promise<void> } {
  return {
    async enqueue(job) {
      try {
        const due = now() + Math.max(0, job.delaySeconds ?? 0) * 1000;
        const set = await storage.getAlarm();
        if (set !== null && set <= due) return;
        await storage.setAlarm(due);
      } catch {
        // The row is the record and this was only a hint about when to look at
        // it, so the next alarm still finds exactly what the write left.
      }
    },
  };
}
