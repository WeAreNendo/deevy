import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import type { Harness, HarnessContext } from "../src/harness/contract.ts";
import {
  agentName,
  deevyTools,
  deniedCommands,
  inlineConfig,
  opencode,
  permissions,
  providerVariables,
  repositoryPermissions,
  toSessionEvents,
} from "../src/harness/opencode.ts";
import { environmentFor, runHarness } from "../src/harness/run.ts";
import type { SessionEvent } from "../src/session.ts";
import { testConfig } from "./helpers.ts";

const input = {
  prompt: "Work Run r1 on Issue DEV-1.",
  cwd: "/tmp/run",
  repository: false,
  mcpUrl: "http://127.0.0.1:1/mcp",
  signal: AbortSignal.abort(),
};

/** OpenCode names a model `provider/model`; the shared test config does not. */
const config = { ...testConfig, model: "anthropic/claude-haiku-4-5" };

const withRepo = {
  ...config,
  repo: { url: "https://github.com/owner/repo.git", token: "ghp_secret", baseBranch: "main" },
};

const context = (cfg = config): HarnessContext => ({
  config: cfg,
  // The override configured is a Run with a repository, as src/work.ts makes it.
  input: { ...input, repository: cfg.repo !== null },
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
  // The operator's own OpenCode, which must not configure the session.
  OPENCODE_CONFIG: "/home/operator/.config/opencode/opencode.json",
  OPENCODE_PERMISSION: '{"*":"allow"}',
};

/** Every leaf value under a permission block, however nested. */
function leaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(leaves);
  return [];
}

async function fixture(name: string): Promise<SessionEvent[]> {
  const text = await readFile(new URL(`./fixtures/opencode/${name}`, import.meta.url), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => opencode.parse(line));
}

describe("the command line a session runs under", () => {
  /**
   * Asserted whole, never sampled (docs/plans/harnesses.md, convention 24).
   * The argv is the smaller half of this harness's boundary: the tools, the
   * MCP server and the permissions travel in the environment, and the test
   * below asserts that half whole too.
   */
  it("is this, with or without a repository", () => {
    const argv = [
      "run",
      "--format",
      "json",
      "--pure",
      "--agent",
      "deevy",
      "--model",
      "anthropic/claude-haiku-4-5",
      "--dir",
      "/tmp/run",
      "Work Run r1 on Issue DEV-1.",
    ];

    expect(opencode.argv(context())).toEqual(argv);
    // A repository changes what is granted, and that is written in the
    // inline configuration, not the argv.
    expect(opencode.argv(context(withRepo))).toEqual(argv);
  });

  it("refuses a model that is not provider/model, naming the variable", () => {
    expect(() => opencode.argv(context(testConfig))).toThrow(
      /DEEVY_AGENT_MODEL is "claude-opus-5"; OpenCode needs provider\/model/,
    );
    expect(() => opencode.argv(context({ ...config, model: "a/b/c" }))).not.toThrow();
    expect(() => opencode.argv(context({ ...config, model: "/x" }))).toThrow();
    expect(() => opencode.argv(context({ ...config, model: "x/" }))).toThrow();
  });

  it("never asks for the flag that turns the allowlist off", () => {
    const argv = opencode.argv(context(withRepo));

    expect(argv).not.toContain("--auto");
    expect(argv).not.toContain("--yolo");
    expect(argv).not.toContain("--dangerously-skip-permissions");
  });
});

