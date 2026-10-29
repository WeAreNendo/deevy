# deevy runs no agent and manages no access

Supersedes [ADR-0013](./0013-the-reference-runtime-is-a-service-not-a-ci-job.md),
[ADR-0014](./0014-an-agents-input-is-untrusted-and-its-tools-are-not.md),
[ADR-0018](./0018-a-harness-is-a-cli-behind-the-session-seam.md) and
[ADR-0019](./0019-the-session-is-its-own-user-and-git-goes-through-the-supervisor.md), and makes
[ADR-0003](./0003-deevy-triggers-agents-but-never-runs-them.md) true again. Planned in
[simplify.md](../plans/simplify.md).

ADR-0003 said deevy triggers Agents and never runs them. M4 then shipped `apps/agent`, a reference runtime
beside deevy: a service holding one Agent's key that drove a coding-agent CLI against each Run, published as
one image per harness. It was meant as proof that the surfaces were enough, and it became the part of the
tree that took the most hardening. A session holds a shell in a clone that anyone with Project access can
write into, so the runtime grew a second user for the session, a loopback proxy for the key, a git proxy for
the credential, and a ledger of what each Run moved. Each fix found the next gap: git running as root in the
session's clone, the ledger reading a remote the session could repoint, a same-user session able to stop the
ledger's reads, pushes the proxy ran concurrently, ancestry read from objects the session wrote. None of
that is what deevy is for.

deevy is the glue between a team's tools and its Agents. Its value is the record it keeps and the Gate it
holds, and every tool and every coding agent is one more thing it should reach cheaply. A runtime made deevy
answerable for the inside of a session it can neither see nor bound.

## The decision

**deevy ships nothing that runs an Agent, and manages no access to what an Agent works on.** An Agent is
whatever holds its key: a coding agent on a laptop, a service of the team's own, a CI job. deevy gives it an
identity, tells it there is work, and takes a Run back.

- **It learns there is work** from its MCP inbox, and from a signed webhook to its URL if it registered one
  (ADR-0003, ADR-0005). That includes a Ruling on its Gate, which arrives as `run_answered`.
- **Its access to code is its operator's.** deevy holds no git credential for a Run and mints none. The
  operator gives the Agent a deploy key, a token or an App of its own, scoped as they see fit.
- **Its pull request is its own.** The Agent opens it with that access and attaches it to its Run as a Link.
  deevy learns the record closed when the tracker says so.
- **What it spent is not deevy's to count.** Nothing in deevy could know it, and a model cannot report its
  own tokens. deevy keeps the time a Run worked and waited, which it derives from its own Events.

What stays exactly as it was: no Agent rules on a Gate (ADR-0004), a delegated credential decides nothing
(ADR-0010), and an Agent is denied every operation that does not say otherwise (ADR-0011). The Gate is still
the boundary that matters: nothing an Agent proposes ships without a Human deciding it should.

## How it lands

In slices of [simplify.md](../plans/simplify.md). Slice 0 moved the acceptance walk out of the runtime: a
scripted Agent that holds only its key now walks every deployment. Slice 1 deleted `apps/agent`, its four
images, the Compose service and the runtime's documentation. Slice 2 removes `runs.checkout`, the forge's
credential and `pulls.open`, and slice 3 removes token Usage. The CLAUDE.md snippet in
[agent-loop.md](../agent-loop.md) is the instructions a harness copies, and the public docs say how to
connect one.

## What it costs

- **No Agent out of the box.** A team connects the coding agent it already uses. The docs and the
  Settings page show the configuration for Claude Code, OpenCode, Cursor and Copilot.
- **Bounding a session is the operator's job.** The container, the tool list, the environment and the
  credential's scope used to be the runtime's, and ADR-0014 recorded what they bounded. Now whoever runs the
  Agent decides them.
- **Fixes that will not ship.** The runtime's last two security fixes, git as the session's user in its
  clone and the ledger reading the remote, were merged after 0.11.4 and are never released. The release
  notes tell anyone running a `deevy-agent` image to stop.
- **No numbers to budget on.** Budgets per Run and per Agent leave the plan until there is a reporter deevy
  can trust.

## Why not the alternatives

**Keep the runtime and stop hardening it.** That leaves four images and a supervisor in every release, with
known gaps documented and unfixed. A runtime that deevy ships is one people trust because deevy shipped it.

**Keep one thin example.** A small Claude Code loop as sample code that is published as nothing. The
CLAUDE.md snippet and the MCP configuration already are that example, and they are what a team copies.

**Move it to a repository of its own.** That leaves the same code with the same gaps, under a name that
still says deevy.

**Dispatch a GitHub Actions workflow on each assignment and Ruling.** That makes the team's Actions the
runtime, but it adds code where this decision removes it, ties waking to GitHub, and brings back what
ADR-0013 measured: a runner that spends its minutes thinking, and a fresh clone on every wake.
