import type { SessionEvent, Usage } from "../session.ts";
import { deevyToolNames } from "../tools.ts";
import type { Harness, HarnessContext } from "./contract.ts";

/** The custom agent the inline configuration defines and `--agent` selects. */
export const agentName = "deevy";

/** The deevy tools, as OpenCode names an MCP tool: `<server>_<tool>`. */
export const deevyTools: ReadonlyArray<string> = deevyToolNames.map((tool) => `deevy_${tool}`);

/**
 * What the session gets on top of deevy when it has a repository to work in,
 * as OpenCode's permission names. `edit` covers `edit`, `write` and `patch`;
 * `list` is the directory listing; the web tools are for documentation an
 * Issue points at. Without a repository none of these are granted, for the
 * same reason as Claude Code's: a shell with nothing to run is not a default
 * worth having (docs/plans/m4.md).
 */
export const repositoryPermissions: ReadonlyArray<string> = [
  "read",
  "list",
  "glob",
  "grep",
  "edit",
  "bash",
  "webfetch",
  "websearch",
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
export const deniedCommands: Readonly<Record<string, "deny">> = {};

/**
 * The provider credentials OpenCode reads from the environment, for the
 * providers an operator is likely to hand it. Any other provider's variable
 * goes through `DEEVY_AGENT_PASS_ENV`. No prefix is allowed whole: `OPENCODE_`
 * is how this recipe configures the session and the operator's own OpenCode
 * settings must not reach it, and a `GOOGLE_` or `AWS_` would carry credentials
 * nobody meant to hand a shell.
 */
export const providerVariables: ReadonlyArray<string> = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENCODE_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "AZURE_API_KEY",
  "AZURE_RESOURCE_NAME",
];

/** The shape `--model` takes: `provider/model`, with nothing else in it. */
const modelShape = /^[^\s/]+\/\S+$/;

/**
 * The `permission` block: everything denied, then the deevy tools by name,
 * then the repository tools when there is a repository. OpenCode keeps rules in
 * the order they were written and the last match wins, which is why `*` comes
 * first and the `git push` denials come after `bash`'s own allow. A tool whose
 * rule is `deny` for every pattern is not shown to the model at all; a
 * pattern-specific denial is a refusal in the stream.
 */
export function permissions(context: HarnessContext): Record<string, unknown> {
  return {
    "*": "deny",
    ...Object.fromEntries(deevyTools.map((tool) => [tool, "allow"])),
    ...(context.input.repository
      ? Object.fromEntries(
          repositoryPermissions.map((name) => [
            name,
            name === "bash" && Object.keys(deniedCommands).length > 0
              ? { "*": "allow", ...deniedCommands }
              : "allow",
          ]),
        )
      : {}),
  };
}

/**
 * What `OPENCODE_CONFIG_CONTENT` carries. It is an environment variable the
 * session's shell can read, so nothing in it is secret: the MCP server is the
 * supervisor's loopback proxy with no header (src/proxy.ts), and the
 * instructions are a `{file:}` reference OpenCode resolves itself.
 */
export function inlineConfig(context: HarnessContext): Record<string, unknown> {
  const { config, input, instructions } = context;
  return {
    $schema: "https://opencode.ai/config.json",
    // A session is a Run's record in deevy, not a page on opencode.ai.
    share: "disabled",
    autoupdate: false,
    mcp: {
      deevy: {
        type: "remote",
        url: input.mcpUrl,
        // The proxy speaks no OAuth, and auto-detection would answer a 401
        // with a browser login nobody is there to complete.
        oauth: false,
        // OpenCode's default is five seconds per request, and a deevy tool may
        // wait on a Human; the Run's own timeout is the bound.
        timeout: config.runTimeoutSeconds * 1000,
      },
    },
    permission: permissions(context),
    agent: {
      [agentName]: {
        description:
          "Works one deevy Run: reads the Issue, writes the Document, stops at the Gate.",
        mode: "primary",
        // A custom agent's prompt replaces OpenCode's own system prompt; the
        // repository's `AGENTS.md` is still read, as input.
        prompt: `{file:${instructions}}`,
        steps: config.maxTurns,
      },
    },
  };
}

