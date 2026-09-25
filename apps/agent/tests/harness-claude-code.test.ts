import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import {
  claudeCode,
  deevyTools,
  deniedTools,
  repositoryTools,
  toSessionEvents,
} from "../src/harness/claude-code.ts";
import type { HarnessContext } from "../src/harness/contract.ts";
import { environmentFor } from "../src/harness/run.ts";
import { readInstructions } from "../src/instructions.ts";
import type { SessionEvent } from "../src/session.ts";
import { testConfig } from "./helpers.ts";

const input = {
  prompt: "Work Run r1 on Issue DEV-1.",
  cwd: "/tmp/run",
  repository: false,
  mcpUrl: "http://127.0.0.1:1/mcp",
  signal: AbortSignal.abort(),
};

const context = (config = testConfig): HarnessContext => ({
  config,
  // The override configured is a Run with a repository, as src/work.ts makes it.
  input: { ...input, repository: config.repo !== null },
  home: "/tmp/home",
  instructions: "/app/dist/instructions.md",
});

/** A deterministic environment, so the argv a test reads is the same twice. */
const env = {
  PATH: "/usr/bin",
  HOME: "/home/operator",
  ANTHROPIC_API_KEY: "sk-ant-x",
  DEEVY_AGENT_KEY: "deevy_sk_secret",
  DEEVY_AGENT_GIT_TOKEN: "ghp_secret",
};

const withRepo = {
  ...testConfig,
  repo: { url: "https://github.com/owner/repo.git", token: "ghp_secret", baseBranch: "main" },
};

describe("the command line a session runs under", () => {
  /**
   * Asserted whole, never sampled. Every flag here is a decision about what an
   * agent holding a shell may do, and a test that checks most of them passes
   * while the one that matters goes missing (docs/plans/harnesses.md,
   * convention 24). Field for field this is the options object the Agent SDK
   * was given until ADR-0018: `mcpServers`, `allowedTools`, `disallowedTools`,
   * `strictMcpConfig`, `settingSources`, `permissionPrompts`, `permissionMode`,
   * `systemPrompt.append`, `model`, `effort`, `maxTurns`.
   */
  it("is the whole security boundary, and this is all of it", () => {
    expect(claudeCode.argv(context())).toEqual([
      "-p",
      "Work Run r1 on Issue DEV-1.",
      "--output-format",
      "stream-json",
      "--verbose",
      // The supervisor's loopback proxy and no header: the session never holds
      // the key, whichever harness it is (src/proxy.ts).
      "--mcp-config",
      '{"mcpServers":{"deevy":{"type":"http","url":"http://127.0.0.1:1/mcp"}}}',
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--permission-mode",
      "default",
      "--permission-prompts",
      "none",
      "--allowedTools",
      "mcp__deevy__inbox_list",
      "mcp__deevy__runs_list",
      "mcp__deevy__runs_get",
      "mcp__deevy__runs_start",
      "mcp__deevy__issues_get",
      "mcp__deevy__docs_get",
      "mcp__deevy__issues_create",
      "mcp__deevy__comments_create",
      "mcp__deevy__runs_post_activity",
      "mcp__deevy__gates_request",
      "mcp__deevy__gates_get",
      "mcp__deevy__pulls_open",
      "mcp__deevy__links_add",
      "mcp__deevy__runs_finish",
      // No repository, so no shell and no denylist: a session with nothing to
      // run has no use for one, and the tool surface follows the Run's own
      // checkout rather than a flag somebody has to remember.
      "--append-system-prompt-file",
      "/app/dist/instructions.md",
      "--model",
      "claude-opus-5",
      "--effort",
      "high",
      "--max-turns",
      "10",
    ]);
  });

  it("adds the file and shell tools only when there is a repository to use them on", () => {
    const argv = claudeCode.argv(context(withRepo));
    const allowed = argv.indexOf("--allowedTools");
    const next = argv.indexOf("--append-system-prompt-file");

    expect(argv.slice(allowed + 1, next)).toEqual([...deevyTools, ...repositoryTools]);
    expect(repositoryTools).toEqual([
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash",
      "WebSearch",
      "WebFetch",
    ]);
    // Nothing is denied. The session runs git, reaching the world through the
    // supervisor's proxy, and where it may push is the token's scope and the
    // forge's own protections rather than a list this program wrote
    // (ADR-0019). The flag is left out rather than passed empty.
    expect(argv).not.toContain("--disallowedTools");
    expect(deniedTools).toEqual([]);
  });

  it("gives them to a Run whose repository deevy named, with nothing configured here", () => {
    // The Run's checkout says there is a repository, not this runtime's own
    // override (ADR-0024): the first real GitHub walk cloned it, read it, and
    // was refused every Write, Edit and Bash, because the tool list asked
    // `DEEVY_AGENT_REPO` instead.
    const argv = claudeCode.argv({ ...context(), input: { ...input, repository: true } });
    const allowed = argv.indexOf("--allowedTools");
    const next = argv.indexOf("--append-system-prompt-file");

    expect(argv.slice(allowed + 1, next)).toEqual([...deevyTools, ...repositoryTools]);
  });

  it("puts the prompt before the variadic tool lists, which would otherwise swallow it", () => {
    const argv = claudeCode.argv(context(withRepo));

    expect(argv.slice(0, 2)).toEqual(["-p", "Work Run r1 on Issue DEV-1."]);
  });

  it("grants tools by name, so deevy widening is not this program widening", () => {
    // A wildcard would make `mcp-tools.json` gaining a tool a change to what
    // this runtime may do, decided by a different pull request.
    expect(deevyTools.some((tool) => tool.includes("*"))).toBe(false);
    expect(deevyTools).not.toContain("mcp__deevy__gates_approve");
    expect(deevyTools).not.toContain("mcp__deevy__labels_create");
  });

  it("never asks for the permission mode that turns the allowlist off", () => {
    const argv = claudeCode.argv(context(withRepo));

    expect(argv).not.toContain("bypassPermissions");
    expect(argv).not.toContain("--dangerously-skip-permissions");
    expect(
      argv.slice(argv.indexOf("--permission-prompts"), 2 + argv.indexOf("--permission-prompts")),
    ).toEqual(["--permission-prompts", "none"]);
  });

  it("never carries a secret, because a shell can read its parent's arguments", () => {
    const argv = claudeCode.argv(context({ ...withRepo, key: "deevy_sk_secret" }));

    expect(JSON.stringify(argv)).not.toContain("deevy_sk_secret");
    expect(JSON.stringify(argv)).not.toContain("ghp_secret");
  });
});

