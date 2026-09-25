import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionEvent } from "../session.ts";
import { deevyToolNames } from "../tools.ts";
import type { Harness, HarnessContext } from "./contract.ts";

/** The name the deevy MCP server is registered under, and that `--agent` selects. */
export const serverName = "deevy";
export const agentName = "deevy";

/**
 * The deevy tools, as Copilot's `--allow-tool` names an MCP tool: the server
 * name, then the tool in parentheses (`deevy(issues_get)`). The proxy already
 * filters the tool list and refuses a call to anything else (src/proxy.ts);
 * these are the second fence, granting the same names to Copilot's own
 * permission layer so an allowed deevy tool is not parked on a prompt.
 */
export const deevyTools: ReadonlyArray<string> = deevyToolNames.map(
  (tool) => `${serverName}(${tool})`,
);

/**
 * What the session gets on top of deevy when it has a repository to work in,
 * as Copilot's permission kinds. `read` and `write` are the built-in file
 * tools, `shell` is every shell command; there is no separate web kind, and
 * `--allow-all-urls` governs the shell and fetch tools' network access. Passed
 * as one comma-separated value, which is the form the CLI documents. Without a
 * repository none of these are granted — a shell with nothing to run is not a
 * default worth having, and the tool surface follows the configuration
 * (docs/plans/m4.md).
 */
export const repositoryTools = "read,write,shell";

/**
 * What is refused even where `shell` is otherwise allowed. The supervisor owns
 * git and the credential to use it, so a session reaching for a push or a pull
 * request is a bug rather than initiative (ADR-0014). Copilot's `shell(cmd:*)`
 * matches a first-level subcommand by prefix, and a `--deny-tool` beats an
 * `--allow-tool` (deny always wins), so these come alongside the `shell` grant.
 * Only meaningful when there is a repository: with no repository `shell` is not
 * granted at all and every command is refused already.
 */
export const deniedTools: ReadonlyArray<string> = [];

/** Where Copilot keeps its configuration and state: a subdirectory of the session's own home. */
export function copilotHome(context: HarnessContext): string {
  return join(context.home, "copilot");
}

/**
 * The MCP configuration Copilot reads from `COPILOT_HOME/mcp-config.json`. The
 * deevy server is the supervisor's loopback proxy, over HTTP, with **no header
 * and no secret**: the session never holds the Agent's key, whichever harness
 * it is (src/proxy.ts). The `tools` filter scopes what the server exposes to
 * the granted names, the same list the proxy enforces.
 */
export function mcpConfig(context: HarnessContext): Record<string, unknown> {
  return {
    mcpServers: {
      [serverName]: {
        type: "http",
        url: context.input.mcpUrl,
        tools: [...deevyToolNames],
      },
    },
  };
}

/**
 * The custom agent file `--agent deevy` selects, at `COPILOT_HOME/agents/
 * deevy.agent.md`. Copilot reads its Markdown body into the session's system
 * prompt (as the "selected agent instructions"), which is how the supervisor's
 * `instructions.md` reaches a Copilot session; a prompt prefix was the fallback
 * and is not needed. The repository's `.github/copilot-instructions.md` and
 * `AGENTS.md` are still read, as input (ADR-0014).
 */
export function agentFile(instructions: string): string {
  return [
    "---",
    `name: ${agentName}`,
    "description: Works one deevy Run: reads the Issue, writes the Document, stops at the Gate.",
    "---",
    "",
    instructions,
  ].join("\n");
}

/**
 * GitHub Copilot CLI, headless: `copilot -p` with `--output-format json`
 * (ADR-0018).
 *
 * The boundary is the argv and the two files `prepare` writes. Tools are
 * granted by name and, in `-p` without `--allow-all-tools`, anything not
 * granted is auto-refused rather than parked on a prompt (`--no-ask-user`
 * removes the last question). The built-in GitHub MCP server is disabled
 * (`--disable-builtin-mcps`), the session is not exported to GitHub web or
 * mobile (`--no-remote-export`), and the token is stripped from the shell's
 * environment and redacted from output (`--secret-env-vars`). Nothing on disk
 * configures the session: the working directory is deliberately left
 * *untrusted* (the recipe never writes `trustedFolders`), and folder trust is
 * what would otherwise make Copilot load a repository's `.mcp.json`,
 * `.github/mcp.json`, hooks and plugins — so there is no strip list to keep.
 */
