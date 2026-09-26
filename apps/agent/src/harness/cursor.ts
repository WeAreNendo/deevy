import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionEvent } from "../session.ts";
import { deevyToolNames } from "../tools.ts";
import type { Harness, HarnessContext } from "./contract.ts";

/** The name the deevy MCP server is registered under in the session's `mcp.json`. */
export const serverName = "deevy";

/**
 * The deevy tools, as a Cursor permission rule names an MCP tool:
 * `Mcp(<server>:<tool>)`, matched case-insensitively with `*` as a glob. Per
 * tool rather than `Mcp(deevy:*)`, so deevy gaining a tool is not this runtime
 * gaining one (ADR-0014). The proxy is the first fence around these names
 * (src/proxy.ts); this list is the second.
 */
export const deevyTools: ReadonlyArray<string> = deevyToolNames.map(
  (tool) => `Mcp(${serverName}:${tool})`,
);

/**
 * What the session gets on top of deevy when it has a repository to work in,
 * as Cursor's permission rules: the file tools for the checkout and the shell
 * for the build and the tests. Cursor's `Read`/`Write` rules take a path glob
 * and `Shell` a command pattern; `**` and `*` are both "anything" to its
 * matcher, which turns a rule into an anchored regular expression.
 */
export const repositoryTools: ReadonlyArray<string> = ["Read(**)", "Write(**)", "Shell(*)"];

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
 * What is refused when there is no repository. Under `--force` every tool is
 * allowed unless a deny rule names it, so "no shell without a repository" —
 * which the other recipes get by not granting one — has to be said as a
 * denial here. Without these a session with an empty working directory would
 * still hold a shell and the network, which is not a default worth having
 * (docs/plans/m4.md).
 */
export const deniedWithoutRepository: ReadonlyArray<string> = [
  "Read(**)",
  "Write(**)",
  "Shell(*)",
  "WebFetch(*)",
];

/**
 * The global configuration Cursor reads from `~/.cursor/cli-config.json` —
 * the session's own home, which the runner makes and removes. `version` and
 * `editor.vimMode` are the two fields the CLI insists on and repairs when
 * absent; everything else it fills in with its defaults, which is fine,
 * because the only field that bounds anything is `permissions`.
 */
export function cliConfig(context: HarnessContext): Record<string, unknown> {
  const repo = context.input.repository;
  return {
    version: 1,
    editor: { vimMode: false },
    permissions: {
      allow: repo ? [...deevyTools, ...repositoryTools] : [...deevyTools],
      deny: repo ? [...deniedTools] : [...deniedWithoutRepository],
    },
  };
}

/**
 * The MCP configuration Cursor reads from `~/.cursor/mcp.json`, the same file
 * the editor uses. The deevy server is the supervisor's loopback proxy, over
 * HTTP, with **no header and no secret**: the session never holds the Agent's
 * key, whichever harness it is (src/proxy.ts). Cursor infers the transport
 * from `url`; there is no `type` to give.
 */
export function mcpConfig(context: HarnessContext): Record<string, unknown> {
  return { mcpServers: { [serverName]: { url: context.input.mcpUrl } } };
}

/**
 * The prompt the session is given: the supervisor's instructions, then the
 * Run's own. Cursor reads rules from the workspace (`.cursor/rules`,
 * `AGENTS.md`, `CLAUDE.md`, `.cursorrules`) and from the account, and has no
 * rules directory under the home and no system-prompt flag, so the one place
 * the runtime can put text the model must read is the prompt itself. The
 * repository's own rule files are still read, as input (ADR-0014).
 */
export function promptFor(context: HarnessContext): string {
  const instructions = readFileSync(context.instructions, "utf8").trim();
  return `${instructions}\n\n---\n\n${context.input.prompt}`;
}

/**
 * Cursor CLI, headless: `agent -p --output-format stream-json`, driven from
 * two files the supervisor writes into the session's home (ADR-0018).
 *
 * The boundary is the argv and those two files, each asserted whole by a
 * test. `--force` is what makes print mode apply edits and run commands
 * instead of proposing them, and it makes the allow list documentation: under
 * it everything is allowed unless a deny rule names it, so the deny list is
 * the fence, and it is checked before any allow and before `--force`. Nothing
 * on disk configures the session: `--disable-project-configs` turns off the
 * clone's `.cursor/cli.json` — which would otherwise be merged in a way that
 * lets a repository *replace* the deny list, since arrays are not merged but
 * overwritten — and the strip list removes `.cursor/` anyway, which is also
 * where a repository would ship an `mcp.json` that `--approve-mcps` would
 * trust. The MCP server is the supervisor's loopback proxy with no credential
 * (src/proxy.ts).
 */
