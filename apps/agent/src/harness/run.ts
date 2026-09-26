import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import type { Config } from "../config.ts";
import { instructionsPath } from "../instructions.ts";
import type { Session, SessionEvent, SessionInput, Usage } from "../session.ts";
import { handOver, sessionUserFor } from "../session-user.ts";
import type { Harness, HarnessContext } from "./contract.ts";
import { sessionEnv } from "./env.ts";

/**
 * The one way a harness runs: as a child process with stdin closed, its stdout
 * read a line at a time into the recipe's parser, its stderr kept for the
 * moment it exits without saying why.
 *
 * stdin is closed on purpose and for every harness. Two CLIs in the survey
 * hang or cancel a tool call on a stdin they did not expect, and a session
 * nobody is typing into has nothing to read (docs/plans/harnesses.md).
 */
export interface RunOptions {
  /** The environment the runner reads. Defaults to this process's. */
  env?: Record<string, string | undefined>;
  /** How long after `SIGTERM` to send `SIGKILL`. */
  graceMs?: number;
  /** How much of stderr to keep for the `done` detail. */
  stderrBytes?: number;
  /** Who this process is, so a test can say what it cannot be. */
  getuid?: () => number | undefined;
}

/** The session a harness gives, built once per process for one configuration. */
export function buildSession(config: Config, harness: Harness, options: RunOptions = {}): Session {
  return async function* session(input: SessionInput) {
    // A home of its own: what `prepare` writes is all the session's CLI reads
    // from there, and the operator's dotfiles and credentials are not in it.
    const home = await mkdtemp(join(tmpdir(), "deevy-home-"));
    try {
      await stripFromClone(input.cwd, harness.strip);
      const context: HarnessContext = { config, input, home, instructions: instructionsPath() };
      await harness.prepare?.(context);
      // After `prepare`, so what it wrote is the session's to read, and before
      // the spawn, so the session can write where it is about to work.
      const user = sessionUserFor(config, options.getuid);
      if (user) {
        await handOver(home, user);
        await handOver(input.cwd, user);
      }
      yield* runHarness(harness, context, options);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  };
}

/**
 * Removes what the repository ships that would configure the session. A path
 * that is not there is nothing to do; a path that escapes the clone is refused,
 * because a strip list is a recipe's and a recipe should not be able to reach
 * outside the working directory by mistake.
 */
export async function stripFromClone(cwd: string, paths: ReadonlyArray<string>): Promise<void> {
  const root = resolve(cwd);
  for (const path of paths) {
    const target = resolve(root, path);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`A strip path must stay inside the working directory: ${path}`);
    }
    await rm(target, { recursive: true, force: true });
  }
}

/**
 * The environment one harness's session gets: the allowlist, the session's
 * own home, and last what the recipe sets for itself, which is given the
 * context because a CLI's inline configuration is built from it.
 */
export function environmentFor(
  harness: Harness,
  config: Config,
  home: string,
  env: Record<string, string | undefined> = process.env,
  context?: HarnessContext,
): Record<string, string> {
  return {
    ...sessionEnv(env, [...(config.passEnv ?? []), ...harness.env.names], harness.env.prefixes),
    HOME: home,
    ...(context && harness.extraEnv ? harness.extraEnv(context) : {}),
  };
}

/**
 * The child process, as the seam's events.
 *
 * The recipe decides what a line means; this decides what the process's end
 * means when the lines did not say. A `done` the parser produced is the
 * session's own account and stands. A process that exits without one is
 * described by its exit code and the tail of its stderr, which is the only
 * thing a crashed CLI leaves behind.
 */
export async function* runHarness(
  harness: Harness,
  context: HarnessContext,
  options: RunOptions = {},
): AsyncGenerator<SessionEvent> {
  const { input } = context;
  const graceMs = options.graceMs ?? 5_000;
  const stderrBytes = options.stderrBytes ?? 4_096;
  const argv = harness.argv(context);
  const env = environmentFor(harness, context.config, context.home, options.env, context);

  // The session is another user where the runtime can make it one, so the
  // supervisor's environment, its files and its own `/proc` entry are outside
  // what a shell in the session can reach (src/session-user.ts).
  const user = sessionUserFor(context.config, options.getuid);
  const child = spawn(harness.binary, argv, {
    cwd: input.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    ...(user ? { uid: user.uid, gid: user.gid } : {}),
  });

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-stderrBytes);
  });

  // The Run's deadline, or the process stopping: ask nicely, then insist.
  let killer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    child.kill("SIGTERM");
    killer = setTimeout(() => child.kill("SIGKILL"), graceMs);
  };
  if (input.signal.aborted) stop();
  else input.signal.addEventListener("abort", stop, { once: true });

  const exited = new Promise<{ code: number | null; error: Error | null }>((resolveExit) => {
    child.once("error", (error) => resolveExit({ code: null, error }));
    child.once("exit", (code) => resolveExit({ code, error: null }));
  });

  // The session's own `done` is held until the process has exited: a CLI may
  // write what it spent to a file on the way out (`harness.usage`), and the
  // `done` is what carries it to the supervisor.
  let said: Extract<SessionEvent, { type: "done" }> | null = null;
  try {
    if (child.stdout) {
      for await (const line of createInterface({ input: child.stdout })) {
        if (line.trim() === "") continue;
        for (const event of harness.parse(line)) {
          if (event.type === "done") said = event;
          else yield event;
        }
      }
    }
    const { code, error } = await exited;
    const done: Extract<SessionEvent, { type: "done" }> =
      said ??
      (error
        ? { type: "done", ok: false, detail: `The session could not start: ${error.message}` }
        : input.signal.aborted
          ? // The supervisor stopped it and will say why; nothing here knows better.
            { type: "done", ok: false, detail: "The session was stopped" }
          : code === 0
            ? { type: "done", ok: true, detail: "The session ended" }
            : {
                type: "done",
                ok: false,
                detail: `The session exited with code ${String(code)}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
              });
    const usage = done.usage ?? (await usageFromFile(harness, context));
    yield usage ? { ...done, usage: named(usage, context.config.model) } : done;
  } finally {
    input.signal.removeEventListener("abort", stop);
    if (killer) clearTimeout(killer);
    // A consumer that stopped reading, or a session that ended: either way the
    // process does not outlive the Run.
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

/** What the CLI wrote about the session's spend, if it writes one and did. */
async function usageFromFile(harness: Harness, context: HarnessContext): Promise<Usage | null> {
  if (!harness.usage) return null;
  try {
    return harness.usage.read(await readFile(harness.usage.file(context), "utf8"));
  } catch {
    // No file is no usage: a session that never started writes none.
    return null;
  }
}

/** Every model named: where the harness did not say, it is the one the runtime asked for. */
function named(usage: Usage, model: string): Usage {
  return { models: usage.models.map((entry) => ({ ...entry, model: entry.model ?? model })) };
}