export const copilot: Harness = {
  name: "copilot",
  binary: "copilot",
  env: {
    // The session's shell will see this token, so it must be a fine-grained PAT
    // with the "Copilot Requests" permission and **no repository permission** —
    // distinct from the git token the supervisor holds (see `prepare`). `GH_`
    // is not a prefix: the operator's `GH_TOKEN`/`GITHUB_TOKEN` would otherwise
    // authenticate the session as themselves, with whatever scopes they carry.
    requires: ["COPILOT_GITHUB_TOKEN"],
    names: ["COPILOT_GITHUB_TOKEN"],
    prefixes: [],
  },
  // Nothing: with folder trust off (the recipe never trusts the working
  // directory) a repository's `.mcp.json`, `.github/mcp.json`, hooks and
  // plugins are not read, and `.github/copilot-instructions.md` and `AGENTS.md`
  // are input, which is untrusted rather than forbidden (ADR-0014).
  strip: [],
  extraEnv(context: HarnessContext): Record<string, string> {
    // Copilot reads its configuration and writes its state under this
    // directory. It is inside the session's own home, which the runner makes
    // and removes, so the operator's `~/.copilot` is never the session's.
    return { COPILOT_HOME: copilotHome(context) };
  },
  async prepare(context: HarnessContext): Promise<void> {
    // The session's shell sees `COPILOT_GITHUB_TOKEN`; if it were the git token
    // the supervisor holds, the `shell(git push:*)` denial would be a fence
    // around a key that opens the gate anyway. Refuse before a token is spent.
    const copilotToken = process.env.COPILOT_GITHUB_TOKEN;
    if (copilotToken && context.config.repo?.token === copilotToken) {
      throw new Error(
        "COPILOT_GITHUB_TOKEN must not be the git token the supervisor holds: it reaches the " +
          "session's shell, so it must be a fine-grained token with Copilot access and no " +
          "repository permission (DEEVY_AGENT_GIT_TOKEN is a different, repository-scoped token).",
      );
    }
    const home = copilotHome(context);
    await mkdir(join(home, "agents"), { recursive: true });
    await writeFile(join(home, "mcp-config.json"), JSON.stringify(mcpConfig(context), null, 2));
    const instructions = await readFile(context.instructions, "utf8");
    await writeFile(join(home, "agents", `${agentName}.agent.md`), agentFile(instructions));
  },
  argv({ config, input }: HarnessContext): string[] {
    return [
      // `-p` takes one value, so the prompt is safe before the variadic tool
      // flags; the machine-readable stream is JSONL, one object per line.
      "-p",
      input.prompt,
      "--output-format",
      "json",
      // No question is left for a session nobody is watching: the agent works
      // autonomously and anything not granted is refused, not prompted.
      "--no-ask-user",
      // A fresh home, so an update would be a download nobody asked for.
      "--no-auto-update",
      // The session is a Run's record in deevy, not a page on github.com: no
      // export to GitHub web or mobile, and no remote control of it from there.
      "--no-remote-export",
      // The built-in GitHub MCP server would reach GitHub with the Copilot
      // token; the only MCP server the session gets is deevy's proxy.
      "--disable-builtin-mcps",
      // Stripped from the shell and MCP environments and redacted from output:
      // the session's own bash cannot read the token it runs under.
      "--secret-env-vars",
      "COPILOT_GITHUB_TOKEN",
      // The instructions travel as this custom agent (prepare writes the file).
      "--agent",
      agentName,
      // The deevy tools by name; the proxy is the first fence and this the
      // second. Repeated rather than comma-joined so a tool name is never split.
      ...deevyTools.flatMap((tool) => ["--allow-tool", tool]),
      // The repository tools only when there is a repository, and the git
      // denials alongside them because deny beats allow.
      ...(input.repository
        ? ["--allow-tool", repositoryTools, ...deniedTools.flatMap((tool) => ["--deny-tool", tool])]
        : []),
      "--model",
      config.model,
    ];
  },
  parse: toSessionEvents,
  bounds: [
    "**GitHub Copilot CLI** is granted its tools by name (`--allow-tool`) and, in `-p` without",
    "`--allow-all-tools`, refuses anything else automatically rather than asking (`--no-ask-user`);",
    "the built-in GitHub MCP server is off (`--disable-builtin-mcps`) so the only server it reaches",
    "is the runtime's proxy, the session is not exported to GitHub (`--no-remote-export`), and the",
    "token is stripped from the shell it runs and redacted from output (`--secret-env-vars`). Nothing",
    "on disk configures the session: the working directory is left untrusted, which is what stops",
    "Copilot loading a repository's `.mcp.json`, `.github/mcp.json`, hooks or plugins, so no strip",
    "list is needed; `.github/copilot-instructions.md` and `AGENTS.md` are read as input. A refused",
    "tool is a `tool.execution_complete` with `error.code` `denied` in the JSON stream, which the",
    "runtime writes into the Run's feed. Not bounded: what `shell` runs in the repository, the",
    "network, and tokens; and Copilot's JSON stream reports premium-request counts and durations,",
    "not token or dollar totals, so a Run worked by Copilot carries no usage into its summary.",
  ].join(" "),
};