export const cursor: Harness = {
  name: "cursor",
  // The installer links both `agent` and `cursor-agent` to the same script;
  // `agent` is the primary name and `cursor-agent` the legacy one.
  binary: "agent",
  env: {
    // Named exactly and never as a prefix: `CURSOR_CONFIG_DIR` and
    // `CURSOR_DATA_DIR` would point the CLI at the operator's configuration
    // instead of the session's home, and `CURSOR_API_ENDPOINT` at somebody
    // else's API. The key is the one thing the session is meant to hold.
    requires: ["CURSOR_API_KEY"],
    names: ["CURSOR_API_KEY"],
    prefixes: [],
  },
  // What a repository could ship to configure this CLI: `.cursor/cli.json`
  // (permissions), `.cursor/mcp.json` (servers), `.cursor/hooks.json`, and
  // the rest of that directory. `.cursor/rules`, `AGENTS.md`, `CLAUDE.md` and
  // `.cursorrules` are input, which is untrusted rather than forbidden
  // (ADR-0014); the rules directory goes with `.cursor/`, and that is the one
  // piece of input this recipe loses.
  strip: [".cursor"],
  async prepare(context: HarnessContext): Promise<void> {
    const directory = join(context.home, ".cursor");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "cli-config.json"),
      `${JSON.stringify(cliConfig(context), null, 2)}\n`,
    );
    await writeFile(
      join(directory, "mcp.json"),
      `${JSON.stringify(mcpConfig(context), null, 2)}\n`,
    );
  },
  argv(context: HarnessContext): string[] {
    const { config, input } = context;
    return [
      "-p",
      "--output-format",
      "stream-json",
      // Apply edits and run commands rather than propose them; refuse what a
      // deny rule names. `bypassPermissions` has no equivalent here, and
      // `--yolo` is only this flag's alias.
      "--force",
      // The deevy server needs no login and no approval prompt: this answers
      // the prompt nobody is here to answer. It would also trust a server the
      // clone shipped in `.cursor/mcp.json`, which is why that file is stripped.
      "--approve-mcps",
      // The workspace-trust prompt, answered the same way; a per-Run working
      // directory is never one the CLI has seen before.
      "--trust",
      // The clone's `.cursor/cli.json` is not read, whatever the strip list
      // missed. Undocumented but accepted by the pinned version: the CLI
      // refuses an unknown flag, so a version that dropped it fails loudly.
      "--disable-project-configs",
      "--workspace",
      input.cwd,
      // Cursor's own model names (`agent --list-models`); `DEEVY_AGENT_EFFORT`
      // is not read, because there is no effort flag. A parameterized model
      // takes it in the name instead: `claude-opus-4-8[effort=high]`.
      "--model",
      config.model,
      // The prompt last, as the positional argument, carrying the
      // instructions (see `promptFor`).
      promptFor(context),
    ];
  },
  parse: toSessionEvents,
  bounds: [
    "**Cursor CLI** runs under `--force`, which applies edits and runs commands instead of proposing",
    "them and allows every tool a deny rule does not name, so the fence is the `permissions.deny` list",
    "the runtime writes into the session's own `~/.cursor/cli-config.json`: nothing when there is a",
    "repository, since the session runs git and where it may push is the token's scope and the forge's",
    "own protections (ADR-0019), and every file, shell and web tool when there is",
    "not. Nothing on disk configures the session: the clone's `.cursor/` is removed before it starts",
    "(a project `.cursor/cli.json` would otherwise *replace* the deny list, and a `.cursor/mcp.json`",
    "would be trusted by `--approve-mcps`), `--disable-project-configs` refuses it anyway, and the only",
    "MCP server is the runtime's proxy, with no header. A refused tool is a `tool_call` completed with a",
    '`rejected` result and the CLI\'s own sentence, "Command is not allowed", which the runtime writes',
    "into the Run's feed. Not bounded: what `Shell` runs in the repository, the network, tokens (usage",
    "is reported, cost is not), and `DEEVY_AGENT_EFFORT`, which this harness does not read.",
  ].join(" "),
};

