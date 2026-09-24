import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  agentFile,
  agentName,
  copilot,
  copilotHome,
  deevyTools,
  deniedTools,
  repositoryTools,
  toSessionEvents,
} from "../src/harness/copilot.ts";
import type { HarnessContext } from "../src/harness/contract.ts";
import { environmentFor } from "../src/harness/run.ts";
import { instructionsPath, readInstructions } from "../src/instructions.ts";
import type { SessionEvent } from "../src/session.ts";
import { testConfig } from "./helpers.ts";

const input = {
  prompt: "Work Run r1 on Issue DEV-1.",
  cwd: "/tmp/run",
  mcpUrl: "http://127.0.0.1:1/mcp",
  signal: AbortSignal.abort(),
};

const context = (config = testConfig, home = "/tmp/home"): HarnessContext => ({
  config,
  input,
  home,
  // The real file, since `prepare` reads it into the agent file it writes.
  instructions: instructionsPath(),
});

const withRepo = {
  ...testConfig,
  repo: { url: "https://github.com/owner/repo.git", token: "ghp_secret", baseBranch: "main" },
};

/** A deterministic environment, so the argv a test reads is the same twice. */
const env = {
  PATH: "/usr/bin",
  HOME: "/home/operator",
  COPILOT_GITHUB_TOKEN: "ghu_copilot",
  DEEVY_AGENT_KEY: "deevy_sk_secret",
  DEEVY_AGENT_GIT_TOKEN: "ghp_secret",
  // The operator's own Copilot, which must not configure the session.
  COPILOT_MODEL: "gpt-5.4",
  COPILOT_ALLOW_ALL: "true",
};

const scratch: string[] = [];
afterEach(async () => {
  for (const path of scratch.splice(0)) await rm(path, { recursive: true, force: true });
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "deevy-copilot-test-"));
  scratch.push(path);
  return path;
}

describe("the command line a session runs under", () => {
  /**
   * Asserted whole, never sampled. Every flag here is a decision about what an
   * agent holding a shell may do (docs/plans/harnesses.md, convention 24).
   */
  it("is this, without a repository", () => {
    expect(copilot.argv(context())).toEqual([
      "-p",
      "Work Run r1 on Issue DEV-1.",
      "--output-format",
      "json",
      "--no-ask-user",
      "--no-auto-update",
      "--no-remote-export",
      "--disable-builtin-mcps",
      "--secret-env-vars",
      "COPILOT_GITHUB_TOKEN",
      "--agent",
      "deevy",
      "--allow-tool",
      "deevy(inbox_list)",
      "--allow-tool",
      "deevy(runs_list)",
      "--allow-tool",
      "deevy(runs_get)",
      "--allow-tool",
      "deevy(runs_start)",
      "--allow-tool",
      "deevy(issues_get)",
      "--allow-tool",
      "deevy(issues_create)",
      "--allow-tool",
      "deevy(comments_create)",
      "--allow-tool",
      "deevy(runs_post_activity)",
      "--allow-tool",
      "deevy(gates_request)",
      "--allow-tool",
      "deevy(gates_get)",
      "--allow-tool",
      "deevy(pulls_open)",
      "--allow-tool",
      "deevy(links_add)",
      "--allow-tool",
      "deevy(runs_finish)",
      // No repository, so no file or shell grant and no git denials: a session
      // with nothing to run has no use for them.
      "--model",
      "claude-opus-5",
    ]);
  });

  it("adds the file and shell grant and the git denials only when there is a repository", () => {
    const argv = copilot.argv(context(withRepo));
    const allow = argv.lastIndexOf("--allow-tool");
    const model = argv.indexOf("--model");

    // The last `--allow-tool` is the repository grant, one comma-joined value.
    expect(argv[allow + 1]).toEqual("read,write,shell");
    expect(repositoryTools).toEqual("read,write,shell");
    // And nothing denied after it: the session runs git through the
    // supervisor's proxy, and where it may push is the token's scope and the
    // forge's own protections (ADR-0019).
    expect(argv.slice(allow + 2, model)).toEqual([]);
    expect(deniedTools).toEqual([]);
  });

  it("grants tools by name, so deevy widening is not this program widening", () => {
    expect(deevyTools.some((tool) => tool.includes("*"))).toBe(false);
    expect(deevyTools).toContain("deevy(issues_get)");
    expect(deevyTools).not.toContain("deevy(gates_approve)");
    expect(deevyTools).not.toContain("deevy(labels_create)");
  });

  it("never asks for the flag that turns the allowlist off", () => {
    const argv = copilot.argv(context(withRepo));

    expect(argv).not.toContain("--allow-all-tools");
    expect(argv).not.toContain("--allow-all");
    expect(argv).not.toContain("--yolo");
    // The question a session nobody watches cannot answer is removed, not left.
    expect(argv).toContain("--no-ask-user");
  });

  it("never carries a secret, because a shell can read its parent's arguments", () => {
    const argv = copilot.argv(context({ ...withRepo, key: "deevy_sk_secret" }));

    expect(JSON.stringify(argv)).not.toContain("deevy_sk_secret");
    expect(JSON.stringify(argv)).not.toContain("ghp_secret");
    expect(JSON.stringify(argv)).not.toContain("DEEVY_");
  });
});

