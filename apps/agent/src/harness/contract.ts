import type { Config } from "../config.ts";
import type { SessionEvent, SessionInput, Usage } from "../session.ts";

/**
 * What one session is given, beyond the Run's own input.
 */
export interface HarnessContext {
  config: Config;
  input: SessionInput;
  /**
   * The session's `HOME`: a directory the runner made for this session alone
   * and removes after it. A CLI that reads its configuration from the home
   * directory reads what `prepare` wrote there and nothing of the operator's.
   */
  home: string;
  /** The absolute path of the instructions every session carries (src/instructions.md). */
  instructions: string;
}

/**
 * A coding-agent CLI, as the runtime drives it.
 *
 * The supervisor knows the `Session` seam and nothing else; a harness is what
 * turns a `Config` and a `SessionInput` into a subprocess and its stdout into
 * the seam's events. Every field is a decision about what an agent holding a
 * shell may do, which is why the argv, the strip list and the environment are
 * asserted whole by a test rather than sampled (docs/plans/harnesses.md,
 * convention 24).
 *
 * One recipe is one file in `src/harness/` plus a recorded fixture under
 * `tests/fixtures/<name>/`, and it touches nothing outside them (convention 23).
 */
export interface Harness {
  /** The name `DEEVY_AGENT_HARNESS` selects it by. */
  name: string;
  /** The executable, found on `PATH`. */
  binary: string;
  /**
   * The environment the session sees on top of the runtime's allowlist
   * (src/harness/env.ts): variables by name, and prefixes allowed whole.
   * `requires` is the subset the runtime refuses to start without.
   */
  env: {
    requires: ReadonlyArray<string>;
    names: ReadonlyArray<string>;
    prefixes: ReadonlyArray<string>;
  };
  /**
   * Paths removed from the clone before the session starts, relative to its
   * root. A CLI that reads configuration from the working directory would
   * otherwise be configured by whoever wrote the repository (ADR-0014).
   */
  strip: ReadonlyArray<string>;
  /** Files the session needs, written under `home` before it starts. */
  prepare?(context: HarnessContext): Promise<void>;
  /**
   * Variables the recipe itself sets for the session, on top of what the
   * operator's environment passes through (`env`): a CLI's inline
   * configuration, a flag that turns project configuration off. Applied last,
   * so nothing inherited overrides them, and never a credential, because the
   * session's shell can read its own environment (ADR-0014).
   */
  extraEnv?(context: HarnessContext): Record<string, string>;
  /** The whole command line, less the binary. */
  argv(context: HarnessContext): string[];
  /** One line of stdout to zero or more events. */
  parse(line: string): SessionEvent[];
  /**
   * Where the CLI writes what the session spent, when its stream does not say
   * (Copilot's `--usage-output-file`), and how to read it. The runner reads it
   * once the process has exited, and it stands in for the stream's usage only
   * where the stream gave none.
   */
  usage?: {
    file(context: HarnessContext): string;
    read(text: string): Usage | null;
  };
  /**
   * What `docs/OPERATIONS.md` says about this harness: what stops the session
   * reaching further than intended, what a Human sees in the Run's feed when
   * it tries, and what it cannot bound (convention 26).
   */
  bounds: string;
}