describe("what the session may read from disk", () => {
  it("strips what a repository could ship to configure the CLI, and keeps its input", () => {
    // `CLAUDE.md` is input, and input is untrusted rather than forbidden
    // (ADR-0014); `.mcp.json` and `.claude/` would add a server or grant a
    // permission, and `--setting-sources ""` plus `--strict-mcp-config` are
    // the flags that say no to them. The strip list is the second fence.
    expect(claudeCode.strip).toEqual([".mcp.json", ".claude"]);
  });

  it("gives the session a home of its own, and the credential it is supposed to hold", () => {
    expect(environmentFor(claudeCode, withRepo, "/tmp/deevy-home-x", env)).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/deevy-home-x",
      ANTHROPIC_API_KEY: "sk-ant-x",
    });
  });

  it("requires nothing, because a signed-in laptop and a keyed container are both fine", () => {
    expect(claudeCode.env.requires).toEqual([]);
    // The host tooling's own state is not the runtime's configuration, and
    // inheriting it is what let a session authenticate as somebody's editor.
    expect(claudeCode.env.prefixes).toEqual(["ANTHROPIC_"]);
    expect(claudeCode.env.prefixes.some((prefix) => prefix.startsWith("CLAUDE"))).toBe(false);
  });

  it("carries the instructions the worked example writes out in prose", async () => {
    const shipped = await readInstructions();

    expect(shipped).toContain("## Working an Issue in deevy");
    // What it is now free to do, and what its own words are used for.
    expect(shipped).toContain("git");
    expect(shipped).toContain("what a reviewer reads");
    // The one thing an Agent must not try, in the file that tells it so.
    expect(shipped).toContain("Do not rule on it yourself");
  });
});

describe("reading the stream", () => {
  /**
   * Recorded once from `claude -p` on the cheapest model, asked to run a
   * command the denylist refuses (docs/plans/harnesses.md, convention 25).
   * Paths and ids are scrubbed; the shape is the CLI's own.
   */
  it("replays a recorded session into the seam's events", async () => {
    const fixture = await readFile(
      new URL("./fixtures/claude-code/session.jsonl", import.meta.url),
      "utf8",
    );
    const events: SessionEvent[] = fixture
      .split("\n")
      .filter((line) => line.trim() !== "")
      .flatMap((line) => claudeCode.parse(line));

    expect(events.map((event) => event.type)).toEqual(["ready", "tool", "denied", "text", "done"]);
    expect(events[0]).toMatchObject({
      type: "ready",
      servers: [{ name: "deevy", status: "failed" }],
    });
    expect(events[1]).toEqual({ type: "tool", name: "Bash" });
    expect(events[2]).toMatchObject({ type: "denied", name: "Bash" });
    expect((events[2] as Extract<SessionEvent, { type: "denied" }>).reason).toContain(
      "git push origin main",
    );
    expect(events[4]).toMatchObject({
      type: "done",
      ok: true,
      usage: { inputTokens: 18, outputTokens: 309, costUsd: 0.0211441 },
    });
  });

  it("ends well on a success and badly on anything else", () => {
    const success = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Planned it",
    });
    const failed = JSON.stringify({ type: "result", subtype: "error_during_execution" });

    expect(toSessionEvents(success)).toEqual([{ type: "done", ok: true, detail: "Planned it" }]);
    expect(toSessionEvents(failed)).toEqual([
      { type: "done", ok: false, detail: "The session ended: error_during_execution" },
    ]);
  });

  it("says what was refused as well as why, where the CLI says both", () => {
    // The CLI the first real GitHub walk ran gives a reason beside the message
    // that names the call, and reading only the reason left a Human looking at
    // "Refused Bash: no approval surface in this session" with no command.
    const denied = JSON.stringify({
      type: "system",
      subtype: "permission_denied",
      tool_name: "Bash",
      decision_reason:
        "no approval surface in this session; permission request denied automatically",
      message: "Permission to use Bash with command ls -la /etc has been denied.",
    });

    expect(toSessionEvents(denied)).toEqual([
      {
        type: "denied",
        name: "Bash",
        reason:
          "Permission to use Bash with command ls -la /etc has been denied. " +
          "(no approval surface in this session; permission request denied automatically)",
      },
    ]);
  });

  it("treats a success the CLI flagged as an error as one", () => {
    const flagged = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "half of it",
    });

    expect(toSessionEvents(flagged)).toEqual([{ type: "done", ok: false, detail: "half of it" }]);
  });

  it("ignores the lines the supervisor has no opinion about, and lines that are not JSON", () => {
    expect(toSessionEvents(JSON.stringify({ type: "status" }))).toEqual([]);
    expect(toSessionEvents(JSON.stringify({ type: "system", subtype: "thinking_tokens" }))).toEqual(
      [],
    );
    expect(toSessionEvents("not json")).toEqual([]);
  });
});