/** As much of one `copilot --output-format json` line as the runtime reads. */
interface StreamMessage {
  type?: string;
  exitCode?: number;
  data?: {
    servers?: Array<{ name?: string; status?: string }>;
    toolCallId?: string;
    toolName?: string;
    success?: boolean;
    error?: { message?: string; code?: string };
    content?: string;
  };
}

/**
 * What one session has said and called so far. `text` is the last assistant
 * message, so `done` can carry it as the Run's summary line the way the other
 * harnesses' results do. `tools` maps a call id to its tool's name, because the
 * name is only on the `tool.execution_start` line and a refusal is reported on
 * a later `tool.execution_complete` that carries the id alone. The supervisor
 * runs one session at a time (src/proxy.ts), so one entry apiece is enough;
 * `ready` clears both, so one session never inherits another's.
 */
let lastText = "";
let toolNames = new Map<string, string>();

/**
 * What the runtime reads out of one line of the stream.
 *
 * Copilot's JSONL carries dozens of message types, most of them the streaming
 * deltas and lifecycle events the supervisor has no opinion about. Four matter:
 * the servers-loaded line is the session coming up, a tool's start is a call,
 * a tool's completion carrying a `denied` code is a refusal, and the `result`
 * line is the end. There is no usage in that stream — token and cost totals
 * live only in a side file (`--usage-output-file`) the line runner does not
 * read — so `done` carries none, and repository-tool usage is invisible to the
 * feed. An unknown field such as `_authored` is ignored: events are chosen by
 * `type`, never by the fields around it.
 */
export function toSessionEvents(line: string): SessionEvent[] {
  let message: StreamMessage;
  try {
    message = JSON.parse(line) as StreamMessage;
  } catch {
    return [];
  }
  const data = message.data ?? {};

  if (message.type === "session.mcp_servers_loaded") {
    lastText = "";
    toolNames = new Map();
    const servers = (data.servers ?? []).map((server) => ({
      name: server.name ?? "?",
      status: server.status ?? "unknown",
    }));
    return [{ type: "ready", tools: [], servers }];
  }
  if (message.type === "tool.execution_start") {
    const name = data.toolName ?? "?";
    if (data.toolCallId) toolNames.set(data.toolCallId, name);
    return [{ type: "tool", name }];
  }
  if (message.type === "tool.execution_complete" && data.error?.code === "denied") {
    // The name is not on this line, only the id the start line carried.
    const name = (data.toolCallId && toolNames.get(data.toolCallId)) || data.toolName || "?";
    return [{ type: "denied", name, reason: data.error.message ?? "denied" }];
  }
  if (message.type === "assistant.message" && data.content) {
    lastText = data.content;
    return [{ type: "text", text: data.content }];
  }
  if (message.type === "result") {
    const ok = message.exitCode === 0;
    return [
      {
        type: "done",
        ok,
        detail: ok
          ? lastText || "The session ended"
          : `The session exited with code ${String(message.exitCode ?? "unknown")}`,
      },
    ];
  }
  return [];
}