describe("the files the session is given", () => {
  /**
   * `prepare` writes into `COPILOT_HOME`, and this asserts both files whole by
   * writing them into a temp home and reading them back. The MCP server is the
   * proxy's loopback URL with no header; the agent file carries the runtime's
   * instructions and `--agent` selects it.
   */
  it("writes the MCP configuration and the custom agent, and this is all of them", async () => {
    const home = await directory();
    const ctx = context(testConfig, home);
    await copilot.prepare?.(ctx);

    const configDir = copilotHome(ctx);
    const mcp = JSON.parse(await readFile(join(configDir, "mcp-config.json"), "utf8"));
    expect(mcp).toEqual({
      mcpServers: {
        deevy: {
          type: "http",
          url: "http://127.0.0.1:1/mcp",
          tools: [
            "inbox_list",
            "runs_list",
            "runs_get",
            "runs_start",
            "issues_get",
            "issues_create",
            "comments_create",
            "runs_post_activity",
            "gates_request",
            "gates_get",
            "pulls_open",
            "links_add",
            "runs_finish",
          ],
        },
      },
    });

    const agent = await readFile(join(configDir, "agents", `${agentName}.agent.md`), "utf8");
    const shipped = await readInstructions();
    expect(agent).toEqual(agentFile(shipped));
    // The instructions the worked example writes out reach the session.
    expect(agent).toContain("---\nname: deevy");
    expect(agent).toContain("## Working an Issue in deevy");
    expect(agent).toContain("Do not rule on it yourself");
  });

  it("puts no header and no secret anywhere in the configuration it writes", async () => {
    const home = await directory();
    const ctx = context({ ...withRepo, key: "deevy_sk_secret" }, home);
    // `prepare` reads the Copilot token from the environment; keep it distinct
    // from the git token so it does not (correctly) refuse here.
    const before = process.env.COPILOT_GITHUB_TOKEN;
    process.env.COPILOT_GITHUB_TOKEN = "ghu_copilot";
    try {
      await copilot.prepare?.(ctx);
    } finally {
      if (before === undefined) delete process.env.COPILOT_GITHUB_TOKEN;
      else process.env.COPILOT_GITHUB_TOKEN = before;
    }

    const configDir = copilotHome(ctx);
    const mcp = await readFile(join(configDir, "mcp-config.json"), "utf8");
    const agent = await readFile(join(configDir, "agents", `${agentName}.agent.md`), "utf8");
    for (const written of [mcp, agent]) {
      expect(written).not.toContain("Authorization");
      expect(written).not.toContain("Bearer");
      expect(written).not.toContain("deevy_sk_secret");
      expect(written).not.toContain("ghp_secret");
      expect(written).not.toContain("ghu_copilot");
      expect(written).not.toContain("DEEVY_");
    }
    // The proxy URL carries no credential; the server needs no header.
    expect(mcp).not.toContain("headers");
  });

  it("refuses to start when the Copilot token is the git token the supervisor holds", async () => {
    const home = await directory();
    const ctx = context({ ...withRepo, repo: { ...withRepo.repo, token: "ghp_shared" } }, home);
    const before = process.env.COPILOT_GITHUB_TOKEN;
    process.env.COPILOT_GITHUB_TOKEN = "ghp_shared";
    try {
      await expect(copilot.prepare?.(ctx)).rejects.toThrow(
        /COPILOT_GITHUB_TOKEN must not be the git token/,
      );
    } finally {
      if (before === undefined) delete process.env.COPILOT_GITHUB_TOKEN;
      else process.env.COPILOT_GITHUB_TOKEN = before;
    }
  });

  it("has nothing to strip, because it never trusts the working directory", () => {
    expect(copilot.strip).toEqual([]);
  });
});

describe("the session's environment", () => {
  it("gives the session its own COPILOT_HOME, the token, and no secret", () => {
    const home = "/tmp/deevy-home-x";
    const environment = environmentFor(copilot, withRepo, home, env, context(withRepo, home));

    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: home,
      COPILOT_GITHUB_TOKEN: "ghu_copilot",
      COPILOT_HOME: join(home, "copilot"),
    });
    // The operator's own Copilot settings and the deevy/git secrets are gone:
    // the allowlist passes the token by name and a prefix would let the rest in.
    expect(environment).not.toHaveProperty("COPILOT_MODEL");
    expect(environment).not.toHaveProperty("COPILOT_ALLOW_ALL");
    expect(environment).not.toHaveProperty("DEEVY_AGENT_KEY");
    expect(environment).not.toHaveProperty("DEEVY_AGENT_GIT_TOKEN");
    expect(JSON.stringify(environment)).not.toContain("ghp_secret");
  });

  it("requires the Copilot token by name, and allows no prefix", () => {
    expect(copilot.env.requires).toEqual(["COPILOT_GITHUB_TOKEN"]);
    expect(copilot.env.names).toEqual(["COPILOT_GITHUB_TOKEN"]);
    // `GH_`/`GITHUB_` would let the operator's own token authenticate the
    // session as themselves, and `COPILOT_` would carry their settings.
    expect(copilot.env.prefixes).toEqual([]);
  });
});

