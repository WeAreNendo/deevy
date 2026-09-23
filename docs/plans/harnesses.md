# Harness spike: vertical slices

Breakdown of the harness spike, 2026-09-06. Vocabulary is [CONTEXT.md](../../CONTEXT.md); M4's slices, whose
package this spike changes, are in [m4.md](./m4.md), and the survey the spike is built on is
[coding-agent-clis.md](../research/coding-agent-clis.md). The spike is done when the runtime that today runs
Claude through the Agent SDK runs four coding-agent CLIs through one contract — Claude Code, OpenCode, Cursor
CLI and Copilot CLI — with the same supervisor, the same tests, the same acceptance walk, and a written page
that lets somebody add a fifth without touching anything but their own file.

Six slices, in dependency order. Each is one PR on `main` that leaves deevy unchanged and carries its own
tests. Nothing in a slice is needed by an earlier one.

It is a spike, which means two things. Every slice that adds a harness begins with a list of questions the
survey could not answer from the vendor's documentation, and the slice's first commit is the answers; a
harness whose answers fail the bounds is recorded as a tier C row and its slice ends there, with the recipe
left in the tree as a documented non-starter rather than deleted. And the product decisions the spike raises
(the package's name, the image tags, what is promised to whom) are taken once, in slice 6, with the four
recipes in hand.

## Decisions taken for the spike

- **A harness is a CLI in a subprocess, not an SDK.** M4 chose the Agent SDK so the seam would be a function
  rather than "a child process, a PATH, and an argv string nobody can typecheck". That argument was right for
  one harness and is wrong for four: the Agent SDK is itself a wrapper around the `claude` binary (the
  Dockerfile has to install that binary separately for exactly this reason), the Codex SDK wraps `codex exec`,
  and Cursor and Copilot have no SDK at all. One adapter shape — spawn an argv, feed it configuration through
  argv, env and files the supervisor writes, read JSON lines from stdout — fits every row of the survey, and
  the discipline that made the options object safe carries over: the argv is built in one function and
  asserted whole. ADR-0013's "service, not a CI job" stands; its "SDK, not CLI" paragraph is superseded, and
  slice 6 records that.
- **The seam does not move.** `type Session = (input: SessionInput) => AsyncIterable<SessionEvent>` in
  `src/session.ts` is already harness-neutral and every test in the package scripts it. A harness is what
  produces a `Session` from a `Config`, which is what `buildSession` is today. The supervisor keeps not
  knowing which harness it has. One field is added: `done` carries a `usage` the harness fills as best it
  can, because PLAN.md's cost-per-Run item should not land on one harness only.
- **The Agent's key never enters the session's process tree.** Today the key travels to the SDK as an MCP
  header, and the SDK passes it to the CLI, and the CLI spawns the session's shell — same uid, same
  container, so a `cat /proc/<pid>/cmdline` in that shell is the key. ADR-0014 already calls a key the
  session can reach "an allowlist a subprocess can walk around". The spike closes it the only way a
  subprocess model can: the supervisor, which already listens on 8787, serves `/mcp` on loopback and forwards
  to deevy with the header, and every harness is configured with `http://127.0.0.1:<port>/mcp` and no
  credential at all. The proxy is also where the deevy-tool allowlist is enforced — `tools/list` is filtered
  and `tools/call` on anything else is refused — so bound 4 of ADR-0014 stops depending on four CLIs'
  permission syntaxes for the tools that matter most, and a refusal is one `denied` event from one place. A
  shell that curls the proxy gets exactly the allowlisted tools, which is the allowlist and not a hole.
- **The bounds that vary are enforced by the recipe, and the recipe says which it cannot enforce.** Tools by
  name for the repository tools (Read, Write, Bash), refusal instead of a prompt, and isolation from the
  cloned repository's own configuration are expressed differently by every CLI, and the survey found three
  that cannot ignore project configuration at all. So a recipe declares a list of paths the supervisor
  removes from the clone before the session starts, and a paragraph for OPERATIONS.md saying what the
  harness leaves unbounded. ADR-0014's rule for anything added later — what stops it reaching further, what a
  Human sees when it tries — is the template for that paragraph.
- **The environment is still an allowlist, and the recipe extends it by name.** `sessionEnv` stays; a recipe
  adds the variables its CLI needs (`ANTHROPIC_API_KEY`, `CURSOR_API_KEY`, `COPILOT_GITHUB_TOKEN`, a provider
  key for OpenCode) and the supervisor refuses to start without them, the way it refuses without
  `DEEVY_AGENT_KEY`. `HOME` for the session is a directory the supervisor prepared, because three of the four
  CLIs read their own configuration from the home directory and the supervisor has to own that file.
- **stdin is closed, always.** Two CLIs in the survey hang or cancel tool calls on stdin they did not expect.
  The runner spawns with stdin closed and treats that as part of the contract, not as a per-recipe detail.
- **No test spends money, still.** Every recipe is tested three ways for free: its argv and strip list
  asserted whole, its parser run against a recorded JSON-lines fixture, and the supervisor driven by the
  scripted session exactly as today. One live test per harness exists behind `DEEVY_AGENT_LIVE=<harness>`
  and CI never sets it. The acceptance script gains `--harness` and runs the scripted session against every
  recipe, which proves the supervisor is harness-blind and costs nothing.
- **deevy does not change.** No slice touches `packages/core`. If a CLI makes an operation awkward, that is a
  finding for after the spike, written into the slice's "Found by building" section, not a widening done in
  passing (ADR-0011).

## Deferred out of the spike

The other twenty-two rows of the survey, which become community recipes against the page slice 6 writes.
Codex, until openai/codex#24135 is fixed, because deevy is an MCP server and `codex exec` cancels MCP calls.
A second forge beside GitHub, which is the other axis of this package and gets its own spike. Running the
session as a different uid from the supervisor, which would bound the working directory as well as the key;
the container stays the sandbox for now. Any change to what an Agent may call.

## Conventions every slice follows

M4's four conventions for `apps/agent` ([m4.md](./m4.md), 19–22) hold. The spike adds five:

23. A harness is one file in `src/harness/` plus its fixture, and touches nothing outside them. The supervisor
    imports the registry in `src/harness/index.ts` and never a recipe by name.
24. Convention 21 widens: a recipe's argv, its strip list and its required environment are asserted whole,
    as one snapshot per recipe. The Claude Code snapshot is compared against today's `sessionOptions` field
    for field in its first commit, so the move from SDK to CLI is shown to lose nothing.
25. Every recipe has a recorded JSON-lines fixture under `tests/fixtures/<harness>/`, captured once from a
    real run and committed, and the parser test replays it. A recipe with no fixture is not a recipe.
26. Every recipe answers ADR-0014's two questions in a paragraph in OPERATIONS.md — what stops the session
    reaching further than intended, and what a Human sees in the Run's feed when it tries — and says in the
    same paragraph what it cannot bound.
27. The image pins the CLI's version, and `main.ts` runs the CLI's `--version` at startup and refuses to
    start if the binary is missing. A harness the container cannot run is found at boot, not at the first
    Run.

Sizes are t-shirt estimates for one developer plus agents: S under a day, M two to three days, L a week.

## Dependency order

```
M4
└─ 1 The key stays with the supervisor         proxy, allowlist, denied, probe
   └─ 2 The harness contract, and Claude Code on the CLI
      ├─ 3 OpenCode
      ├─ 4 Cursor CLI
      └─ 5 Copilot CLI
         6 Images, docs, the ADR, and the recipe page     needs everything
```

Slices 3, 4 and 5 are independent of one another and can be built in parallel once 2 is in.

---

## Slice 1: The key stays with the supervisor (M)

**Goal.** A session reaches deevy through the supervisor and never holds the Agent's key, and the deevy-tool
allowlist is enforced in one place that does not depend on the harness.

**Depends on.** M4.

**Work.**

- `src/proxy.ts`: a streamable-HTTP MCP endpoint on the receiver's existing listener (`/mcp` beside
  `/healthz`), bound to loopback, forwarding to `${DEEVY_URL}/mcp` with `Authorization: Bearer
${DEEVY_AGENT_KEY}`. It is a byte-level forwarder for everything except two methods it understands:
  `tools/list`, whose result it filters to `deevyTools` (the names without the `mcp__deevy__` prefix), and
  `tools/call`, which it refuses with a JSON-RPC error for a name not on that list. The receiver already
  verifies deevy's signature with code that never saw the signer; this is the same posture in the other
  direction.
