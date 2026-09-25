/**
 * The seam every other part of the runtime hangs off: something that, given a
 * prompt and a working directory, does the work and says what happened.
 *
 * It is not any harness's own shape. The supervisor's job is about Runs, and
 * `subtype === "error_during_execution"` is not a fact about a Run — so the
 * events below are the runtime's own, a harness maps its output onto them,
 * and every test in this package scripts a session in four lines instead of
 * constructing one harness's objects (docs/plans/m4.md, docs/plans/harnesses.md).
 */
export interface SessionInput {
  /** What this session is being asked to do, in words. */
  prompt: string;
  /** The directory the session runs in. A clone of the repository, or empty. */
  cwd: string;
  /**
   * Whether `cwd` is a clone this Run may change: deevy named a repository for
   * it (`runs.checkout`), or this runtime's override did. What decides the file
   * and shell tools, per Run — never the configuration alone, which names a
   * repository only for the override.
   */
  repository: boolean;
  /**
   * Where deevy is, from inside the session: the supervisor's own loopback
   * proxy, which adds the Agent's key and enforces the tool list (src/proxy.ts).
   * The session is configured with this URL and no credential.
   */
  mcpUrl: string;
  /** Aborted when the Run's timeout elapses, or when the process is stopping. */
  signal: AbortSignal;
}

export type SessionEvent =
  /**
   * The session is up. `servers` is every MCP server it connected to and the
   * status of each, kept for the log: whether deevy is reachable is decided by
   * the supervisor's own probe before the session starts, not read from here.
   */
  | { type: "ready"; tools: string[]; servers: Array<{ name: string; status: string }> }
  /** A tool the session called, by its namespaced name. */
  | { type: "tool"; name: string }
  /**
   * A tool the session asked for and was refused. With no approval surface
   * every unlisted tool lands here, and a Human reading the Run should see that
   * the agent reached for something it may not do — the model itself only sees
   * an error and will often report it as something else. The proxy is one
   * source of these and the harness is the other.
   */
  | { type: "denied"; name: string; reason: string }
  /** Something the session said. Kept for the log; the Run's own narration is the model's. */
  | { type: "text"; text: string }
  /**
   * The session ended. `ok` is whether it ended on purpose. `usage` is what it
   * spent, as far as the harness reports it; a harness that reports nothing
   * leaves it out, and the supervisor logs what it gets.
   */
  | { type: "done"; ok: boolean; detail: string; usage?: Usage };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export type Session = (input: SessionInput) => AsyncIterable<SessionEvent>;