describe("reading the stream", () => {
  /**
   * Recorded once from a real `copilot -p --output-format json` run against a
   * loopback MCP server, asked to read an Issue and then run a command the
   * denylist refuses (docs/plans/harnesses.md, convention 25). Every line is
   * the CLI's own; paths and ids are scrubbed.
   */
  it("replays a recorded session into the seam's events", async () => {
    const fixture = await readFile(
      new URL("./fixtures/copilot/session.jsonl", import.meta.url),
      "utf8",
    );
    const events: SessionEvent[] = fixture
      .split("\n")
      .filter((line) => line.trim() !== "")
      .flatMap((line) => copilot.parse(line));

    expect(events.map((event) => event.type)).toEqual([
      "ready",
      "tool",
      "tool",
      "denied",
      "text",
      "done",
    ]);
    expect(events[0].type).toBe("ready");
    // The stream lists the deevy proxy connected and the built-in server off.
    expect((events[0] as Extract<SessionEvent, { type: "ready" }>).servers).toEqual([
      { name: "deevy", status: "connected" },
      { name: "github-mcp-server", status: "disabled" },
    ]);
    expect(events[1]).toEqual({ type: "tool", name: "deevy-issues_get" });
    expect(events[2]).toEqual({ type: "tool", name: "bash" });
    expect(events[3]).toMatchObject({ type: "denied", name: "bash" });
    expect((events[3] as Extract<SessionEvent, { type: "denied" }>).reason).toContain(
      "shell(git push:*)",
    );
    expect(events[5]).toMatchObject({ type: "done", ok: true });
    // Copilot's stream carries no token or cost totals, so `done` reports none.
    expect(events[5]).not.toHaveProperty("usage");
  });

  it("ends well on exit code zero and badly otherwise, carrying the last thing said", () => {
    const ready = JSON.stringify({
      type: "session.mcp_servers_loaded",
      data: { servers: [{ name: "deevy", status: "connected" }] },
    });
    const said = JSON.stringify({ type: "assistant.message", data: { content: "Planned it" } });
    const ok = JSON.stringify({ type: "result", exitCode: 0 });
    const bad = JSON.stringify({ type: "result", exitCode: 1 });

    // The last text becomes the summary line on success.
    expect(toSessionEvents(ready)).toEqual([
      { type: "ready", tools: [], servers: [{ name: "deevy", status: "connected" }] },
    ]);
    expect(toSessionEvents(said)).toEqual([{ type: "text", text: "Planned it" }]);
    expect(toSessionEvents(ok)).toEqual([{ type: "done", ok: true, detail: "Planned it" }]);
    // A fresh session clears the last word, and a non-zero exit reads badly.
    expect(toSessionEvents(ready)).toHaveLength(1);
    expect(toSessionEvents(bad)).toEqual([
      { type: "done", ok: false, detail: "The session exited with code 1" },
    ]);
  });

  it("reads a repository tool call and its refusal, and ignores an authored marker", () => {
    const start = JSON.stringify({ type: "tool.execution_start", data: { toolName: "bash" } });
    const denied = JSON.stringify({
      type: "tool.execution_complete",
      _authored: true,
      data: { toolName: "bash", success: false, error: { code: "denied", message: "no" } },
    });
    const ranOk = JSON.stringify({
      type: "tool.execution_complete",
      data: { toolName: "bash", success: true },
    });

    expect(toSessionEvents(start)).toEqual([{ type: "tool", name: "bash" }]);
    // The `_authored` field is ignored; the event is chosen by `type`.
    expect(toSessionEvents(denied)).toEqual([{ type: "denied", name: "bash", reason: "no" }]);
    // A tool that completed without a denial is not an event: the start was.
    expect(toSessionEvents(ranOk)).toEqual([]);
  });

  it("ignores the lines the supervisor has no opinion about, and lines that are not JSON", () => {
    expect(toSessionEvents(JSON.stringify({ type: "assistant.reasoning_delta" }))).toEqual([]);
    expect(toSessionEvents(JSON.stringify({ type: "session.usage_checkpoint" }))).toEqual([]);
    expect(toSessionEvents(JSON.stringify({ type: "assistant.message", data: {} }))).toEqual([]);
    expect(toSessionEvents("not json")).toEqual([]);
  });
});