- The proxy is up only while a Run is being worked and answers only one session at a time, because the
  supervisor is sequential and a listener that accepts calls with no Run in flight is a listener nobody is
  watching.
- A refused `tools/call` yields a `denied` `SessionEvent` from the proxy into the same stream the harness
  produces, so `work.ts`'s existing handling — a `denied` Activity in the Run's feed, up to the cap — needs no
  change. Slice 2's contract merges the two sources.
- `deevyIsReachable` stops reading a harness's `ready` event and becomes a probe the supervisor makes itself
  before starting the session: `initialize` against deevy through the proxy. A session that cannot reach
  deevy is still the one condition worth abandoning a Run over; the check just stops being one CLI's
  message.
- `sessionOptions` in `sdk.ts` points the SDK at the proxy with no header. That is the whole change to the
  Claude adapter in this slice, and it is what makes the field-for-field comparison in slice 2 possible.

**Acceptance test.** Against a real deevy in-process: a client on the proxy lists exactly the twelve tools;
`tools/call` on `gates_approve` is refused and the supervisor records a `denied`; `issues_get` through the
proxy returns what the key returns directly; the proxy refuses a connection that is not from loopback; with
the proxy's forwarder given a wrong key, the pre-session probe fails the Run before any session starts.
`tests/boundary.test.ts` still passes: the proxy is `node:http`, and the package still has one dependency.