describe("the inline configuration", () => {
  /**
   * `OPENCODE_CONFIG_CONTENT`, whole. Every key is a decision about what an
   * agent holding a shell may do: the server it reaches, the tools it is
   * granted, the prompt it runs under, and the steps it may take.
   */
  it("is the larger half of the boundary, and this is all of it", () => {
    expect(inlineConfig(context(withRepo))).toEqual({
      $schema: "https://opencode.ai/config.json",
      share: "disabled",
      autoupdate: false,
      mcp: {
        deevy: {
          type: "remote",
          // The supervisor's loopback proxy and no header: the session never
          // holds the key, whichever harness it is (src/proxy.ts).
          url: "http://127.0.0.1:1/mcp",
          oauth: false,
          timeout: 60_000,
        },
      },
      permission: {
        "*": "deny",
        deevy_inbox_list: "allow",
        deevy_runs_list: "allow",
        deevy_runs_get: "allow",
        deevy_runs_start: "allow",
        deevy_issues_get: "allow",
        deevy_docs_get: "allow",
        deevy_issues_create: "allow",
        deevy_comments_create: "allow",
        deevy_runs_post_activity: "allow",
        deevy_gates_request: "allow",
        deevy_gates_get: "allow",
        deevy_pulls_open: "allow",
        deevy_links_add: "allow",
        deevy_runs_finish: "allow",
        read: "allow",
        list: "allow",
        glob: "allow",
        grep: "allow",
        edit: "allow",
        // Allowed whole: the session runs git, reaching the world through the
        // supervisor's proxy, and where it may push is the token's scope and
        // the forge's own protections rather than a pattern here (ADR-0019).
        bash: "allow",
        webfetch: "allow",
        websearch: "allow",
      },
      agent: {
        deevy: {
          description:
            "Works one deevy Run: reads the Issue, writes the Document, stops at the Gate.",
          mode: "primary",
          prompt: "{file:/app/dist/instructions.md}",
          steps: 10,
        },
      },
    });
  });

  it("grants the repository tools to a Run whose repository deevy named, with nothing configured here", () => {
    // The Run's checkout says there is a repository, not this runtime's own
    // override (ADR-0024): the first real GitHub walk was refused every write
    // because the tool list asked `DEEVY_AGENT_REPO` instead.
    const granted = permissions({ ...context(), input: { ...input, repository: true } });

    expect(granted).toMatchObject(
      Object.fromEntries(repositoryPermissions.map((name) => [name, expect.anything()])),
    );
  });

  it("grants only the deevy tools when there is no repository", () => {
    expect(permissions(context())).toEqual({
      "*": "deny",
      ...Object.fromEntries(deevyTools.map((tool) => [tool, "allow"])),
    });
    expect(repositoryPermissions).toEqual([
      "read",
      "list",
      "glob",
      "grep",
      "edit",
      "bash",
      "webfetch",
      "websearch",
    ]);
    expect(deniedCommands).toEqual({});
  });

  it("writes the denial of everything first, because the last matching rule wins", () => {
    for (const cfg of [config, withRepo]) {
      const keys = Object.keys(permissions(context(cfg)));
      expect(keys[0]).toBe("*");
      // `bash` is a bare "allow" now that nothing under it is denied; a rule
      // with patterns would still have to put the catch-all first.
      const bash = permissions(context(cfg)).bash as Record<string, string> | string | undefined;
      if (bash && typeof bash === "object") expect(Object.keys(bash)[0]).toBe("*");
    }
  });

  it("never leaves a rule at ask, because a prompt nobody answers ends the turn", () => {
    // `opencode run` rejects an `ask` on the model's behalf and the turn ends
    // as if the session had finished, with no error to show for it. Every
    // rule is therefore allow or deny, and this is where that is pinned.
    for (const cfg of [config, withRepo]) {
      const values = leaves(permissions(context(cfg)));
      expect(values).not.toContain("ask");
      expect(values.every((value) => value === "allow" || value === "deny")).toBe(true);
    }
  });

  it("grants tools by name, so deevy widening is not this program widening", () => {
    expect(deevyTools.some((tool) => tool.includes("*"))).toBe(false);
    expect(deevyTools).not.toContain("deevy_gates_approve");
    const permission = permissions(context(withRepo));
    // The one wildcard is the denial; `deevy_*` would grant a twenty-first tool.
    expect(Object.keys(permission).filter((key) => key.includes("*"))).toEqual(["*"]);
    expect(permission["*"]).toBe("deny");
  });

  it("selects the agent the configuration defines, whose prompt is the instructions file", () => {
    const argv = opencode.argv(context());
    const agent = inlineConfig(context()).agent as Record<string, { prompt: string }>;

    expect(argv.slice(argv.indexOf("--agent"), 2 + argv.indexOf("--agent"))).toEqual([
      "--agent",
      agentName,
    ]);
    expect(agent[agentName]?.prompt).toBe("{file:/app/dist/instructions.md}");
  });
});

