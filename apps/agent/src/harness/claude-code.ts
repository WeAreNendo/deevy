import type { ModelUsage, SessionEvent, Usage } from "../session.ts";
import { deevyToolNames } from "../tools.ts";
import type { Harness, HarnessContext } from "./contract.ts";

/** The deevy tools, namespaced the way Claude Code sees an MCP tool. */
export const deevyTools: ReadonlyArray<string> = deevyToolNames.map(
  (tool) => `mcp__deevy__${tool}`,
);

/**
 * What the session gets on top of deevy when it has a repository to work in.
 *
 * Each one is here for a reason: the file tools for the checkout, `Bash` for
 * the build and the tests, and the web tools for documentation an Issue points
 * at. Without a repository none of these are granted — a shell with nothing to
 * run is not a default worth having, and the tool surface following the
 * configuration means nobody gets one by forgetting (docs/plans/m4.md).
 */
export const repositoryTools: ReadonlyArray<string> = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "WebSearch",
  "WebFetch",
];

/**
 * Nothing is refused. The session runs git, reaching the world through the
 * supervisor's proxy, so the credential is still the supervisor's and where an
 * Agent may push is the scope of the token the operator issued and whatever
 * the forge protects — both enforced by somebody other than us, which is the
 * argument for preferring them to a list written here (ADR-0019). What the
 * runtime does instead is record every ref a Run moved (src/refs.ts).
 *
 * `gh` is not denied and is not given a credential either: it wants a token of
 * its own, and the proxy has none to hand it.
 */
export const deniedTools: ReadonlyArray<string> = [];

/**
 * Claude Code, headless: `claude -p` with the stream the Agent SDK reads,
 * driven directly (ADR-0018).
 *
 * The argv is the whole security boundary for this harness and is asserted
 * whole by a test. Each flag answers one of ADR-0014's bounds: the tools are
 * granted by name and refused rather than parked (`--allowedTools`,
 * `--permission-prompts none`), nothing on disk configures the session
 * (`--setting-sources ""`, `--strict-mcp-config`, and the strip list for the
 * files a repository could ship), and the MCP server is the supervisor's
 * loopback proxy with no credential (src/proxy.ts).
 */
export const claudeCode: Harness = {
  name: "claude-code",
  binary: "claude",
  env: {
    // Nothing is required: on a laptop Claude Code may be signed in, and in a
    // container `ANTHROPIC_API_KEY` is how it is given a credential. `CLAUDE_`
    // is deliberately not a prefix here: that is the host tooling's own state,
    // and inheriting it is what let a session authenticate as somebody's editor.
    requires: [],
    names: [],
    prefixes: ["ANTHROPIC_"],
  },
  // What a repository could ship to configure this CLI. `CLAUDE.md` stays: it
  // is input, and input is untrusted rather than forbidden (ADR-0014).
  strip: [".mcp.json", ".claude"],
  argv({ config, input, instructions }: HarnessContext): string[] {
    const tools = input.repository ? [...deevyTools, ...repositoryTools] : [...deevyTools];
    return [
      // The prompt first: the tool lists below are variadic and would take a
      // positional argument after them as one more tool.
      "-p",
      input.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      // The supervisor's proxy, with no credential (src/proxy.ts). A person's
      // `.mcp.json` names deevy's own endpoint and carries the header instead
      // (docs/agent-loop.md); the difference is who holds the key.
      "--mcp-config",
      JSON.stringify({ mcpServers: { deevy: { type: "http", url: input.mcpUrl } } }),
      "--strict-mcp-config",
      // No settings from anywhere: not the session's home, not the clone.
      "--setting-sources",
      "",
      // Nobody is here to answer a prompt, so anything not granted is refused
      // rather than parked. `bypassPermissions` appears nowhere in this
      // repository: an allowlist grants what was meant and nothing else.
      "--permission-mode",
      "default",
      "--permission-prompts",
      "none",
      "--allowedTools",
      ...tools,
      // Only when there is something to deny: the flag with no values after it
      // would take the next flag as one.
      ...(input.repository && deniedTools.length > 0 ? ["--disallowedTools", ...deniedTools] : []),
      "--append-system-prompt-file",
      instructions,
      "--model",
      config.model,
      "--effort",
      config.effort,
      "--max-turns",
      String(config.maxTurns),
    ];
  },
  parse: toSessionEvents,
  bounds: [
    "**Claude Code** is granted its tools by name (`--allowedTools`), refuses anything else rather than",
    'asking (`--permission-prompts none`), loads no settings from disk (`--setting-sources ""`) and no',
    "MCP server but the runtime's proxy (`--strict-mcp-config`); `.mcp.json` and `.claude/` are removed",
    "from the clone before it starts, and `CLAUDE.md` is read as input. A refused tool is a",
    "`permission_denied` message in its stream, which the runtime writes into the Run's feed. Not bounded:",
    "what `Bash` runs in the repository, the network, and tokens.",
  ].join(" "),
};

