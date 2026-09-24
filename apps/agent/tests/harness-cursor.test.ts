import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { HarnessContext } from "../src/harness/contract.ts";
import {
  cliConfig,
  cursor,
  deevyTools,
  deniedTools,
  deniedWithoutRepository,
  mcpConfig,
  promptFor,
  repositoryTools,
  toSessionEvents,
} from "../src/harness/cursor.ts";
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

const context = (
  config = testConfig,
  home = "/tmp/home",
  instructions = instructionsPath(),
): HarnessContext => ({
  config,
  input,
  home,
  instructions,
});

const withRepo = {
  ...testConfig,
  repo: { url: "https://github.com/owner/repo.git", token: "ghp_secret", baseBranch: "main" },
};

/** A deterministic environment, so the argv a test reads is the same twice. */
const env = {
  PATH: "/usr/bin",
  HOME: "/home/operator",
  CURSOR_API_KEY: "cursor_key_x",
  DEEVY_AGENT_KEY: "deevy_sk_secret",
  DEEVY_AGENT_GIT_TOKEN: "ghp_secret",
  // The operator's own Cursor, which must not configure the session: these
  // would point the CLI at a configuration directory, a data directory and an
  // API that are not the session's.
  CURSOR_CONFIG_DIR: "/home/operator/.cursor",
  CURSOR_DATA_DIR: "/home/operator/.cursor",
  CURSOR_API_ENDPOINT: "https://somewhere.example",
  XDG_CONFIG_HOME: "/home/operator/.config",
};

const scratch: string[] = [];
afterEach(async () => {
  for (const path of scratch.splice(0)) await rm(path, { recursive: true, force: true });
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "deevy-cursor-test-"));
  scratch.push(path);
  return path;
}

/** An instructions file with known text, so the prompt in the argv is literal. */
async function instructionsFile(): Promise<string> {
  const path = join(await directory(), "instructions.md");
  await writeFile(path, "## Working an Issue in deevy\n\nStop at the Gate.\n");
  return path;
}

describe("the command line a session runs under", () => {
  /**
   * Asserted whole, never sampled. Every flag here is a decision about what an
   * agent holding a shell may do (docs/plans/harnesses.md, convention 24). It
   * is the same with and without a repository: what differs between the two
   * is in `cli-config.json`, because under `--force` the argv grants nothing
   * and the deny list is the fence.
   */
  it("is this, and the same whether or not there is a repository", async () => {
    const instructions = await instructionsFile();
    const expected = [
      "-p",
      "--output-format",
      "stream-json",
      "--force",
      "--approve-mcps",
      "--trust",
      "--disable-project-configs",
      "--workspace",
      "/tmp/run",
      "--model",
      "claude-opus-5",
      // The instructions ride in the prompt: Cursor has no rules directory
      // under the home and no system-prompt flag.
      "## Working an Issue in deevy\n\nStop at the Gate.\n\n---\n\nWork Run r1 on Issue DEV-1.",
    ];

    expect(cursor.argv(context(testConfig, "/tmp/home", instructions))).toEqual(expected);
    expect(cursor.argv(context(withRepo, "/tmp/home", instructions))).toEqual(expected);
  });

  it("puts the prompt last, as the one positional argument", () => {
    const argv = cursor.argv(context(withRepo));

    expect(argv.at(-1)).toBe(promptFor(context(withRepo)));
    expect(argv.at(-1)).toContain("Work Run r1 on Issue DEV-1.");
  });

  it("carries the instructions the worked example writes out in prose", async () => {
    const shipped = await readInstructions();
    const prompt = promptFor(context());

    expect(prompt.startsWith(shipped.trim())).toBe(true);
    expect(shipped).toContain("## Working an Issue in deevy");
    // The one thing an Agent must not try, in the text that tells it so.
    expect(shipped).toContain("Do not rule on it yourself");
  });

  it("does not read the effort, because Cursor has no flag for it", () => {
    const argv = cursor.argv(context({ ...withRepo, effort: "max" }));

    expect(argv).not.toContain("--effort");
    expect(argv).not.toContain("max");
    expect(cursor.bounds).toContain("`DEEVY_AGENT_EFFORT`, which this harness does not read");
  });

  it("never asks for the alias that means the same as --force, and no more", () => {
    const argv = cursor.argv(context(withRepo));

    expect(argv).toContain("--force");
    expect(argv).not.toContain("--yolo");
    expect(argv).not.toContain("--sandbox");
  });

  it("never carries a secret, because a shell can read its parent's arguments", () => {
    const argv = cursor.argv(context({ ...withRepo, key: "deevy_sk_secret" }));

    expect(JSON.stringify(argv)).not.toContain("deevy_sk_secret");
    expect(JSON.stringify(argv)).not.toContain("ghp_secret");
    expect(JSON.stringify(argv)).not.toContain("cursor_key_x");
  });
});

