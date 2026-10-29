# A harness is a CLI behind the session seam

> Superseded by [ADR-0034](./0034-deevy-runs-no-agent-and-manages-no-access.md): deevy ships no runtime, and
> so no harnesses.

[ADR-0013](./0013-the-reference-runtime-is-a-service-not-a-ci-job.md) recorded two decisions about the
reference runtime. The first, that it is a long-running service and not a CI job, stands. The second, that it
drives Claude through the Agent SDK rather than the `claude` CLI, is superseded by this one, and this records
why it was right when it was taken and why it is not any more.

## The decision

**The runtime drives a coding-agent CLI as a subprocess, and which CLI is a recipe.** `apps/agent` holds a
supervisor that knows one seam — a `Session` is a function from a prompt and a working directory to a stream
of five events — and a `src/harness/` directory of recipes, one file each, that turn a configuration into a
command line and a CLI's stdout into those events. `DEEVY_AGENT_HARNESS` selects the recipe; the image is
built with one CLI installed and tagged by it. Four recipes are in the tree and run on every commit: Claude
Code, OpenCode, Cursor CLI and GitHub Copilot CLI. The page that lets somebody add a fifth is
[docs/harnesses.md](../harnesses.md).

**The Agent's key never enters the session's process tree.** The supervisor serves deevy's MCP endpoint on a
loopback port it opens for each Run, adds the key on the way out, filters `tools/list` to the tools the
runtime grants, and refuses `tools/call` on any other name before deevy hears of it. Every recipe is
configured with that URL and no credential. A refusal is written into the Run's feed as an error Activity
before the model sees the error.

**The bounds that vary are the recipe's, and the recipe says which it cannot enforce.** A recipe declares
what the session's environment may contain, which paths a repository could ship to configure the CLI and are
removed from the clone before the session starts, the whole argv, and a paragraph for OPERATIONS.md that
answers ADR-0014's two questions — what stops the session reaching further than intended, and what a Human
sees when it tries — and says what is not bounded. Each session runs with a home directory of its own,
which the recipe writes its configuration into and the runner removes afterwards.

## Why the SDK was right, and why it is not any more

ADR-0013 chose the SDK so the seam would be "a function rather than a subprocess, a PATH and an argv string
nobody can typecheck". For one harness that was the better trade. For four it is not, and for two reasons.

The SDK was never the process model it looked like. The Agent SDK resolves and spawns the `claude` binary;
the Codex SDK wraps `codex exec`; Cursor and Copilot have no SDK. What an SDK buys is types, not
in-process execution, and the discipline that made the options object safe — build it in one function,
assert it whole — carries to an argv unchanged. The Claude Code recipe's first commit compared its argv to
the options object field for field, and nothing was lost.

And a typed options object was the wrong place to put the boundary once there was more than one CLI. Two
of the four recipes read configuration from files under the working directory with no way to turn that
off, one auto-trusts it in headless mode, and refusal comes in three shapes: refuse and continue, refuse and
exit non-zero, or block on a prompt nobody will answer. No SDK's types express any of that. A recipe that
declares a strip list and a bounds paragraph does.

## What it costs

**Every recipe is a moving target.** Each CLI is a 0.x or a monthly release, and what moves is the flag that
decides what an agent with a shell may do. The image pins the CLI's version, `main.ts` runs `--version` at
startup and refuses to start without the binary, and every recipe ships a recorded stream that its parser
is replayed over. That is the minimum; it is not nothing.

**A shell in the session can reach the proxy.** It gets exactly the granted tools, which is the allowlist
and not a hole; but it means the deevy-tool allowlist is what the proxy enforces and nothing tighter, and a
recipe's own permission syntax is a second fence rather than the first.

**Some CLIs cannot be bounded the way Claude Code can.** Copilot's programmatic mode has the least
machine-readable output, so repository-tool calls and refusals may be invisible to the Run's feed and the
deevy-tool trace comes from the proxy alone. That is a documented weaker tier, written into the recipe's
bounds paragraph rather than papered over.

## What it does not change

deevy still never runs agents (ADR-0003). The runtime still imports nothing from `packages/core` and takes
no `workspace:*` dependency — since this decision it takes no dependency at all — and it talks to deevy the
way a stranger does. An Agent still cannot approve a Gate, whichever CLI is asking (ADR-0004).