**What this slice is not.** Not a second MCP server: it speaks deevy's tools and adds none, so
`mcp-tools.json` is unchanged and ADR-0016's list of which way each tool faces is still deevy's.

---

### Found by building the slice

**The proxy is its own listener, not a route on 8787.** The plan put `/mcp` beside `/healthz` on the
receiver's listener and had it check who connected. Built, it is a second `node:http` server bound to
`127.0.0.1` on port 0, opened by `workRun` for one Run and closed in its `finally`. That is loopback by
address rather than by inspection, one session at a time by construction, and up only while a Run is in
flight without a line of code saying so. The URL is per Run, and reaches the session as `SessionInput.mcpUrl`.

**There is no `initialize` to probe with.** The 2026-07-28 revision has no handshake: every request carries
its envelope in `_meta`, and deevy's edge rejects an `initialize` sent with a modern `MCP-Protocol-Version`
header, then rejects a request whose body names a method the `Mcp-Method` header does not. Both are recorded
in [mcp-spec-2026-07-28.md](../research/mcp-spec-2026-07-28.md) and both were learned again here, which is
the point of a client that never saw the server's code. The probe is a `tools/list` with the envelope and
the header, and it is the better probe: it proves the key is this Agent's and that deevy lists its tools.

**`deevyIsReachable` is gone.** The supervisor no longer reads a harness's `ready` event to decide whether
deevy is there; the probe decides, before a token is spent, in words the Run's feed can carry
("deevy answered 401 to tools/list"). `ready` stays in `SessionEvent` for the log.

**A refusal is recorded before the session is answered.** The first version queued the proxy's refusals and
drained them at the harness's next event. The acceptance walk caught what that costs: the model's refused
call came first, its `runs_request_approval` came last, and the queued refusal was written after the Run
had stopped at the Gate — an Activity on a Run in `awaiting_input` puts it back in `active`, and the
supervisor then failed a Run that had done everything right. So the proxy awaits `onDenied` before it
answers the session, and the error Activity is in the feed before the model has seen the error.

**The acceptance walk now goes through the proxy.** The scripted model calls `input.mcpUrl` with no
credential, and the walk gained a check that `gates_approve` through it is refused with "not available to
this session". The walk on both deployments is what shows the forwarder is transparent to a real socket,
JSON and SSE alike.

---

## Slice 2: The harness contract, and Claude Code on the CLI (L)

**Goal.** The runtime chooses a harness by name, runs it as a subprocess through one runner, and the first
harness is Claude Code through `claude -p`, with the Agent SDK dependency gone and nothing lost.

**Depends on.** Slice 1.

**Questions the survey left open, answered in the first commit.**

- Does `--setting-sources` accept an empty value that loads no settings, or is the least a subprocess can
  load `user` from a `HOME` the supervisor prepared and left empty?
- Does `--output-format stream-json` carry the `system`/`permission_denied` message the SDK exposes, so the
  runtime's `denied` for repository tools keeps its source?
- Does the `result` message carry `usage` and `total_cost_usd` in print mode?

