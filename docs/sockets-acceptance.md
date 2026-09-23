# Sockets acceptance: a record in somebody else's tracker, worked end to end

The Sockets milestone is done when a record a team keeps in their own tracker becomes a Run, a Proposal, a
ruling, a branch, a pull request and a finish — with `apps/agent` driving it rather than a person driving
Claude Code by hand, on the Node deployment, and then on a Cloudflare Worker built from the same commit with
nothing changing but `DEEVY_URL`. That last part is the strongest evidence for
[ADR-0006](./adr/0006-runtime-agnostic-core-node-first.md) anyone has produced: a client that cannot tell the
two deployments apart.

**Status: executed, and executed on every commit.** It is a script rather than a runbook, and it needs no
Cloudflare account, no GitHub OAuth App, no GitHub App, no tunnel and no repository on the internet:

```bash
vp run agent#acceptance
```

Fifty-three checks, twenty-six against each deployment plus one comparing them. CI runs it after the Workers
smoke.

## Why it needs nothing outside this machine

| What the walk needs                         | What it uses instead                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A deployed Worker                           | `wrangler dev --local` — miniflare with a real local D1, no account                                                |
| The Docker image                            | The packed Node bundle, on a port it picks                                                                         |
| An OAuth App, so a Human can sign in        | `apps/web/scripts/stub-oauth.js`, prepended to whichever bundle is under test: the OAuth code is the email address |
| A GitHub App, so deevy has a tracker        | The Socket provider that is not a tool (`packages/sockets/src/stub`), registered by `DEEVY_DEV_STUB_SOCKETS=1`     |
| A public URL, so a delivery can reach deevy | A signed POST to `/hooks/:socketId`, computed by the walk itself over the bytes on the wire                        |
| A repository the Agent may push to          | A bare git repository in a temporary directory, and real `git`                                                     |
| A pull-request API                          | The same stub Socket, which is a forge as well as a tracker                                                        |
| A model, and a coding-agent CLI to drive it | A scripted session — see below                                                                                     |

Nothing is mocked on deevy's side. The Worker is the built Worker with its own bindings and asset routing;
the Node server is the bundle the Docker image runs; sign-in is Better Auth's real OAuth dance with only the
far end replaced; the delivery goes through the real `/hooks` route, the real signature check and the real
`applyInbound`; and everything the runtime does goes over HTTP and `/mcp` on a socket.

The stub is a real tracker with an in-memory store, and it is the deployment's, not the walk's: a store lives
in the process deevy runs in, so the walk says what the tracker holds before it starts one
(`DEEVY_DEV_STUB_CONTAINERS=acme/deevy=/tmp/…/origin.git`) and reaches it afterwards only the way anyone
else would — through deevy.

## What is real, and what is scripted

**The supervisor is real.** Discovery, the claim, the checkout, the envelope, the Gate round trip, the
working directory, the branch, the push, the pull request and what deevy says back in the tracker are
`apps/agent/src` and `packages/core` doing their own jobs.

**The model's judgement is scripted**, and the scripted session writes over `/mcp` with the Agent's key
exactly as Claude would — `issues_get`, `runs_post_activity`, `gates_request`, `pulls_open`, `runs_finish`.
So the surface is the real one even though the reasoning is not.

The scripted session reaches deevy the way a real one does, through the supervisor's loopback proxy with no
credential, and the walk checks that a tool the runtime did not grant is refused there — including
`runs_checkout`, which is not a tool at all. Which CLI would have been spawned does not enter the walk: the
supervisor is harness-blind, and each image's smoke in CI is what proves its CLI is there.

**What this cannot stand in for is the model.** A scripted session always calls the right tool in the right
order; a model may not. That is `apps/agent/tests/live.test.ts`, skipped unless you ask:

```bash
DEEVY_AGENT_LIVE=1 vp run agent#test tests/live.test.ts
```

It needs an Anthropic key and spends money, so CI never runs it. **It has not been run.** Pointing it at
either deployment this script starts is the remaining manual step, and the only one.

## What it walks

1. **A Human connects a tool**, over the surface the SPA calls, after signing in. Connecting proves the
   connection by asking who deevy is there. Then a Project bound to that Socket twice — where its records
   live and where its code lives — its Checkpoints (`plan`, and a `ship` that wants somebody other than the
   Human the work is for), an Agent, the grant that makes the Project exist to it, and a key shown once.
2. **The work arrives as a record**, opened in the tracker through the Socket and projected. Nobody is
   routed yet: it is a record like any other in the team's backlog.
3. **The tracker says it is for the Planner**, as a signed delivery carrying the record with an
   `agent:planner` label. deevy routes it and opens a Run. The same delivery twice is one delivery; an
   unsigned one is 401 and changes nothing.