describe("what prepare writes into the session's home", () => {
  /**
   * Both files asserted whole, read back from a directory the test made: the
   * permissions are the whole of this harness's tool boundary, and the MCP
   * entry is the proof the session is pointed at the proxy with no header.
   */
  it("is the permissions and the proxy, with a repository", async () => {
    const home = await directory();
    await cursor.prepare?.(context(withRepo, home));

    expect(JSON.parse(await readFile(join(home, ".cursor", "cli-config.json"), "utf8"))).toEqual({
      version: 1,
      editor: { vimMode: false },
      permissions: {
        allow: [
          "Mcp(deevy:inbox_list)",
          "Mcp(deevy:runs_list)",
          "Mcp(deevy:runs_get)",
          "Mcp(deevy:runs_start)",
          "Mcp(deevy:issues_get)",
          "Mcp(deevy:docs_get)",
          "Mcp(deevy:issues_create)",
          "Mcp(deevy:comments_create)",
          "Mcp(deevy:runs_post_activity)",
          "Mcp(deevy:gates_request)",
          "Mcp(deevy:gates_get)",
          "Mcp(deevy:pulls_open)",
          "Mcp(deevy:links_add)",
          "Mcp(deevy:runs_finish)",
          "Read(**)",
          "Write(**)",
          "Shell(*)",
        ],
        // Nothing is denied with a repository: the session runs git, and
        // where it may push is the token's scope and the forge's own
        // protections rather than this list (ADR-0019).
        deny: [],
      },
    });
    expect(JSON.parse(await readFile(join(home, ".cursor", "mcp.json"), "utf8"))).toEqual({
      // The supervisor's loopback proxy and no header: the session never
      // holds the key, whichever harness it is (src/proxy.ts).
      mcpServers: { deevy: { url: "http://127.0.0.1:1/mcp" } },
    });
  });

  it("denies the file, shell and web tools when there is no repository to use them on", async () => {
    // Under `--force` a tool not named by a deny rule is allowed, so the
    // grant the other recipes withhold has to be a denial here.
    const home = await directory();
    await cursor.prepare?.(context(testConfig, home));

    expect(JSON.parse(await readFile(join(home, ".cursor", "cli-config.json"), "utf8"))).toEqual({
      version: 1,
      editor: { vimMode: false },
      permissions: {
        allow: [...deevyTools],
        deny: ["Read(**)", "Write(**)", "Shell(*)", "WebFetch(*)"],
      },
    });
    expect(deniedWithoutRepository).toEqual(["Read(**)", "Write(**)", "Shell(*)", "WebFetch(*)"]);
    expect(repositoryTools).toEqual(["Read(**)", "Write(**)", "Shell(*)"]);
    expect(deniedTools).toEqual([]);
  });

  it("grants the deevy tools by name, so deevy widening is not this program widening", () => {
    expect(deevyTools.some((tool) => tool.includes("*"))).toBe(false);
    expect(deevyTools).not.toContain("Mcp(deevy:gates_approve)");
    expect(cliConfig(context(withRepo))).toMatchObject({
      permissions: { allow: expect.not.arrayContaining(["Mcp(deevy:*)"]) as unknown },
    });
  });

  it("writes no secret and no header, because the session's shell can read its own home", async () => {
    const home = await directory();
    await cursor.prepare?.(context({ ...withRepo, key: "deevy_sk_secret" }, home));

    for (const name of ["cli-config.json", "mcp.json"]) {
      const text = await readFile(join(home, ".cursor", name), "utf8");
      expect(text).not.toContain("deevy_sk_secret");
      expect(text).not.toContain("ghp_secret");
      expect(text).not.toContain("headers");
      expect(text).not.toContain("Authorization");
    }
    expect(JSON.stringify(mcpConfig(context(withRepo)))).not.toContain("header");
  });
});

describe("what the session may read from disk", () => {
  it("strips the directory a repository would configure the CLI from, and keeps its input", () => {
    // `.cursor/cli.json` would replace the deny list, `.cursor/mcp.json` would
    // add a server `--approve-mcps` trusts; `AGENTS.md`, `CLAUDE.md` and
    // `.cursorrules` stay, because input is untrusted rather than forbidden
    // (ADR-0014).
    expect(cursor.strip).toEqual([".cursor"]);
  });

  it("gives the session a home of its own, and only the credential it is supposed to hold", () => {
    expect(environmentFor(cursor, withRepo, "/tmp/deevy-home-x", env, context(withRepo))).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/deevy-home-x",
      CURSOR_API_KEY: "cursor_key_x",
    });
  });

  it("requires the key, and names it rather than allowing a prefix", () => {
    // `CURSOR_CONFIG_DIR` would point the CLI away from the home `prepare`
    // wrote into, which is why `CURSOR_` is not a prefix.
    expect(cursor.env).toEqual({
      requires: ["CURSOR_API_KEY"],
      names: ["CURSOR_API_KEY"],
      prefixes: [],
    });
    expect(cursor.binary).toBe("agent");
  });
});