**Work.**

- `src/harness/contract.ts`:

  ```ts
  interface Harness {
    name: string;
    binary: string;
    /** Variables the session needs on top of `sessionEnvAllowed`; the supervisor refuses to start without them. */
    requires: ReadonlyArray<string>;
    /** Paths removed from the clone before the session starts, relative to its root. */
    strip: ReadonlyArray<string>;
    /** Files the supervisor writes before the session starts, under the session's HOME or a private directory. */
    prepare(ctx: HarnessContext): Promise<void>;
    /** The whole command line, asserted whole by a test. */
    argv(ctx: HarnessContext): string[];
    /** One stdout line to zero or more events. */
    parse(line: string): SessionEvent[];
    /** What OPERATIONS.md says about this harness. */
    bounds: string;
  }
  ```

  `HarnessContext` is the `Config`, the `SessionInput`, the proxy's URL, the instructions text, and the
  session's `HOME`.

- `src/harness/run.ts`: the runner. `spawn(binary, argv, { cwd, env: sessionEnv(...), stdio: ["ignore",
"pipe", "pipe"] })`, a line reader on stdout into `parse`, stderr kept for the `done` detail when the exit
  code is not zero, `SIGTERM` then `SIGKILL` on the Run's `AbortSignal`, and the `done` event synthesised from
  the exit code when the stream did not produce one. It merges the proxy's `denied` events from slice 1
  into the same iterable.
- `src/harness/claude-code.ts`: the recipe. `argv` is `-p --output-format stream-json --verbose --mcp-config
'<inline json pointing at the proxy>' --strict-mcp-config --allowedTools … --disallowedTools …
--permission-mode default --permission-prompts none --setting-sources '' --append-system-prompt-file
<instructions> --max-turns N --model M --effort E`, from the same `deevyTools`, `repositoryTools` and
  `deniedTools` lists as today. `strip` is `.mcp.json`, `.claude/`, `CLAUDE.md` is **not** stripped: it is
  input, and ADR-0014 says input is untrusted and is not what the bounds are for. `parse` is
  `toSessionEvents` moved, since the CLI's stream is the SDK's message stream.
- `src/harness/index.ts`: the registry, `{ "claude-code": claudeCode }`, and `harnessFor(config)`.
  `DEEVY_AGENT_HARNESS` selects, default `claude-code`, an unknown name refuses to start.
- `main.ts` runs `<binary> --version` at startup (convention 27) and logs it.
- `sdk.ts` and `@anthropic-ai/claude-agent-sdk` are removed. The Dockerfile installs `@anthropic-ai/claude-code`
  at a pinned version instead. `tests/boundary.test.ts` asserts the dependency list is now empty.
- `SessionEvent`'s `done` gains `usage?: { inputTokens; outputTokens; costUsd? }`, and `work.ts` puts it in
  the `runs_finish` summary's last line when present. Nothing in deevy is asked to store it.

**Acceptance test.** The argv snapshot, compared in the test against the previous `sessionOptions` shape so
each SDK field has a flag; the strip list snapshot; the parser replayed over `tests/fixtures/claude-code/`;
a hostile clone fixture (`.mcp.json` adding a server, `.claude/settings.json` granting everything) is
stripped and, in the live test, the session's `ready` lists one server; the runner's timeout kills a `sleep`
and the Run fails with the timeout reason; every existing test in the package passes unchanged with the
scripted session, which is the proof the supervisor did not notice.

---

### Found by building the slice

**The three open questions, answered by running the CLI.** `--setting-sources ""` is accepted and loads
nothing; with `--strict-mcp-config` a server planted in the session home's `.claude.json` was not
connected, which is the case that matters. `--output-format stream-json` carries the `system` /
`permission_denied` message with the tool name and the CLI's own sentence about the refusal, so `denied`
keeps its source. The `result` message carries `usage` and `total_cost_usd`; the recorded fixture cost
$0.02 on the smallest model, which is what a fixture should cost.

**The stream lists every built-in tool in `init`, allowed or not.** `tools` in the init message is what
exists, not what is granted; `--allowedTools` governs permission and the list does not shrink. The
`ready` event still carries it for the log, and nothing decides anything on it.