/**
 * OpenCode, headless: `opencode run --format json`, configured entirely from
 * the environment (ADR-0018).
 *
 * The boundary is in three places and every one is asserted whole by a test:
 * the argv, the inline configuration, and the variables the recipe sets. The
 * tools are granted by name in `permission` and everything else is `deny`,
 * never `ask`, because in `run` an `ask` is auto-rejected and ends the turn as
 * if the session had finished. Nothing on disk configures the session:
 * `OPENCODE_DISABLE_PROJECT_CONFIG` turns the clone's configuration off, the
 * strip list removes it anyway, and the session's home is empty. The MCP
 * server is the supervisor's loopback proxy with no credential (src/proxy.ts).
 */
export const opencode: Harness = {
  name: "opencode",
  binary: "opencode",
  env: {
    // Nothing is required by name: OpenCode serves seventy-odd providers and
    // which key the model needs is the operator's choice. A session with none
    // fails at its first Run with the provider's own error in the feed.
    requires: [],
    names: providerVariables,
    prefixes: [],
  },
  // What a repository could ship to configure this CLI: the project
  // configuration and the `.opencode/` directory of agents, commands, plugins
  // and tools. `AGENTS.md` and `CLAUDE.md` stay: they are input (ADR-0014).
  strip: ["opencode.json", "opencode.jsonc", ".opencode"],
  extraEnv(context: HarnessContext): Record<string, string> {
    return {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(inlineConfig(context)),
      // The clone's `opencode.json` and `.opencode/` are not read, whatever
      // the strip list missed. Merging would otherwise let a repository add
      // a permission key this recipe did not name.
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      // Language servers downloaded into the session's home on first sight of
      // a language: network and minutes a Run does not have.
      OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
    };
  },
  argv({ config, input }: HarnessContext): string[] {
    if (!modelShape.test(config.model)) {
      throw new Error(
        `DEEVY_AGENT_MODEL is "${config.model}"; OpenCode needs provider/model, such as anthropic/claude-haiku-4-5`,
      );
    }
    return [
      "run",
      "--format",
      "json",
      // No external plugins, which are npm packages a configuration names.
      "--pure",
      "--agent",
      agentName,
      "--model",
      config.model,
      "--dir",
      input.cwd,
      // The prompt last: `run` takes it as a variadic positional and yargs
      // stops reading flags at the first one.
      input.prompt,
    ];
  },
  parse: toSessionEvents,
  bounds: [
    "**OpenCode** is granted its tools by name in an inline `permission` block where everything",
    "else is `deny` and nothing is `ask` (in `run`, an `ask` is auto-rejected and ends the turn),",
    "reads no project configuration (`OPENCODE_DISABLE_PROJECT_CONFIG`, with `opencode.json`,",
    "`opencode.jsonc` and `.opencode/` removed from the clone as well), loads no plugins (`--pure`),",
    "and connects to no MCP server but the runtime's proxy; `AGENTS.md` and `CLAUDE.md` are read as",
    "input. A refused tool is an errored `tool_use` in its stream carrying OpenCode's own sentence",
    "about the rule, which the runtime writes into the Run's feed as a denial. Not bounded: what",
    "`bash` runs in the repository, the network, and tokens; and the provider key is in the",
    "session's environment, as every harness's is.",
  ].join(" "),
};

/** As much of one `opencode run --format json` line as the runtime reads. */
interface RunEvent {
  type?: string;
  sessionID?: string;
  part?: Part;
  error?: { name?: string; data?: { message?: string } };
}

interface Part {
  type?: string;
  tool?: string;
  state?: { status?: string; input?: Record<string, unknown>; error?: string };
  text?: string;
  reason?: string;
  cost?: number;
  tokens?: { input?: number; output?: number; reasoning?: number };
}