describe("reading the stream", () => {
  /**
   * Authored, not recorded: the CLI refuses to start without a credential —
   * `agent -p --output-format stream-json` under an empty home writes nothing
   * to stdout, "Error: Authentication required. Please run 'agent login'
   * first, or set CURSOR_API_KEY environment variable." to stderr, and exits
   * 1, which the runner turns into a `done` on its own (tests/harness-run.test.ts).
   * Every line is therefore marked `_authored` and its shape comes from the
   * documentation and the CLI's own stream writer (docs/plans/harnesses.md,
   * slice 4). Re-record with a key and the same prompt, and drop the marks.
   */
  it("replays the fixture into the seam's events", async () => {
    const fixture = await readFile(
      new URL("./fixtures/cursor/session.jsonl", import.meta.url),
      "utf8",
    );
    const lines = fixture.split("\n").filter((line) => line.trim() !== "");
    const events: SessionEvent[] = lines.flatMap((line) => cursor.parse(line));

    expect(events.map((event) => event.type)).toEqual([
      "ready",
      "text",
      "tool",
      "denied",
      "text",
      "tool",
      "text",
      "done",
    ]);
    expect(events[0]).toEqual({ type: "ready", tools: [], servers: [] });
    expect(events[2]).toEqual({ type: "tool", name: "Shell" });
    expect(events[3]).toEqual({
      type: "denied",
      name: "Shell",
      reason: "Command is not allowed: git push origin main",
    });
    expect(events[5]).toEqual({ type: "tool", name: "mcp__deevy__runs_post_activity" });
    expect(events[7]).toMatchObject({
      type: "done",
      ok: true,
      usage: { inputTokens: 21, outputTokens: 287 },
    });
    expect((events[7] as Extract<SessionEvent, { type: "done" }>).usage).not.toHaveProperty(
      "costUsd",
    );
  });

  it("says which lines were authored, and reads them the same without the mark", async () => {
    const fixture = await readFile(
      new URL("./fixtures/cursor/session.jsonl", import.meta.url),
      "utf8",
    );
    const lines = fixture.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      const parsed = JSON.parse(line) as { _authored?: boolean };
      expect(parsed._authored).toBe(true);
      const { _authored: _, ...rest } = parsed;
      expect(toSessionEvents(line)).toEqual(toSessionEvents(JSON.stringify(rest)));
    }
  });

  it("names a refused MCP tool the way it names an allowed one", () => {
    const refused = JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      call_id: "c1",
      tool_call: {
        mcpToolCall: {
          args: { name: "gates_approve", providerIdentifier: "deevy", toolName: "gates_approve" },
          result: { permissionDenied: { error: "Blocked by permissions configuration" } },
        },
      },
    });

    expect(toSessionEvents(refused)).toEqual([
      {
        type: "denied",
        name: "mcp__deevy__gates_approve",
        reason: "Blocked by permissions configuration",
      },
    ]);
  });

  it("treats a tool that ran as a call already counted, and not as a refusal", () => {
    const completed = JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      call_id: "c2",
      tool_call: {
        readToolCall: { args: { path: "README.md" }, result: { success: { content: "# hi" } } },
      },
    });

    expect(toSessionEvents(completed)).toEqual([]);
  });

  it("ends well on a success and badly on anything else", () => {
    const success = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Planned it",
    });
    const flagged = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "half of it",
    });
    const failed = JSON.stringify({ type: "result", subtype: "error", is_error: true });

    expect(toSessionEvents(success)).toEqual([{ type: "done", ok: true, detail: "Planned it" }]);
    expect(toSessionEvents(flagged)).toEqual([
      { type: "done", ok: false, detail: "The session ended: success: half of it" },
    ]);
    expect(toSessionEvents(failed)).toEqual([
      { type: "done", ok: false, detail: "The session ended: error" },
    ]);
  });

  it("ignores the lines the supervisor has no opinion about, and lines that are not JSON", () => {
    expect(toSessionEvents(JSON.stringify({ type: "user", message: {} }))).toEqual([]);
    expect(toSessionEvents(JSON.stringify({ type: "thinking", subtype: "delta" }))).toEqual([]);
    expect(
      toSessionEvents(JSON.stringify({ type: "interaction_query", subtype: "request" })),
    ).toEqual([]);
    expect(toSessionEvents(JSON.stringify({ type: "tool_call", subtype: "started" }))).toEqual([]);
    expect(toSessionEvents("not json")).toEqual([]);
  });
});