**A session gets a home of its own, which the plan did not ask for.** The runner makes a `HOME` per session
and removes it after. It fell out of the Cursor and Copilot recipes needing a home the supervisor writes
into, and it closes a gap the environment allowlist had left open: a session's shell could read the
operator's dotfiles, and on a laptop that is where credentials live. The cost is that git inside the
session has no global configuration, which the delivery step never needed because it passes the author
with `-c`.

**Usage is logged, not written into deevy.** The plan wanted it on the `runs_finish` summary's last line;
the model finishes its own Run, and a finished Run takes no more writes. So `done` carries it, `WorkResult`
carries it, and the loop logs it beside the outcome. The after-v1 cost-per-Run item now has one number per
Run to start from, whichever harness produced it.

**The image installs a CLI, and one script decides which.** `harness.sh` takes a name and installs that
CLI at the version the recipe was tested against; the Dockerfile's `HARNESS` build argument passes it in
and sets `DEEVY_AGENT_HARNESS` to match. Slice 6 adds the other three cases and the tags.

---

## Slice 3: OpenCode (M)

**Goal.** The same Run, worked by OpenCode against whichever provider the operator gives it a key for.

**Depends on.** Slice 2.

**Questions answered first.**

- What does `opencode run` do with a permission rule of `ask` when there is no TTY: block, reject, or exit?
  The documentation says the prompt "still activates". If it blocks, every rule in the recipe is `allow` or
  `deny` and `ask` is a bug the test catches.
- Does `OPENCODE_CONFIG_CONTENT` fully own `mcp` and `permission` when the clone's `opencode.json` is
  stripped, given that configuration is merged rather than replaced?
- What are the `--format json` event shapes for a tool call, a refusal, and the end of a run, and is there
  usage in the last one?
- Is the deevy MCP server's tool set reachable by name in `permission` (the survey says MCP tools are
  included) so the repository tools and the deevy tools can both be listed?

**Work.**

- `src/harness/opencode.ts`. `prepare` writes nothing to the clone; configuration goes in
  `OPENCODE_CONFIG_CONTENT`, which is an env var the session's shell can read and which therefore contains
  **no secret**: the MCP entry is the proxy's loopback URL. `permission` is `{"*": "deny"}` followed by an
  allow per repository tool and per deevy tool, with the same `git push`, `git remote`, `git config` and `gh`
  denials as Claude Code's, expressed as bash patterns. `argv` is `run --format json --model <provider/model>