describe("what the session may read from disk", () => {
  it("strips what a repository could ship to configure the CLI, and keeps its input", () => {
    // `AGENTS.md` and `CLAUDE.md` are input, and input is untrusted rather
    // than forbidden (ADR-0014). `opencode.json` would add a server or a
    // permission and `.opencode/` an agent, a command or a plugin; the flag
    // in the environment says no to them, and the strip list is the second
    // fence.
    expect(opencode.strip).toEqual(["opencode.json", "opencode.jsonc", ".opencode"]);
  });

  it("gives the session a home of its own, its credential, and the recipe's own variables", () => {
    const environment = environmentFor(
      opencode,
      withRepo,
      "/tmp/deevy-home-x",
      env,
      context(withRepo),
    );

    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/deevy-home-x",
      ANTHROPIC_API_KEY: "sk-ant-x",
      OPENCODE_CONFIG_CONTENT: JSON.stringify(inlineConfig(context(withRepo))),
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
    });
    // The operator's own OpenCode settings are not the session's.
    expect(environment).not.toHaveProperty("OPENCODE_CONFIG");
    expect(environment).not.toHaveProperty("OPENCODE_PERMISSION");
  });

  it("never carries a secret, because a shell can read its own environment and its parent's arguments", () => {
    const cfg = { ...withRepo, key: "deevy_sk_secret" };
    const argv = opencode.argv(context(cfg));
    const extra = opencode.extraEnv?.(context(cfg)) ?? {};

    for (const text of [JSON.stringify(argv), JSON.stringify(extra)]) {
      expect(text).not.toContain("deevy_sk_secret");
      expect(text).not.toContain("ghp_secret");
      expect(text).not.toContain("DEEVY_");
      expect(text).not.toContain("Authorization");
      expect(text).not.toContain("{env:");
    }
  });

  it("requires nothing by name, and passes the provider variables and no prefix", () => {
    expect(opencode.env.requires).toEqual([]);
    expect(opencode.env.names).toEqual(providerVariables);
    expect(providerVariables).toContain("ANTHROPIC_API_KEY");
    expect(providerVariables).toContain("OPENAI_API_KEY");
    expect(providerVariables).toContain("OPENROUTER_API_KEY");
    // `OPENCODE_` is how this recipe configures the session, and a prefix
    // would let the operator's own settings in.
    expect(opencode.env.prefixes).toEqual([]);
    expect(providerVariables.filter((name) => name.startsWith("OPENCODE_"))).toEqual([
      "OPENCODE_API_KEY",
    ]);
  });

  it("has its extra variables applied by the runner, after the allowlist", async () => {
    // A harness whose binary is `node` and whose script prints what the
    // recipe set: the proof that `extraEnv` reaches the process.
    const harness: Harness = {
      name: "fake",
      binary: process.execPath,
      env: { requires: [], names: [], prefixes: [] },
      strip: [],
      extraEnv: () => ({ FAKE_INLINE: "from the recipe" }),
      argv: () => [
        "-e",
        'console.log(JSON.stringify({ type: "text", text: process.env.FAKE_INLINE + "|" + (process.env.HOME ?? "") }))',
      ],
      parse: (line) => [JSON.parse(line) as SessionEvent],
      bounds: "a test",
    };
    const events: SessionEvent[] = [];
    for await (const event of runHarness(
      harness,
      {
        config,
        input: { ...input, cwd: process.cwd(), signal: new AbortController().signal },
        home: "/tmp/deevy-home-y",
        instructions: "/x",
      },
      { env: { PATH: process.env.PATH, FAKE_INLINE: "from the operator" } },
    )) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "text", text: "from the recipe|/tmp/deevy-home-y" });
  });
});

