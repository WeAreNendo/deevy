# The reference agent runtime

deevy never runs an agent ([ADR-0003](../../docs/adr/0003-deevy-triggers-agents-but-never-runs-them.md)). It
gives an Agent an identity, tells it there is work, and takes a Run back; the running happens outside. This is
the outside part: a service that holds one Agent's API key, asks deevy what that Agent has been assigned, and
runs a coding-agent CLI against it — Claude Code, OpenCode, Cursor CLI or GitHub Copilot CLI, one per image
([docs/harnesses.md](../../docs/harnesses.md), [ADR-0018](../../docs/adr/0018-a-harness-is-a-cli-behind-the-session-seam.md)).

**It is not part of deevy, and deevy does not need it.** An instance with no runtime is a Workspace where the
Humans do the work. It lives in this repository so CI can drive it against a real deevy on every commit, and
because a reference implementation is worth more than a description of one.

It reaches deevy over HTTP and MCP like any third party, so it does not care which deployment it is talking
to. Point it at a Docker instance or at a `workers.dev` origin and the only thing that changes is `DEEVY_URL`.

## Running it

[`docs/OPERATIONS.md`](../../docs/OPERATIONS.md#the-reference-agent-runtime) is the operator's guide: creating
the Agent, granting it Projects, issuing its key, the repository and git credential, the webhook, the full
configuration table, and — read this one — what is bounded and what is not, per harness.

The short version, against a deevy on localhost, with the `claude` CLI on `PATH`. From the repository root:

```bash
vp run agent#build
```

Then from this directory:

```bash
DEEVY_URL=http://localhost:3000 DEEVY_AGENT_KEY=<the key> node dist/main.mjs --once
```

`--once` makes one pass and exits. Without it the loop stays up, polling every `DEEVY_AGENT_POLL_SECONDS` and
backing off while there is nothing to do. It listens on 8787: `/healthz` always, and deevy's signed webhook
deliveries when `DEEVY_AGENT_WEBHOOK_SECRET` is set — a delivery cuts the wait short so a Run starts when it
is assigned rather than at the next poll. `DEEVY_AGENT_HARNESS` picks the CLI; `claude-code` is the default.

## What it does with a Run

`runs.list` with no arguments is the queue: for an Agent that means its own Runs, and `pending` is work to do.
Nothing is remembered between passes, so a restarted container and a second host behave like the pass before.

It takes up one Run at a time, gives the session a working directory — a fresh clone of the repository deevy
names for the Run (`runs.checkout`), or the override's, or an empty directory when there is none — opens a
loopback MCP proxy that holds the Agent's key and the tool list, and spawns the harness CLI in that directory
with the proxy's URL and no credential. The model reads the record and its conversation, narrates through
`runs_post_activity`, and stops at the Checkpoints its Project lists.

A Run stopped at a Gate is not the runtime's any more. deevy moves it back to `active` the moment a Human
rules and tells the Agent so, and that Notification is what hands it back — so the runtime never polls a Gate
and never asks the same question twice.

A Run that changed files gets a branch named after the attempt, a commit, a push and a pull request that deevy
opens through the forge, and the pull request's URL becomes a Link on the record carrying the Run's id.
Nothing is ever pushed to the base branch.

Whatever the session does, the Run does not rot. One that crashes, hangs or simply stops gets an error
Activity and a failed Run, because a Run left `active` and silent tells a Human nothing until deevy's sweep
calls it `stale` half an hour later.

Each session's spend goes to deevy as it ends (`runs.reportUsage`): tokens by model with the prompt cache, and
a cost where the harness priced them, read the way each harness can (`src/harness/`, and
`docs/OPERATIONS.md`, "What it spent"). The runner holds a session's end until its process exits, because
Copilot writes its counts to a file on the way out.

## The rule that shapes this package

**No `packages/core` import, and no dependency at all.** The harness is a CLI the image installs and the
runtime finds on `PATH`; the runtime itself is `node:` and nothing else. `tests/boundary.test.ts` reads the
manifest and the sources and says so.

That is not tidiness. It is what makes this package a test of the surfaces
([ADR-0005](../../docs/adr/0005-one-core-three-surfaces.md)) rather than a second view of the same objects: if
an operation is awkward from here, that is a finding about deevy's HTTP or MCP surface, not something to work
around with an import. `src/receiver.ts` verifies deevy's `deevy-signature` with code that has never seen the
signer, and `src/proxy.ts` speaks deevy's MCP revision with code that has never seen the server — checks a
shared function could never make.

devDependencies are the exception and may reach into the workspace, because standing a real deevy up is what
they are for.

## The seam, and why no test needs an API key

```ts
type Session = (input: SessionInput) => AsyncIterable<SessionEvent>;
```

Everything else hangs off that. The real one is `buildSession` in `src/harness/run.ts`: a subprocess with
stdin closed, a home directory of its own, the recipe's argv, and its stdout read a line at a time into the
recipe's parser. A test's is four lines that yield scripted events and call back into a real deevy exactly as
the model would.

So the loop, the envelope, the Gate round trip, the working directory, the proxy and the delivery are all
testable for free — every one against a real deevy, none of them costing anything. Each harness recipe ships
its argv asserted whole, the files it writes asserted whole, and a recorded stream its parser is replayed
over. One test calls a real model and is skipped unless you ask:

```bash
DEEVY_AGENT_LIVE=1 vp run agent#test tests/live.test.ts
```

CI never sets it. A milestone whose suite needs a paid key is a milestone nobody runs twice.

## The files

| File                         | What it is                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/config.ts`              | Everything it reads from the environment, once, never at module scope.                                                            |
| `src/deevy.ts`               | deevy over HTTP, hand-written, narrow: the operations the supervisor itself calls.                                                |
| `src/proxy.ts`               | deevy's MCP endpoint as the session sees it: loopback, no credential, the tool list enforced.                                     |
| `src/session.ts`             | The seam, and the five events the supervisor has an opinion about.                                                                |
| `src/harness/contract.ts`    | What a recipe is: binary, environment, strip list, `prepare`, argv, parser, bounds.                                               |
| `src/harness/run.ts`         | The one way a harness runs: the subprocess, the session's home, the strip, the timeout, the `done` an exit code implies.          |
| `src/harness/claude-code.ts` | Claude Code on `claude -p`. Also `opencode.ts`, `cursor.ts`, `copilot.ts`; `index.ts` is the registry.                            |
| `src/instructions.md`        | What the session is told about working an Issue. The original of the snippet in [`docs/agent-loop.md`](../../docs/agent-loop.md). |
| `src/work.ts`                | One pass and one Run: discovery, the claim, the envelope, the resume.                                                             |
| `src/workspace.ts`           | A clone per Run, and the credential the session never sees.                                                                       |
| `src/deliver.ts`             | The branch, the push, and the pull request deevy opens for it.                                                                    |
| `src/loop.ts`                | Staying up: a sequential loop, backoff, and a stop that finishes the sentence.                                                    |
| `src/receiver.ts`            | `/healthz`, and deevy's signed deliveries.                                                                                        |
| `src/main.ts`                | The process.                                                                                                                      |
| `src/index.ts`               | What the package exports, for the acceptance script and for anyone embedding it.                                                  |
| `harness.sh`                 | Installs one CLI at a pinned version; the Dockerfile's `HARNESS` build argument names which.                                      |
| `scripts/acceptance.ts`      | The milestone's own walk, on both deployments, with nothing outside this machine. CI runs it.                                     |
| `scripts/boot.ts`            | Starting deevy on either deployment locally, with the outside world stubbed.                                                      |

## Copying it into your own repository

It is meant to be copied. Two things need doing when you do:

- **Pin the CLI.** `harness.sh` names the version each recipe was tested against. Every one of these CLIs
  moves monthly, and what moves is the flag that decides what an agent with a shell may do.
- **Take the tests.** `tests/helpers.ts` stands a real deevy up in-process; that is the part worth keeping,
  and it is the part that will tell you when you have broken something.

## Where the decisions are

- [ADR-0018](../../docs/adr/0018-a-harness-is-a-cli-behind-the-session-seam.md) — why the harness is a CLI
  behind the seam, and why the key stays with the supervisor.
- [ADR-0013](../../docs/adr/0013-the-reference-runtime-is-a-service-not-a-ci-job.md) — why this is a service
  and not a GitHub Action, and what that costs.
- [ADR-0014](../../docs/adr/0014-an-agents-input-is-untrusted-and-its-tools-are-not.md) — Issue text is
  written by anyone with Project access and reaches a session holding a shell. What bounds that, and what does
  not.
- [`docs/harnesses.md`](../../docs/harnesses.md) — the four recipes, and how to add a fifth.
- [`docs/plans/m4.md`](../../docs/plans/m4.md) and [`docs/plans/harnesses.md`](../../docs/plans/harnesses.md)
  — the slices this was built in, each with what building it found.
- [`docs/sockets-acceptance.md`](../../docs/sockets-acceptance.md) — the acceptance walk, which is a script:
  `vp run agent#acceptance`. A record in a stubbed tracker becomes a Run, a Proposal, a ruling, a branch, a
  pull request and a finish, on both deployments, with nothing outside this machine. CI runs it on every
  commit, and what it found is written down there.