--dir <cwd> <prompt>`. `strip` is `opencode.json`, `opencode.jsonc`, `.opencode/`.
- `requires` is the provider key the model needs, and `DEEVY_AGENT_MODEL` for this harness is
  `provider/model`; the recipe validates the shape.
- Instructions: OpenCode reads `AGENTS.md` from the clone as input. The runtime's `instructions.md` is
  delivered as a custom agent in the inline config whose prompt is the instructions, selected with
  `--agent`, so the system prompt is the supervisor's and the repository's `AGENTS.md` is one more thing the
  model reads.
- `opencode serve` plus `--attach` is noted and not used: a per-Run process is what keeps a restarted
  supervisor and a second host behaving like the pass before.

**Acceptance test.** The three snapshots (convention 24); the fixture replay; the hostile clone stripped; the
`ask` finding pinned by a test whichever way it went; the acceptance script's `--harness opencode` run with
the scripted session.

---

### Found by building the slice

Built by a sub-agent against `opencode-ai@1.18.29`; the machine's own 1.0.7 lacked `--dir` and the flags
the docs describe, which is the churn the plan warned about, one CLI in.

**`ask` does not block; it rejects and ends the turn.** In `run`, every `permission.asked` is answered
`reject` with a stderr line, and the turn then stops as if the session had finished, exit code zero, no
error event. A stray `ask` would look like a session that simply finished. The recipe has no `ask`, and a
test walks every leaf of the `permission` block to pin it.

**The survey's "no off switch for project config" was wrong for this version.** Merging is deep, so a
project `opencode.json` key the inline config did not name would survive — but
`OPENCODE_DISABLE_PROJECT_CONFIG=1` exists and removes the project file, `.opencode/` and its agents
together. The recipe sets it; the strip list is the second fence, and stripping `.opencode/` also stops
OpenCode running `npm install` and writing a `.gitignore` inside the clone, which it does for every such
directory it finds.

**MCP tools are addressable by name as `<server>_<tool>`,** so `deevy_issues_get: "allow"` sits beside
`bash`. Rules are an ordered list and the last match wins, so `"*": "deny"` goes first; a tool whose only
rule is deny is hidden from the model. Against a throwaway MCP server OpenCode connected and listed.

**There is no init and no result message.** Usage is per `step_finish`, so the parser sums per session id
and emits `done` on the `step_finish` whose reason is not another round of tool calls; `ready` is emitted
on a session's first line and carries nothing. `{file:}` resolves inside inline config, so the
instructions become a custom agent's prompt with no `prepare` at all.

**The contract gained `extraEnv`.** Inline configuration lives in an environment variable the session's
shell can read, so nothing in it is secret; a recipe needed a way to add variables of its own, and the
Cursor and Copilot recipes used it the same day.

**The fixture is authored, not recorded.** The only provider configured on this machine lacked one of its
variables, so every line carries `"_authored": true` and the one real line is the credential-free error
event. Recording a real one needs any provider key.

---

## Slice 4: Cursor CLI (M)

**Goal.** The same Run, worked by Cursor's `agent`.

**Depends on.** Slice 2.

**Questions answered first.**

- In print mode without `--force`, a write is "proposed, not applied". With `--force`, is the refusal of a
  tool that a `deny` rule names a hang, an error in the stream, or a silent skip?
- Where is the CLI's MCP configuration, what is the HTTP entry's shape, and does `--approve-mcps` cover a
  server that needs no login?
- Is the project's `.cursor/cli.json` merged with `~/.cursor/cli-config.json`, and does a project `allow`
  widen a global `deny`? The documentation says deny wins; the test says whether that holds across scopes.
- Does `stream-json` carry tool names, refusals and usage?

**Work.**

- `src/harness/cursor.ts`. `prepare` writes `~/.cursor/cli-config.json` in the session's `HOME` with
  `permissions.allow` of `Mcp(deevy:*)`, `Read(**)`, `Write(**)`, `Shell(*)` when there is a repository, and
  `permissions.deny` of `Shell(git push)`, `Shell(git remote)`, `Shell(git config)`, `Shell(gh)`; and the
  MCP configuration with the proxy's URL. `argv` is `-p --output-format stream-json --force --approve-mcps