describe("reading the stream", () => {
  /**
   * `session.jsonl` is authored from OpenCode 1.18.29's source (the part
   * schemas and the `run` command's emitter), because no provider on the
   * recording machine could complete a run; every line carries `_authored`,
   * which the parser ignores as it ignores any field it does not read.
   * `no-credential.jsonl` is the one line 1.18.29 really wrote, with an empty
   * home and no key (docs/plans/harnesses.md, convention 25).
   */
  it("replays a recorded session into the seam's events", async () => {
    const events = await fixture("session.jsonl");

    expect(events.map((event) => event.type)).toEqual(["ready", "tool", "denied", "text", "done"]);
    expect(events[0]).toEqual({ type: "ready", tools: [], servers: [] });
    expect(events[1]).toEqual({ type: "tool", name: "deevy_issues_get" });
    expect(events[2]).toMatchObject({ type: "denied", name: "bash" });
    expect((events[2] as Extract<SessionEvent, { type: "denied" }>).reason).toContain(
      "git push origin main",
    );
    expect((events[3] as Extract<SessionEvent, { type: "text" }>).text).toContain("refused");
    const done = events[4] as Extract<SessionEvent, { type: "done" }>;
    expect(done).toMatchObject({ type: "done", ok: true });
    expect(done.detail).toContain("issues_get returned DEV-1");
    // Summed over both steps: OpenCode reports usage per step, reasoning with
    // the output and the cache apart.
    expect(done.usage?.models).toHaveLength(1);
    expect(done.usage?.models[0]).toMatchObject({
      model: null,
      inputTokens: 2000,
      outputTokens: 210,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(done.usage?.models[0]?.costUsd).toBeCloseTo(0.0045, 6);
  });

  it("replays the run a session with no provider key gets", async () => {
    const events = await fixture("no-credential.jsonl");

    expect(events).toEqual([
      { type: "ready", tools: [], servers: [] },
      {
        type: "done",
        ok: false,
        detail: "UnknownError: Unexpected server error. Check server logs for details.",
      },
    ]);
  });

  it("counts an ask the CLI rejected on the model's behalf as a denial, since nobody was asked", () => {
    const rejected = JSON.stringify({
      type: "tool_use",
      sessionID: "ses_a",
      part: {
        type: "tool",
        tool: "edit",
        state: {
          status: "error",
          input: { filePath: "/tmp/run/README.md" },
          error: "The user rejected permission to use this specific tool call.",
        },
      },
    });

    expect(toSessionEvents(rejected).filter((event) => event.type !== "ready")).toEqual([
      {
        type: "denied",
        name: "edit",
        reason: "The user rejected permission to use this specific tool call: /tmp/run/README.md",
      },
    ]);
  });

  it("calls a tool that ran and failed a tool, not a denial", () => {
    const failed = JSON.stringify({
      type: "tool_use",
      sessionID: "ses_b",
      part: {
        type: "tool",
        tool: "deevy_issues_get",
        state: { status: "error", input: { key: "DEV-9" }, error: "No such Issue" },
      },
    });

    expect(toSessionEvents(failed).filter((event) => event.type !== "ready")).toEqual([
      { type: "tool", name: "deevy_issues_get" },
    ]);
  });

  it("ends badly on a step that stopped for any reason but stop", () => {
    const length = JSON.stringify({
      type: "step_finish",
      sessionID: "ses_c",
      part: {
        type: "step-finish",
        reason: "length",
        cost: 0.01,
        tokens: { input: 5, output: 7, cache: { read: 40, write: 3 } },
      },
    });

    expect(toSessionEvents(length).filter((event) => event.type !== "ready")).toEqual([
      {
        type: "done",
        ok: false,
        detail: "The session ended: length",
        usage: {
          models: [
            {
              model: null,
              inputTokens: 5,
              outputTokens: 7,
              cacheReadTokens: 40,
              cacheWriteTokens: 3,
              costUsd: 0.01,
            },
          ],
        },
      },
    ]);
  });

  it("says ready once per session, and forgets a session when it is done", () => {
    const start = JSON.stringify({
      type: "step_start",
      sessionID: "ses_d",
      part: { type: "step-start" },
    });
    const finish = JSON.stringify({
      type: "step_finish",
      sessionID: "ses_d",
      part: { type: "step-finish", reason: "stop", cost: 0, tokens: { input: 0, output: 0 } },
    });

    expect(toSessionEvents(start)).toEqual([{ type: "ready", tools: [], servers: [] }]);
    expect(toSessionEvents(start)).toEqual([]);
    expect(toSessionEvents(finish)).toEqual([{ type: "done", ok: true, detail: "" }]);
    // The same id again is a new session to the parser.
    expect(toSessionEvents(start)).toEqual([{ type: "ready", tools: [], servers: [] }]);
    toSessionEvents(finish);
  });

  it("ignores the lines the supervisor has no opinion about, and lines that are not JSON", () => {
    expect(
      toSessionEvents(JSON.stringify({ type: "reasoning", sessionID: "ses_e", part: {} })),
    ).toEqual([{ type: "ready", tools: [], servers: [] }]);
    expect(
      toSessionEvents(JSON.stringify({ type: "reasoning", sessionID: "ses_e", part: {} })),
    ).toEqual([]);
    expect(toSessionEvents(JSON.stringify({ type: "text" }))).toEqual([]);
    expect(toSessionEvents("not json")).toEqual([]);
    toSessionEvents(JSON.stringify({ type: "error", sessionID: "ses_e" }));
  });
});
