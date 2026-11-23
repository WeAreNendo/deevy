# Research: coding-agent CLIs as harnesses for the reference runtime (2026-09-06)

Input for the spike that generalized the reference runtime from one harness to many (the runtime was removed
again in [simplify.md](../plans/simplify.md), slice 1). The runtime's supervisor
(the Run claim, the envelope, the Gate resume, the clone, the delivery, the timeout) already only knows the
`Session` seam in `src/session.ts`; what this list scores is whether each CLI can sit behind that seam
**and** keep ADR-0014's bounds. Everything here is from vendor docs or the tool's own repository unless a row
says otherwise; every CLI below is a moving target and the spike must re-verify the row before writing an
adapter.

## What the runtime needs from a harness

1. **One-shot headless run**: a prompt in, exit when done, no TTY, no stdin.
2. **A machine-readable event stream** on stdout (JSONL), so the supervisor sees tool calls, refusals, the
   final result, and ideally usage.
3. **A remote HTTP MCP server with a bearer header** configured from *outside* the working directory
   (argv, env, or a file the supervisor writes), so the Agent's key never lands in the clone.
4. **Tools granted by name, MCP tools included**, and anything not granted **refused rather than parked on a
   prompt** (ADR-0014: "permissionPrompts none"). Refusal must be observable in the stream.
5. **Nothing in the cloned repository configures the session**: no MCP server, no permission, no hook from a
   file the repository ships. Where a CLI cannot ignore project config, the adapter has to strip those files
   before the session starts and say so.
6. **Environment as an allowlist**: satisfied for every subprocess by the supervisor, which owns `spawn`.
7. **Non-interactive credential** (API key or token in env), because a container cannot complete a browser
   login.

Fit tiers below: **A** meets 1–5 and 7 on documented flags, **B** meets most with a gap the adapter can close
(strip repo config, treat exit code, probe MCP itself), **C** has a blocking gap today, **X** cannot reach
deevy at all.

## The list