--workspace <cwd> --model <model> <prompt>`. `strip` is `.cursor/`. `requires` is `CURSOR_API_KEY`.
- Cursor has no effort flag; `DEEVY_AGENT_EFFORT` is documented as read by Claude Code only, and the config
  table gains a column saying which harness reads each variable.
- `--sandbox` exists and is left at its default in the spike, with a note: it may be a bound the container
  is currently providing, and turning it on is a follow-up with its own test.

**Acceptance test.** As slice 3, with `--harness cursor`.

---

### Found by building the slice

Built by a sub-agent against Cursor CLI `2026.09.02-c22c1a3`, fetched as the tarball the installer would
have written into the user's home; `harness.sh` does the same into `/opt`.

**The allow list is documentation; the deny list is the fence.** `--force` is "allow unless explicitly
denied", and a deny rule is a hard block checked before the allow list and before `--force`: the shell
result is `rejected` with "Command is not allowed", in the stream, not a hang. So "no shell without a
repository" can only be said as a denial, and the recipe writes `Read(**)`, `Write(**)`, `Shell(*)` and
`WebFetch(*)` into `deny` when there is no repository.

**A project's `.cursor/cli.json` replaces arrays rather than merging them,** so a repository could empty
the deny list; the plan's "deny wins across scopes" holds only until the project overwrites it. An
undocumented `--disable-project-configs` exists and is accepted, and `.cursor/` is stripped as well.
Stripping it also drops `.cursor/rules`, which is input.

**Instructions ride as a prompt prefix.** There is no home-level rules directory and no system-prompt flag.
`stream-json` carries tool calls, refusals and `usage` (tokens, not cost); `system/init` lists nothing. No
effort flag, though a parameterised model takes `[effort=high]` inside `--model`, which an operator can put
in `DEEVY_AGENT_MODEL`.

**The fixture is authored.** The CLI is not authenticated here and the desktop app does not share its
credential; the credential-free stream is nothing on stdout, an error on stderr and exit 1, which the runner
already turns into a `done`. Two files were written to the operator's real home by the first `--version`
call, before the session home was set: the CLI's default `cli-config.json` and a compile cache. Both are
harmless and are reported rather than deleted.

---

## Slice 5: Copilot CLI (M)

**Goal.** The same Run, worked by GitHub Copilot's CLI.

**Depends on.** Slice 2.

**Questions answered first.**

- Is there a machine-readable output mode for `-p`? The programmatic reference documents none. If there is
  not, the recipe's `parse` sees only the final text, tool calls and refusals of repository tools are
  invisible to the Run's feed, and the deevy-tool trace comes from the proxy alone. That is a documented
  weaker tier, not a reason to stop.
- Where is the MCP configuration file under `COPILOT_HOME`, and what is an HTTP server's shape?
- Does headless mode require the working directory to be a trusted directory in `config.json`, and does the
  supervisor therefore write that file too?
- Which token scopes does `COPILOT_GITHUB_TOKEN` need? The session's shell will see this token. It must be a
  fine-grained token with Copilot access and **no repository permission**, distinct from
  `DEEVY_AGENT_GIT_TOKEN`, which the supervisor holds and the session never sees. A token that can push is a
  push the denylist cannot stop.

**Work.**

- `src/harness/copilot.ts`. `prepare` writes the MCP configuration and the trusted-directory entry under a
  `COPILOT_HOME` the supervisor owns. `argv` is `-p <prompt> --no-ask-user --allow-tool 'deevy(<tool>)'` per
  deevy tool, `--allow-tool read,write,shell` when there is a repository, `--deny-tool 'shell(git push:*)'`,
  `'shell(git remote:*)'`, `'shell(git config:*)'`, `'shell(gh:*)'`, `--model <model>`. `strip` is nothing the
  survey found: Copilot reads `.github/copilot-instructions.md` and `AGENTS.md` as input, which is allowed.
  `requires` is `COPILOT_GITHUB_TOKEN`.
- Instructions travel as a custom agent file under `COPILOT_HOME` selected with `--agent`, or as a prefix of
  the prompt if the agent mechanism cannot carry a system prompt; the first commit says which.

**Acceptance test.** As slice 3, with `--harness copilot`, plus a test that the token named in `requires` is
not the git token: the recipe refuses to start if the two variables hold the same value.

---

### Found by building the slice

Built by a sub-agent against `@github/copilot@1.0.83`, with six real `copilot -p` runs on a `gh` token.

**There is a machine-readable output mode.** `--output-format json` emits one object per line:
`session.mcp_servers_loaded`, `tool.execution_start` (MCP tools as `deevy-issues_get`),
`tool.execution_complete` with `error.code: "denied"`, `assistant.message.content`, and a final `result`.
The survey's "documents none" was out of date. What the stream does not carry is token or dollar totals —
premium-request counts and durations only — so a Run worked by Copilot carries no usage. That is the tier
downgrade, and it is output, not permissions.

**Do not trust the working directory.** Headless runs work with it untrusted, and folder trust is exactly
what loads a repository's `.mcp.json`, `.github/mcp.json`, hooks and plugins — shown by planting a server
and watching `copilot mcp list` find it only after the directory was trusted. So the recipe never writes
`trustedFolders`, the omission is the isolation bound, and `strip` is empty.

**Three flags the plan did not know about.** `--disable-builtin-mcps`, or the built-in GitHub MCP server
reaches GitHub with the token; `--no-remote-export`, or the session is exported to GitHub's web and mobile
views by default; and `--secret-env-vars COPILOT_GITHUB_TOKEN`, which strips the token from the shell the
session runs — an `echo` of it from inside answered "unset". In `-p` without `--allow-all-tools`, an
unlisted tool is auto-denied, which is ADR-0014's refuse-not-prompt.

**The fixture is entirely real**, recorded against a loopback MCP server with a real `deevy(issues_get)`
call and a denied `git push`.

---

## Slice 6: Images, docs, the ADR, and the recipe page (M)

**Goal.** An operator can pull one image per harness, the documentation says what each harness bounds and
does not, the decision is recorded, and somebody outside this repository can add a recipe.

**Depends on.** Slices 1 through 5.

**Work.**

- **Images.** One Dockerfile with `ARG HARNESS`; the runtime stage installs that CLI at a pinned version and
  sets `DEEVY_AGENT_HARNESS`. The release workflow builds `deevy-agent:<version>-<harness>` and
  `deevy-agent:<harness>` for the four, and `deevy-agent:latest` stays Claude Code so the compose profile in
  OPERATIONS.md keeps working. A fat image with all four is not built: a session uses one harness and one
  credential.
- **Name.** The package is renamed from `claude-agent` to `agent` (`apps/agent`, `vp run agent#…`), because
  the name was the most Claude-specific thing left. The image name `deevy-agent` already fits. CLAUDE.md,
  PLAN.md, OPERATIONS.md, the README and the acceptance doc follow.
