# The reference runtime is a service, not a CI job

> Superseded by [ADR-0034](./0034-deevy-runs-no-agent-and-manages-no-access.md): deevy ships no reference
> runtime, and `apps/agent` is gone.

> The second decision here, the Agent SDK over the `claude` CLI, is superseded by
> [ADR-0018](./0018-a-harness-is-a-cli-behind-the-session-seam.md); the first stands. The package has since
> moved to `apps/agent`.

[PLAN.md](../PLAN.md)'s M4 sentence promised "Claude Code headless in a GitHub Action and as a local loop".
M4 shipped the loop, a container, and no Action. This records why, and what it costs, so the plan's sentence
is not read as the design.

## The decision

`apps/claude-agent` is a long-running process. It holds one Agent's API key, polls `runs.list` for the work
that Agent has been assigned, and is woken early by a signed webhook when deevy has one to send. It runs on a
laptop with `--once` or a loop, and in a container beside deevy's own. There is no GitHub Action, and none is
planned.

It uses the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) rather than shelling out to the
`claude` CLI. `query({ prompt, options })` is a function returning an async generator, so the seam every test
in the package hangs off is a function rather than a subprocess, a PATH and an argv string nobody can
typecheck. [agent-loop.md](../agent-loop.md)'s worked example stays true and stays useful: it is the CLI
configuration a person copies, and this is the same thing with a program in the driver's seat.

## Why not the Action

**An agent bills for thinking.** A GitHub Action pays for wall-clock time on a runner. A session that reasons
for twenty minutes bills twenty minutes, and it bills them while doing nothing a runner is good at. A service
already up costs the same whether it is working or waiting.

**A Run stopped at a Gate waits for a person.** That is the shape of the whole design — a Gate is a State an
Issue cannot leave without a Human (ADR-0004) — and a Human may take days. A job cannot wait; it exits, and
something has to bring it back. The service is already there when the ruling lands, and deevy hands the Run
back through the Agent's inbox.

**A fresh runner pays for a clone it throws away.** One per Run, every Run, with no way to keep anything
between them.

## What it costs

**Somebody has to run it.** A CI job needs no host and this needs one — a small container, or a laptop for a
solo developer. That is the honest trade: the thing that made the Action attractive is the thing given up.

**There is no per-Run isolation for free.** A runner is a fresh machine each time; a service is not, so the
isolation is the runtime's own: a working directory made and removed per Run, and a container around the
whole thing. What that does and does not bound is written down in
[OPERATIONS.md](../OPERATIONS.md#what-is-bounded-and-what-is-not) and in
[ADR-0014](./0014-an-agents-input-is-untrusted-and-its-tools-are-not.md).

**Somebody who wants an Action still can.** Nothing in the runtime assumes it is long-lived: `--once` makes
one pass and exits, the queue and the claim are both server-side, and a fresh process is not a fresh start.
Pointing a self-hosted runner at it is a workflow file nobody here has to maintain, and OPERATIONS.md says
which knobs matter.

## What it does not change

deevy still never runs agents (ADR-0003). This is software on the other side of the MCP endpoint, and it is
in the repository so CI can drive it against a real deevy on every commit — not because deevy needs it. An
instance with no runtime is a Workspace where the Humans do the work. The rule that keeps the two apart is a
convention with a test behind it: `apps/claude-agent` may not import `packages/core` and may not take a
`workspace:*` runtime dependency, so it talks to deevy the way a stranger does. That is what makes its tests
a test of ADR-0005's surfaces rather than a second view of the same objects, and it is what let M4 verify a
`deevy-signature` with something that had never seen the code that signs it.