/** As much of one Cursor stream-json line as the runtime reads. */
interface StreamMessage {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
  tool_call?: Record<string, ToolCall | undefined>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

/** One member of the `tool_call` union: `shellToolCall`, `mcpToolCall`, `readToolCall`, … */
interface ToolCall {
  args?: { command?: string; path?: string; providerIdentifier?: string; toolName?: string };
  result?: {
    rejected?: { reason?: string };
    permissionDenied?: { error?: string };
  };
}

/**
 * The name the Run's feed shows for a tool: an MCP call as `mcp__<server>__<tool>`,
 * the way Claude Code names one, so a feed reads the same whichever harness
 * worked the Run; anything else by its Cursor name with the `ToolCall` suffix
 * dropped (`Shell`, `Read`, `Write`, `WebFetch`).
 */
function toolName(kind: string, call: ToolCall): string {
  if (kind === "mcpToolCall") {
    const { providerIdentifier = "?", toolName: tool = "?" } = call.args ?? {};
    return `mcp__${providerIdentifier}__${tool}`;
  }
  const bare = kind.replace(/ToolCall$/, "");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/**
 * What the runtime reads out of one line of the stream.
 *
 * Five kinds of line matter. The `system`/`init` line is the session coming
 * up, and it lists neither tools nor servers, so `ready` carries none. A
 * `tool_call` `started` is a call; a `tool_call` `completed` whose result is
 * `rejected` or `permissionDenied` is a refusal — Cursor has no separate
 * denial message, the refusal is the tool's own result — and any other
 * completion is the tool having run. An `assistant` line is text, one per
 * segment between tool calls in print mode. The `result` line is the end, with
 * `usage` when the model reported tokens; there is no cost. Anything else
 * (`user`, `thinking`, `interaction_query`) and any unknown field such as
 * `_authored` is ignored: events are chosen by `type`, never by the fields
 * around it.
 */
export function toSessionEvents(line: string): SessionEvent[] {
  let message: StreamMessage;
  try {
    message = JSON.parse(line) as StreamMessage;
  } catch {
    return [];
  }
  if (message.type === "system" && message.subtype === "init") {
    return [{ type: "ready", tools: [], servers: [] }];
  }
  if (message.type === "tool_call") {
    const entry = Object.entries(message.tool_call ?? {}).find(([, call]) => call !== undefined);
    if (!entry) return [];
    const [kind, call] = entry as [string, ToolCall];
    const name = toolName(kind, call);
    if (message.subtype === "started") return [{ type: "tool", name }];
    if (message.subtype === "completed") {
      const refused = call.result?.rejected?.reason ?? call.result?.permissionDenied?.error;
      if (refused === undefined) return [];
      const target = call.args?.command ?? call.args?.path;
      return [{ type: "denied", name, reason: target ? `${refused}: ${target}` : refused }];
    }
    return [];
  }
  if (message.type === "assistant") {
    const events: SessionEvent[] = [];
    for (const block of message.message?.content ?? []) {
      if (block.type === "text" && block.text) events.push({ type: "text", text: block.text });
    }
    return events;
  }
  if (message.type === "result") {
    const ok = message.subtype === "success" && !message.is_error;
    // Tokens and the cache, and no cost: Cursor prices nothing. It names no
    // model here either, so the runner names the one it asked for.
    const usage = message.usage
      ? {
          models: [
            {
              model: null,
              inputTokens: message.usage.inputTokens ?? 0,
              outputTokens: message.usage.outputTokens ?? 0,
              cacheReadTokens: message.usage.cacheReadTokens ?? 0,
              cacheWriteTokens: message.usage.cacheWriteTokens ?? 0,
            },
          ],
        }
      : undefined;
    return [
      {
        type: "done",
        ok,
        detail: ok
          ? (message.result ?? "")
          : `The session ended: ${message.subtype ?? "unknown"}${message.result ? `: ${message.result}` : ""}`,
        ...(usage ? { usage } : {}),
      },
    ];
  }
  return [];
}