- **OPERATIONS.md.** The configuration table gains a "read by" column. A "Harnesses" section carries each
  recipe's `bounds` paragraph verbatim (convention 26), the credential each needs, and for Copilot the
  two-token rule from slice 5 in bold.
- **ADR-0018, "A harness is a CLI behind the session seam".** The decision, the reversal of ADR-0013's SDK
  paragraph with the reason it was right then, the proxy from slice 1 as the bound that replaced the header,
  the strip list as the bound for CLIs that cannot ignore project configuration, and the rule that a recipe
  declares what it cannot bound. ADR-0013 gets a one-line note pointing here.
- **`docs/harnesses.md`, the recipe page.** The seven requirements from the survey as a checklist, the
  `Harness` interface, the three free tests a recipe must ship, how to record a fixture, the tier a recipe
  lands in when a requirement is unmet, and the survey's table as the starting list, with a sentence that
  the four in-tree recipes are the ones this repository runs on every commit and the rest are the
  community's. `agent-loop.md` keeps its `claude` example and gains one sentence saying the runtime now
  drives that CLI, and any of three others, from a program.
- **Release.** Changeset, version, the four images pushed and pulled anonymously, `sockets-acceptance.md` amended
  to say the walk now runs once per harness.

**Acceptance test.** `vp run agent#acceptance` walks both deployments times four harnesses with the scripted
session; CI green; each image starts with `--once` against a local deevy and exits zero with no key for the
harness present, refusing at the `requires` check with a message that names the variable.

### What the spike is expected to find

Written before building, to be corrected after. Copilot will be the weakest tier, for output rather than
permissions. OpenCode's `ask` will block, and the recipe will have no `ask`. Cursor's project-scope
permissions will be the one place a repository can widen something, and the strip list will be doing real
work there. And the proxy will turn out to be the change that mattered most, because it is the one that
made the four recipes smaller rather than larger.

### Found by building the slice

**The plan's acceptance matrix was theatre, and was not built.** Running the scripted session "once per
harness" would exercise nothing, since a scripted session never spawns a CLI. What proves each image is its
smoke in CI, on `main` and in the release (a pull request builds the default image only, since four
installs per push is four installs): every image starts with `--once` against the CI deevy and must print `harness <name>: <version>`
before deevy refuses the key, and the Cursor and Copilot images must refuse earlier still, at the credential
their recipe requires. The acceptance walk runs once and is harness-blind, which is the claim.

**Four images, one Dockerfile, one script.** `harness.sh` takes the name and installs the pinned CLI: two
by npm, Cursor by the tarball its installer would fetch, into `/opt` rather than a home. The release matrix
tags `<harness>` and `<version>-<harness>` for each, and only Claude Code moves `latest` and the bare version,
so the compose profile keeps pulling what it did.

**Two fixtures are authored, two are real.** Claude Code's and Copilot's streams were recorded from real
runs on this machine (a few cents on the smallest model, and premium requests on a `gh` token). OpenCode's
and Cursor's could not be: no provider key and no Cursor credential were available, and the credential-free
streams are recorded beside them. Both recipes' tests assert the `_authored` marks so nobody mistakes one for
the other; recording the real ones needs one key each and is the first thing to do with them.

**The rename happened.** `apps/claude-agent` is `apps/agent`, the package is `@deevy/agent`, the release
tool's area list and the changeset group follow, and the historical plans and ADR-0013 keep the old name
with a note. The image name `deevy-agent` already fit.

**What was expected and what was found.** Copilot was expected to be the weakest tier and is, for output;
its permissions turned out the most complete. OpenCode's `ask` was expected to block and instead rejects
and ends the turn, which is the more dangerous of the two because it looks like success. Cursor's project
scope was expected to widen things and does, by replacement. And the proxy was the change that made the
recipes smaller: not one of them carries a credential for deevy, and the deevy-tool allowlist is enforced
once.