4. **The first pass.** The Run is taken up; the session is refused `runs_checkout` at the proxy and the
   refusal lands in the Run's feed in the Agent's name; the record it reads is the tracker's, and carries the
   Checkpoints this Project asks for; it says what it intends to do and stops at the `plan` Gate. Nothing is
   delivered by a Run that only asked, and the working directory it was given holds a loopback `origin` and
   no credential.
5. **deevy says so where the team reads.** The Proposal becomes a comment in the tracker, signed with the
   Agent and the Run id. (The `deevy:awaiting-approval` label that goes with it is the same delivery and is
   asserted against the tracker's own state in `packages/core/tests/mirror.test.ts`: what `issues.get`
   answers is deevy's projection, whose labels are whatever the tracker last said, not what deevy last
   asked for.)
6. **A pass over a Run nobody has ruled on** reports it and does not work it. A Run waiting on a Human is not
   the runtime's, however long it waits.
7. **The Human rules**, with a note. The next pass resumes the Run — because deevy moved it back to `active`
   and told the Agent so — and the resumed session's prompt carries the decision and the note. That session
   pushes its own branch, opens the pull request through deevy, and stops at the `ship` Gate.
8. **Four eyes.** The Human the Run is for is refused at that Checkpoint, in the words the Checkpoint uses.
   Somebody else rules, the Run comes back a second time, and it finishes.
9. **The evidence.** The branch the session pushed is on the remote and `main` is untouched; there is exactly
   one pull request, opened in the tracker rather than by the runtime, attached to the record and attributed
   to the Run that produced it; and the ruling is said back in the tracker too.
10. **The record.** The Event log reads
    `run.started run.checkout_issued run.activity run.activity gate.requested run.awaiting_input
gate.approved run.answered run.checkout_issued issue.link_added run.pull_request_opened gate.requested
run.awaiting_input run.activity comment.created gate.approved run.answered run.checkout_issued
run.completed`, with the Agent as actor throughout and the Human exactly one hop away at the Events that
    are theirs — the label that routed the work, the two rulings, and each ruling reaching the Run.
11. **The same walk on the other deployment**, and the two Event logs are compared to each other.

## What is not here, and why

A Ruling made **in the tracker** — `/approve` on the record, by the Human whose account wrote it — is the
other half of [ADR-0025](./adr/0025-the-forge-may-vouch-for-the-human-who-rules.md) and is slice 9's, not
this one. `applyInbound` says so in as many words: deevy cannot yet tell whose account wrote a comment,
so a Ruling it cannot attribute is one it will not take. The walk rules in deevy, which is the canonical
door, and slice 9 adds the tracker's to this same script.

## Running it against something else

```bash
vp run agent#acceptance -- --url https://deevy.example.com
```

It walks whatever is there. It connects a Socket, creates a Project `deevy` and an Agent `Planner`, and
writes records into whatever tracker that Socket reaches — so point it at an instance you do not mind it
writing to, and expect it to need `DEEVY_DEV_STUB_SOCKETS=1` and a container of its own. Signing in still
goes through the sign-in stub, so against an instance that was not started this way the sign-in step is the
one that will fail. Set `DEEVY_ACCEPTANCE_REPO` to the bare repository behind that container if you want the
branch check to mean anything.

## What the walk found

Rewriting it around a Socket found five things, and each was a defect rather than a surprise:

- **A Run waiting at a Gate was un-waited by anything said to it.** The supervisor writes one such Activity
  itself — what refs the session moved — after the session that asked for the Gate has ended, which moved the
  Run back to `active` and put it under the stale sweep. A Run that is waiting now keeps waiting; only a
  Human un-waits one.
- **And it was said twice.** `run.awaiting_input` was appended whenever an Activity left a Run waiting,
  including one that was already waiting, so a Human got a second Notification about one question.
- **Two pull requests for one attempt.** The instructions tell the Agent to open it and the supervisor opens
  one for any branch a session pushed and left. `pulls.open` answers with the one this Run already has.
- **A Project with no repository cost a 404 a pass.** The supervisor asks for a checkout on every Run it
  takes up, and a Project bound to a tracker and nothing else is ordinary; `runs.checkout` answers null
  rather than refusing, so nothing lands in an operator's log on nothing going wrong.
- **The stub handed deliveries back without their clocks.** `normalize` reads a parsed body and answers
  deevy's own types, two of which are Dates; a string reached `getTime` on the first record deevy was told
  about.

Two more were in the walk itself rather than in deevy: the seed's sign-in was reaching the real github.com
(the stub answers everything after the `code`, not the authorization page a person would click), and both
deployments shared one bare repository, which made the second push a non-fast-forward.

## Recording the result

The script is the record: a failing check names itself and what it saw. When something is added to the
milestone, add its check here rather than to a document nobody executes — a walk that runs on every commit is
the only kind that stays true.