/**
 * The two sentences OpenCode puts in a tool's error when it was the rules and
 * not the tool that failed: a `deny` rule, and an `ask` that `run` rejected
 * on the model's behalf. Anything else that errors is a tool that ran.
 */
const denialSentences = [
  "The user has specified a rule which prevents you from using this specific tool call",
  "The user rejected permission to use this specific tool call",
];

/**
 * What one session has said so far. OpenCode reports usage per step and the
 * runtime wants it per session, so it is summed here by session id and let go
 * when the session ends. The id is on every line, so two sessions never share
 * an entry, and a supervisor that runs one session at a time never has two.
 */
const sessions = new Map<string, { usage: Usage; text: string }>();

/**
 * What the runtime reads out of one line of the stream.
 *
 * The stream is `{type, timestamp, sessionID, ...data}` where `data` is a
 * message part for `step_start`, `step_finish`, `tool_use` and `text`, and an
 * error for `error`. There is no init message, so `ready` is the first line
 * of a session; there is no result message, so `done` is the `step_finish`
 * whose reason is not another round of tool calls, or the `error`.
 */
export function toSessionEvents(line: string): SessionEvent[] {
  let event: RunEvent;
  try {
    event = JSON.parse(line) as RunEvent;
  } catch {
    return [];
  }
  if (typeof event.type !== "string" || typeof event.sessionID !== "string") return [];

  const events: SessionEvent[] = [];
  let session = sessions.get(event.sessionID);
  if (!session) {
    session = { usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, text: "" };
    sessions.set(event.sessionID, session);
    // The stream lists neither tools nor servers; whether deevy is reachable
    // was the supervisor's probe, before the session started.
    events.push({ type: "ready", tools: [], servers: [] });
  }
  const part = event.part ?? {};

  if (event.type === "tool_use" && part.type === "tool") {
    const name = part.tool ?? "?";
    const error = part.state?.status === "error" ? (part.state.error ?? "") : null;
    const sentence = error === null ? undefined : denialSentences.find((s) => error.startsWith(s));
    if (sentence) {
      const input = part.state?.input ?? {};
      const target = ["command", "filePath", "url"]
        .map((key) => input[key])
        .find((value): value is string => typeof value === "string");
      events.push({ type: "denied", name, reason: target ? `${sentence}: ${target}` : sentence });
    } else {
      events.push({ type: "tool", name });
    }
  } else if (event.type === "text" && part.type === "text" && part.text) {
    session.text = part.text;
    events.push({ type: "text", text: part.text });
  } else if (event.type === "step_finish" && part.type === "step-finish") {
    session.usage.inputTokens += part.tokens?.input ?? 0;
    session.usage.outputTokens += (part.tokens?.output ?? 0) + (part.tokens?.reasoning ?? 0);
    session.usage.costUsd = (session.usage.costUsd ?? 0) + (part.cost ?? 0);
    // Another round of tool calls is the same session going on; anything
    // else is how it ended, and `stop` is the only way it ended on purpose.
    if (part.reason !== "tool-calls") {
      const reason = part.reason ?? "unknown";
      events.push({
        type: "done",
        ok: reason === "stop",
        detail: reason === "stop" ? session.text : `The session ended: ${reason}`,
        ...spent(session.usage),
      });
      sessions.delete(event.sessionID);
    }
  } else if (event.type === "error") {
    const name = event.error?.name ?? "error";
    const message = event.error?.data?.message;
    events.push({
      type: "done",
      ok: false,
      detail: message ? `${name}: ${message}` : name,
      ...spent(session.usage),
    });
    sessions.delete(event.sessionID);
  }
  return events;
}

/** The usage to put on `done`: what was counted, or nothing when no step finished. */
function spent(usage: Usage): { usage?: Usage } {
  const nothing = usage.inputTokens === 0 && usage.outputTokens === 0 && !usage.costUsd;
  return nothing ? {} : { usage };
}
