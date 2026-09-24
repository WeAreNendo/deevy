/**
 * The providers this build can speak (ADR-0024).
 *
 * An entry imports what it wants and hands it to `createApp({ sockets })`; the
 * core holds the port types and never this package, which is what keeps a
 * provider's HTTP client out of the core and inside the bundle the Workers
 * build already checks.
 *
 * `stub` is not a tool (src/stub). An entry that registers it in production is
 * the thing that is wrong, so the entry is where that is refused.
 */
import type { SocketModules } from "@deevy/core/sockets";
import { createGithubSocket } from "./github/index.ts";
import { createLinearSocket } from "./linear/index.ts";
import { createSlackSocket } from "./slack/index.ts";
import { createStubSocket, openDevStubStore } from "./stub/index.ts";

export * from "./stub/index.ts";
export { createGithubSocket, resetGithubTokens } from "./github/index.ts";
export type { GithubConfig, GithubCredentials } from "./github/index.ts";
export { createLinearSocket, resetLinearTokens } from "./linear/index.ts";
export type { LinearConfig, LinearCredentials } from "./linear/index.ts";
export { createSlackSocket, normalizeSlack } from "./slack/index.ts";
export type { SlackConfig, SlackCredentials } from "./slack/index.ts";

/**
 * The providers an entry may register.
 *
 * `stub` is not a tool: it is the in-process provider the tests, the seed and
 * the acceptance walk play. `devStub` says whether this deployment is allowed
 * one, and the entry is what answers — a module that decided where it may run
 * could not be tested anywhere.
 */
export interface SocketModulesOptions {
  /** Whether this deployment may register the in-process stub. */
  devStub?: boolean;
  /**
   * The containers that stub offers, as `name[=cloneUrl]` separated by commas
   * (`DEEVY_DEV_STUB_CONTAINERS`). A store lives in this process, so this is
   * the only way an operator or a walk outside it can say what the stubbed
   * tracker contains (src/stub).
   */
  devStubContainers?: string;
  /**
   * GitHub's REST root for every Socket that names none of its own
   * (`DEEVY_GITHUB_API`): a GitHub Enterprise Server, or the acceptance walk's
   * stand-in. A Socket may still carry its own, which is what a deployment
   * with one of each needs.
   */
  githubApiBase?: string;
}

export function socketModules({
  devStub = false,
  devStubContainers,
  githubApiBase,
}: SocketModulesOptions = {}): SocketModules {
  // Once, where the registry is built rather than per request: a store rebuilt
  // is a store that forgot every record it held (src/stub).
  if (devStub) openDevStubStore(devStubContainers);
  return {
    github: (input) =>
      createGithubSocket(
        githubApiBase && input.config.apiBase === undefined
          ? { ...input, config: { ...input.config, apiBase: githubApiBase } }
          : input,
      ),
    linear: createLinearSocket,
    slack: createSlackSocket,
    ...(devStub ? { stub: createStubSocket } : {}),
  };
}