/** As much of one Claude Code stream-json message as the runtime reads. */
interface StreamMessage {
  type?: string;
  subtype?: string;
  tools?: string[];
  mcp_servers?: Array<{ name: string; status: string }>;
  tool_name?: string;
  decision_reason?: string;
  message?: { content?: Array<{ type: string; name?: string; text?: string }> } | string;
  is_error?: boolean;
  result?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
  /**
   * Every model the session used — its subagents' too — with the prompt cache
   * and each one's cost. The Agent SDK's `usage` is the main loop's alone, and
   * it says so: "Prefer modelUsage for token/cost accounting".
   */
  modelUsage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
      costUSD?: number;
      costBasis?: string;
    }
  >;
}

const costBases = new Set(["list", "managed", "unknown"]);

/** What a result says the session spent: per model where it can, the main loop where it cannot. */
function usageOf(message: StreamMessage): Usage | undefined {
  const perModel = Object.entries(message.modelUsage ?? {});
  if (perModel.length > 0) {
    return {
      models: perModel.map(([model, spent]) => ({
        model,
        inputTokens: spent.inputTokens ?? 0,
        outputTokens: spent.outputTokens ?? 0,
        cacheReadTokens: spent.cacheReadInputTokens ?? 0,
        cacheWriteTokens: spent.cacheCreationInputTokens ?? 0,
        ...(spent.costUSD === undefined ? {} : { costUsd: spent.costUSD }),
        ...(spent.costBasis && costBases.has(spent.costBasis)
          ? { costBasis: spent.costBasis as ModelUsage["costBasis"] }
          : {}),
      })),
    };
  }
  if (!message.usage) return undefined;
  return {
    models: [
      {
        model: null,
        inputTokens: message.usage.input_tokens ?? 0,
        outputTokens: message.usage.output_tokens ?? 0,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        ...(message.total_cost_usd === undefined ? {} : { costUsd: message.total_cost_usd }),
      },
    ],
  };
}

/**
 * What the runtime reads out of one line of the stream.
 *
 * The stream is the Agent SDK's message union, which has dozens of members and
 * grows; the supervisor cares about four things. Keeping the narrowing here
 * means a new message kind is a no-op rather than an error somewhere that
 * reasons about Runs.
 */
export function toSessionEvents(line: string): SessionEvent[] {
  let message: StreamMessage;
  try {
    message = JSON.parse(line) as StreamMessage;
  } catch {
    return [];
  }
  if (message.type === "system" && message.subtype === "init") {
    return [{ type: "ready", tools: message.tools ?? [], servers: message.mcp_servers ?? [] }];
  }
  if (message.type === "system" && message.subtype === "permission_denied") {
    // The message names the call (the command, the path) and the reason says
    // why; a Human reading the Run needs the first as much as the second.
    const said = typeof message.message === "string" ? message.message : "";
    const why = message.decision_reason ?? "";
    return [
      {
        type: "denied",
        name: message.tool_name ?? "?",
        reason: said && why ? `${said} (${why})` : said || why,
      },
    ];
  }
  if (message.type === "assistant" && typeof message.message === "object") {
    const events: SessionEvent[] = [];
    for (const block of message.message.content ?? []) {
      if (block.type === "tool_use" && block.name) events.push({ type: "tool", name: block.name });
      if (block.type === "text" && block.text) events.push({ type: "text", text: block.text });
    }
    return events;
  }
  if (message.type === "result") {
    const ok = message.subtype === "success" && !message.is_error;
    const usage = usageOf(message);
    return [
      {
        type: "done",
        ok,
        // An error result carries no prose, so its subtype is the whole of what
        // the CLI is willing to say, and it is what the Run's error Activity
        // will quote.
        detail:
          message.subtype === "success"
            ? (message.result ?? "")
            : `The session ended: ${message.subtype ?? "unknown"}`,
        ...(usage ? { usage } : {}),
      },
    ];
  }
  return [];
}
