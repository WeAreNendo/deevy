/**
 * What the runtime needs to be an Agent in a deevy Workspace.
 *
 * Read once, from the environment, and never at module scope: the same rule
 * `apps/server` follows, for the same reason (docs/plans/m3.md).
 */
export interface Config {
  /** The deevy instance this Agent works in, without a trailing slash. */
  url: string;
  /**
   * The Agent's API key, issued by its Sponsor and shown once. Everything the
   * runtime does is attributed to the Agent it belongs to, so this is the whole
   * of the runtime's identity (ADR-0001).
   */
  key: string;
  /**
   * Which coding-agent CLI works the Runs, by the name its recipe registers
   * (src/harness/index.ts). The supervisor is the same whichever it is.
   */
  harness: string;
  /** How long to wait before asking deevy for work again when there was none. */
  pollSeconds: number;
  /** How long one Run may take before the session working it is aborted. */
  runTimeoutSeconds: number;
  /** The model the session runs on, in the harness's own naming. */
  model: string;
  /** How hard it thinks, where the harness has the knob. Raise it for work that is more than a Document. */
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  /** A backstop on a session that will not stop. The timeout is the real bound. */
  maxTurns: number;
  /**
   * A repository to work in when deevy names none, or null.
   *
   * deevy is asked first, every Run: a Project bound to a forge Socket answers
   * with the repository, the branch and a credential minted for that Run
   * (`runs.checkout`, ADR-0024). This is the override for the other case — a
   * repository deevy has no Socket for — and it is the runtime's own
   * configuration, credential and all, which is why it is three environment
   * variables and not a row in deevy.
   */
  repo: RepoConfig | null;
  /** Where per-Run working directories are made. */
  workdir?: string;
  /**
   * The secret deevy signs its webhooks with, chosen when the Agent's webhook
   * URL was set. Absent means the runtime polls and listens to nobody, which is
   * the default: a delivery is an accelerator, never the only way work arrives
   * (docs/plans/m4.md).
   */
  webhookSecret?: string;
  /** The port the listener binds. Zero picks one, which is only useful in a test. */
  listenPort: number;
  /**
   * The user a session runs as, when the runtime is root and so can make it
   * somebody else (src/session-user.ts). Zero, or a runtime that is not root,
   * means the session shares the supervisor's user and can read its
   * environment out of `/proc` — which is fine on a laptop and is not a way to
   * run it against a Workspace other people write in.
   */
  sessionUid: number;
  sessionGid: number;
  /**
   * Environment variables to pass through to the session on top of the
   * allowlist — a proxy, a private registry, a custom CA.
   */
  passEnv?: string[];
}

const efforts = ["low", "medium", "high", "xhigh", "max"] as const;

function effort(value: string | undefined): Config["effort"] {
  const found = efforts.find((level) => level === value);
  return found ?? "high";
}

import type { RepoConfig } from "./workspace.ts";

/** A positive number from the environment, or the default when it is absent or nonsense. */
function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** A uid or gid: the default when absent, and zero for "the supervisor's own". */
function user(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set, and the runtime is nobody without it`);
  return value;
}

export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    url: required(env, "DEEVY_URL").replace(/\/+$/, ""),
    key: required(env, "DEEVY_AGENT_KEY"),
    harness: env.DEEVY_AGENT_HARNESS ?? "claude-code",
    pollSeconds: positive(env.DEEVY_AGENT_POLL_SECONDS, 30),
    // Thirty minutes is deevy's own stale window (docs/plans/m2.md): a session
    // allowed to outlive it would be reported stale by the sweep while it was
    // still working, and the Human watching would be told the wrong thing.
    runTimeoutSeconds: positive(env.DEEVY_AGENT_RUN_TIMEOUT_SECONDS, 30 * 60),
    model: env.DEEVY_AGENT_MODEL ?? "claude-opus-5",
    effort: effort(env.DEEVY_AGENT_EFFORT),
    maxTurns: positive(env.DEEVY_AGENT_MAX_TURNS, 100),
    repo: env.DEEVY_AGENT_REPO
      ? {
          url: env.DEEVY_AGENT_REPO,
          ...(env.DEEVY_AGENT_GIT_TOKEN ? { token: env.DEEVY_AGENT_GIT_TOKEN } : {}),
          baseBranch: env.DEEVY_AGENT_BASE_BRANCH ?? "main",
        }
      : null,
    ...(env.DEEVY_AGENT_WORKDIR ? { workdir: env.DEEVY_AGENT_WORKDIR } : {}),
    ...(env.DEEVY_AGENT_WEBHOOK_SECRET ? { webhookSecret: env.DEEVY_AGENT_WEBHOOK_SECRET } : {}),
    listenPort: positive(env.DEEVY_AGENT_PORT, 8787),
    sessionUid: user(env.DEEVY_AGENT_SESSION_UID, 10002),
    sessionGid: user(env.DEEVY_AGENT_SESSION_GID, 10002),
    ...(env.DEEVY_AGENT_PASS_ENV
      ? {
          passEnv: env.DEEVY_AGENT_PASS_ENV.split(",")
            .map((name) => name.trim())
            .filter(Boolean),
        }
      : {}),
  };
}