| CLI | Vendor, licence | Headless invocation | Event stream | MCP over HTTP with a header, from outside the repo | Tools by name, refuse not prompt | Repo config isolation | Credential | Fit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Claude Code** | Anthropic, source-available | `claude -p` | `--output-format stream-json` (+`--include-partial-messages`) | `--mcp-config '<inline json>'` + `--strict-mcp-config` | `--allowedTools` / `--disallowedTools`, `--permission-mode default`, `--permission-prompts none` (≥2.1.259); `--max-turns`, `--max-budget-usd` | `--setting-sources` (confirm the empty value loads none) | `ANTHROPIC_API_KEY` | A |
| **Codex CLI** | OpenAI, Apache-2.0 | `codex exec --json` | JSONL (`thread.started`, `item.*`, `turn.completed`) | `config.toml` / `-c` overrides; HTTP servers with `bearer_token_env_var` or `headers`; `required = true` fails fast | `mcp_servers.<n>.enabled_tools` / `disabled_tools`; OS sandbox (`--sandbox read-only\|workspace-write`) | `--ignore-user-config`, `--ignore-rules` | `OPENAI_API_KEY` or ChatGPT login | **C today**: [openai/codex#24135](https://github.com/openai/codex/issues/24135) (open, 2026-05-22): in `exec`, MCP tool calls are cancelled on stdin EOF and no config key suppresses it; the only bypass drops the sandbox. Since deevy *is* an MCP server this blocks the adapter until fixed. Also `workspace-write` cuts network by default, against ADR-0014's no-egress-filter stance. |
| **Antigravity CLI** (`agy`) | Google, closed-source Go binary; replaced Gemini CLI 2026-06-18 | `agy -p` | `--output-format stream-json`, `status`/`error` fields, `--print-timeout` | global `~/.gemini/config/mcp_config.json`; **workspace `.agents/mcp_config.json` is also read** | `permissions.allow` rules incl. `mcp(server/tool)`, `mcp(server/*)`; unlisted tools are **soft-denied**: run continues, exits 0, notice on stderr | no documented way to ignore the workspace file | **cached credentials from an interactive login only**; no API key documented | B/C: the credential is the container problem; soft-deny needs the adapter to read stderr/stream rather than the exit code |
| **Gemini CLI** | Google, Apache-2.0 | `gemini -p --output-format stream-json` | yes | settings.json `httpUrl` + headers | `--allowed-mcp-server-names`, approval modes | project settings read | API key | legacy: retired for free/Pro tiers 2026-06-18, still served for paid Code Assist and API-key orgs. Do not target; Qwen Code is the living fork. |
| **GitHub Copilot CLI** | GitHub, proprietary, GA 2026-04 | `copilot -p` | unverified (check `--output-format`) | unverified: MCP config location and header shape | `--allow-tool` / `--deny-tool` with `Server(tool)` filters, deny wins over `--allow-all-tools`; `--no-ask-user` | unverified | `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` + Copilot seat | B pending two checks |
| **Cursor CLI** (`agent`) | Cursor, proprietary | `agent -p` | `--output-format stream-json` (+`--stream-partial-output`) | shares `mcp.json` with the desktop app; header/env shape unverified | `--force` applies edits (else proposals only); per-tool allow/deny unverified | unverified (`.cursor/` in repo) | `CURSOR_API_KEY` | B pending checks |
| **OpenCode** | Anomaly, MIT; 75+ providers | `opencode run --format json` | JSON events | `mcp` block; `{env:VAR}` substitution; `OPENCODE_CONFIG` / `OPENCODE_CONFIG_CONTENT` | `permission` block allow/ask/deny with patterns, MCP tools included; `--auto` approves everything not denied | **project `opencode.json` and `.opencode/` are merged with no trust gate**; inline config overrides only conflicting keys. **`ask` still blocks in `run`** per docs, so every rule must be allow or deny | provider API keys | B: adapter strips `opencode.json`/`.opencode/` from the clone and sets every permission explicitly. `opencode serve` + `--attach` avoids MCP cold boot per Run. |
| **Kilo CLI** | Kilo, open source, OpenCode fork; 500+ models | `kilo run --auto --format json` | JSON | `mcp` in `kilo.jsonc`; `{env:VAR}` **only in trusted (global/org) config**, not project config | same permission shape as OpenCode; without `--auto` a request is **auto-rejected and the run exits 1 with a diagnostic** | project `kilo.jsonc` / `.kilo/` read | provider keys / Kilo gateway | B: same stripping as OpenCode; the reject-and-exit-1 behaviour is closer to ADR-0014 than OpenCode's block |
| **Qwen Code** | Alibaba, Apache-2.0, Gemini CLI fork | `qwen -p --output-format stream-json` | yes, plus `stats` (tokens per model, tool calls) | `settings.json` in `~/.qwen` or repo root, `httpUrl` + headers | `--approval-mode` (`default`…`yolo`); tool allowlist in settings; budgets `--max-session-turns`, `--max-wall-time`, `--max-tool-calls` with distinct exit codes | repo-root `settings.json` read; `--safe-mode` disables *all* MCP, so not usable as the isolation switch | `OPENAI_API_KEY`-style, Qwen-first | B |
| **Kimi Code CLI** | Moonshot, Apache-2.0, TypeScript | `kimi --print --output-format stream-json` (blog-verified, not docs) | JSONL | `--mcp-config-file`; HTTP with `--header` | allow/deny config unverified | unverified | Moonshot key | B pending checks |
| **Droid** | Factory, proprietary, BYOK | `droid exec --auto low\|medium\|high` | `--output-format json` / `stream-jsonrpc` | MCP via `droid mcp add`; config for `exec` unverified | `--restrict-tools`, `--additional-tools`, `--disabled-tools` by name; risk tiers; a blocklist | unverified | `FACTORY_API_KEY` | B pending MCP check |
| **Auggie** | Augment, proprietary | `auggie --print --output-format json` | JSON | `--mcp-config` inline JSON or file | `--permission <tool>:allow\|deny`, `--remove-tool`, `--max-turns` | **workspace `.augment/settings.json` is read** (flags override) | `AUGMENT_SESSION_AUTH` | B: strip `.augment/` |
| **Kiro CLI** (ex Amazon Q Developer CLI) | AWS, proprietary | `kiro-cli chat --no-interactive --output-format stream-json` (engine v2/v3) | JSONL | `--require-mcp-startup` fails fast; config location unverified | `--trust-tools=<categories>`; per-MCP-tool naming unverified | `.kiro/` in repo unverified | `KIRO_API_KEY` (paid tiers only) | B pending checks |
| **Amp** | Sourcegraph, proprietary | `amp -x` | `--stream-json` (community-reported, unverified in docs) | `amp.mcpServers` with URL; `AMP_SETTINGS_FILE` | `amp.commands.allowlist`; `--dangerously-allow-all`; MCP per-tool rules unverified | **workspace `.amp/settings.json` MCP servers need explicit approval**, which is the right default | Amp account | B |
| **Goose** | Linux Foundation (AAIF), Apache-2.0, Rust; 15+ providers | `goose run --no-session -t` | unverified | `--with-remote-extension` / streamable-HTTP extension flags; header shape unverified (docs URL moved, re-find) | `GOOSE_MODE=auto\|approve\|smart_approve`; tool-level permission config exists | unverified | provider keys | B pending a docs pass |
| **Cline CLI** | Cline, open source; many providers | `cline --yolo --json` | NDJSON | `cline mcp install --transport http <url>`; header shape unverified | `--auto-approve`; per-tool auto-approve in settings | `.clinerules` read | provider keys | B |
| **Grok Build** | xAI, Apache-2.0, Rust; xAI models + OpenAI-compatible BYOK | `grok -p --output-format json` | JSON | `[mcp_servers]` HTTP with headers | `[permission]` per tool; **deny > ask > allow, and a lower layer cannot widen a higher one**; `GROK_DEFAULT_SELECTED_PERMISSION` for headless | **`.grok/config.toml` in the repo contributes MCP servers, plugins and permissions and cannot be disabled**, though it cannot widen a user-level deny | `XAI_API_KEY` | B: strip `.grok/`; the no-widening rule is a good bound |
| **Continue CLI** (`cn`) | Continue, open source | `cn -p` | prints only the final response | `mcpServers` in `config.yaml`; errors if a server fails to connect in headless | unverified | unverified | provider keys | C: no event stream means no `denied`, no tool trace |
| **Junie CLI** | JetBrains, proprietary EAP | `junie --auth=$JUNIE_API_KEY "<prompt>"` | unverified | **project `.junie/mcp/mcp.json`**; headless is "trusted by design" and auto-loads project MCP, hooks, agents | unverified | the opposite of what the runtime wants | key | C until a way to refuse project config exists |
| **Rovo Dev CLI** | Atlassian, proprietary | `acli rovodev run --yolo "<instruction>"`, or `serve` | unverified | `~/.rovodev/mcp.json` | `--yolo` only, no per-tool grant documented | unverified | Atlassian account | C |
| **Warp Agent CLI** (ex `oz`) | Warp, proprietary | `oz agent run --mcp …` | unverified | `--mcp` flag | unverified | unverified | API key | C: `oz` deprecated, replacement supported "through end of September 2026"; wait for it to settle |
| **Crush** | Charm, source-available Charm licence | `crush run` | unverified | config `mcp` block | **`--yolo` unavailable on `run`**, so a prompt blocks forever ([charmbracelet/crush#2792](https://github.com/charmbracelet/crush/issues/2792), open 2026-05-04) | project config read | provider keys | C until #2792 |
| **Mistral Vibe** | Mistral, Apache-2.0, Python 3.12 | unverified | unverified | unverified | unverified | unverified | any compatible key | C pending docs |
| **OpenHands CLI** | OpenHands, MIT, Python | `openhands --headless --json -t` | JSON | `openhands mcp add`; one source says headless mode lacks MCP | unverified | unverified | provider keys | C pending the MCP-in-headless check |
| **Aider** | open source | `aider --message` | text | **no native MCP** (PRs closed unmerged as of 2026-06) | n/a | n/a | provider keys | X |
| **Pi** | Mario Zechner, open source | `pi -p`, `--rpc` | JSON | **no built-in MCP**; an extension could add it | four tools by default | n/a | provider keys | X unless an extension is written |
| **Roo Code CLI** | archived 2026-05-15 | | | | | | | X, use Kilo |

Long tail with a headless mode but no verification done (from the community directories): MiMo Code
(Xiaomi), Trae Agent (ByteDance), Hermes (Nous), Plandex, ForgeCode, Codebuff, Devin CLI, Neovate (Ant),
Every Code (Codex fork), Deep Agents Code (LangChain). None should be a first-wave adapter.

## What the list says about the design

- **A subprocess recipe is the one adapter shape that fits every row.** Every A/B CLI takes a prompt as
  argv, writes JSONL to stdout, and takes configuration through argv, env or a file. The "SDK" of the two
  vendors that have one (Claude Agent SDK, Codex SDK) is itself a wrapper around that subprocess.
- **The boundary is per CLI and is the whole adapter.** The bounds that vary are 4 and 5. Three CLIs read
  repository config with no off switch (OpenCode, Grok Build, Auggie), one auto-trusts it in headless mode
  (Junie), one gates it behind approval (Amp), two can ignore it by flag (Claude Code, Codex). The adapter
  contract needs a step the supervisor runs before the session: "remove these paths from the clone", with the
  list per recipe.
- **Refusal semantics differ three ways**: refuse and continue (Claude Code, Antigravity soft-deny), refuse
  and exit non-zero (Kilo), block on a prompt (OpenCode `ask`, Crush, Codex MCP). The `denied` event the
  Run feed relies on has to be reconstructed from the stream, stderr, or the exit code depending on the row.
- **Credentials decide what can run in a container.** Antigravity has no API key path; Kiro's key is paid
  tiers only; Copilot needs a seat plus a token. A recipe declares which env var it needs and the supervisor
  refuses to start without it, the way `DEEVY_AGENT_KEY` works today.
- **The landscape churns monthly.** In the last four months Gemini CLI was retired, Roo Code archived, Warp's
  `oz` deprecated, and Codex's MCP-in-exec bug opened. Pinning each CLI's version in its image and asserting
  the recipe's argv whole (as `sessionOptions` is asserted today) is the minimum; a fixture of recorded JSONL
  per CLI is what makes the parser testable without a key.

## Sources

- Directories: [bradAGI/awesome-cli-coding-agents](https://github.com/bradAGI/awesome-cli-coding-agents),
  [Tembo, 15 CLIs compared](https://www.tembo.io/blog/coding-cli-tools-comparison),
  [Kilo, best CLI coding agents](https://kilo.ai/articles/best-cli-coding-agents),
  [Developers Digest, headless agents in CI](https://www.developersdigest.tech/blog/headless-ai-coding-agents-ci-comparison-2026)
- Claude Code: [CLI reference](https://code.claude.com/docs/en/cli-reference)
- Codex: [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode),
  [issue #24135](https://github.com/openai/codex/issues/24135)
- Antigravity: [headless](https://antigravity.google/docs/cli/headless/),
  [permissions](https://antigravity.google/docs/cli/permissions/), [MCP](https://antigravity.google/docs/cli/mcp/);
  Gemini CLI retirement: [Hacker News](https://news.ycombinator.com/item?id=48196867),
  [TechTimes](https://www.techtimes.com/articles/318660/20260618/gemini-cli-shutdown-takes-effect-ci-cd-pipelines-break-go-based-antigravity-cli-arrives.htm)
- Copilot CLI: [programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference),
  [allowing and denying tools](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools)
- Cursor: [headless CLI](https://cursor.com/docs/cli/headless)
- OpenCode: [CLI](https://opencode.ai/docs/cli/), [config](https://opencode.ai/docs/config/),
  [permissions](https://opencode.ai/docs/permissions/)
- Kilo: [CLI](https://kilo.ai/docs/code-with-ai/platforms/cli)
- Qwen Code: [headless](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/),
  [MCP](https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/)
- Kimi: [repository](https://github.com/MoonshotAI/kimi-cli),
  [MarkTechPost walkthrough](https://www.marktechpost.com/2026/07/28/building-non-interactive-agentic-coding-workflows-with-moonshot-ais-kimi-cli-jsonl-streaming-testing-and-session-memory/)
- Droid: [droid exec](https://docs.factory.ai/droid-exec/overview), [autonomy](https://docs.factory.ai/autonomy-and-safety/auto-run)
- Auggie: [CLI reference](https://docs.augmentcode.com/cli/reference)
- Kiro: [headless](https://kiro.dev/docs/cli/headless/)
- Amp: [CLI guide](https://github.com/sourcegraph/amp-examples-and-guides/blob/main/guides/cli/README.md),
  [MCP](https://ampcode.com/docs/customize/mcp)
- Goose: [repository](https://github.com/aaif-goose/goose), [developer extension](https://block.github.io/goose/docs/mcp/developer-mcp/)
- Cline: [CLI README](https://github.com/cline/cline/blob/main/apps/cli/README.md)
- Grok Build: [repository](https://github.com/xai-org/grok-build),
  [configuration](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/05-configuration.md)
- Continue: [CLI quickstart](https://docs.continue.dev/cli/quickstart), [MCP spec](https://github.com/continuedev/continue/blob/main/extensions/cli/spec/mcp.md)
- Junie: [headless](https://junie.jetbrains.com/docs/junie-headless.html), [MCP](https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html)
- Rovo Dev: [commands](https://support.atlassian.com/rovo/docs/rovo-dev-cli-commands/), [MCP](https://support.atlassian.com/rovo/docs/connect-to-an-mcp-server-in-rovo-dev-cli/)
- Warp: [Oz CLI reference](https://docs.warp.dev/reference/cli/), [changelog 2026](https://docs.warp.dev/changelog/2026/)
- Crush: [issue #2792](https://github.com/charmbracelet/crush/issues/2792)
- Mistral Vibe: [introduction](https://docs.mistral.ai/mistral-vibe/introduction)
- OpenHands: [CLI repository](https://github.com/OpenHands/OpenHands-CLI), [non-interactive PRD](https://github.com/OpenHands/OpenHands/issues/10529)
- Aider: [scripting](https://aider.chat/docs/scripting.html), [no native MCP](https://www.wearewarp.com/agents/mcp/aider)
- Pi: [npm](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
- Roo Code: [archived, CLI issue](https://github.com/RooCodeInc/Roo-Code/issues/3835)
