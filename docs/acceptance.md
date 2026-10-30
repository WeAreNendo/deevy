# Acceptance: a record in somebody else's tracker, worked end to end

deevy is done with a change when a record a team keeps in their own tracker still becomes a Run, a Proposal,
a ruling, a branch, a pull request and a finish — with an Agent holding nothing but its key, on the Node
deployment, and then on a Cloudflare Worker and in a hosted Workspace built from the same commit, with
nothing changing but the URL. That last part is the strongest evidence for
[ADR-0006](./adr/0006-runtime-agnostic-core-node-first.md) anyone has produced: a client that cannot tell the
deployments apart.

**Status: executed, and executed on every commit.** It is a script rather than a runbook, and it needs no
Cloudflare account, no GitHub OAuth App, no GitHub App, no tunnel and no repository on the internet:

```bash
vp run -F '!@deevy/docs' build && vp run web#build:workers && vp run hosted#build:hosted
vp run acceptance#walk
```

A hundred and fifteen checks: twenty-eight against each of four deployments, and three comparing each Event
log with Node's. The four are the image, the Worker, the image again under a path (`/deevy`), and a hosted
Workspace at `/acme` behind the many-Workspaces Worker, provisioned through `Platform` and signed in through
the relay at the root of the host (ADR-0028, ADR-0030). CI runs it after the Workers and hosted smokes,
which leave both Workers built. The walk is `tools/acceptance`: `src/walk.ts` is the walk and `src/boot.ts`
starts each deployment.

## Why it needs nothing outside this machine

| What the walk needs                         | What it uses instead                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A deployed Worker                           | `wrangler dev --local` — miniflare with a real local D1, no account                                                |
| The Docker image                            | The packed Node bundle, on a port it picks                                                                         |
| An OAuth App, so a Human can sign in        | `apps/web/scripts/stub-oauth.js`, prepended to whichever bundle is under test: the OAuth code is the email address |
| A GitHub App, so deevy has a tracker        | The Socket provider that is not a tool (`packages/sockets/src/stub`), registered by `DEEVY_DEV_STUB_SOCKETS=1`     |
| A public URL, so a delivery can reach deevy | A signed POST to `/hooks/:socketId`, computed by the walk itself over the bytes on the wire                        |
| A repository the Agent may push to          | A bare git repository in a temporary directory, and real `git`                                                     |
| A model, and whatever runs it               | A scripted Agent — see below                                                                                       |

Nothing is mocked on deevy's side. The Worker is the built Worker with its own bindings and asset routing;
the Node server is the bundle the Docker image runs; sign-in is Better Auth's real OAuth dance with only the
far end replaced; the delivery goes through the real `/hooks` route, the real signature check and the real
`applyInbound`; and everything the Agent does goes over `/mcp` and `/api` on a socket.

The stub is a real tracker with an in-memory store, and it is the deployment's, not the walk's: a store lives
in the process deevy runs in, so the walk says what the tracker holds before it starts one
(`DEEVY_DEV_STUB_CONTAINERS=acme/deevy`) and reaches it afterwards only the way anyone else would — through
deevy. It names the container and nothing about the code: deevy never learns where the repository is.

## What is real, and what is scripted

**deevy is real**: the Human's surface, the hooks, `/mcp` and `/api` as an Agent's key reaches them, the
Gates and their Checkpoints, the Rulings from the tracker, and what deevy says back there.

**Whatever runs the Agent is scripted.** deevy runs no Agent and manages no access
([simplify.md](./plans/simplify.md)), so the scripted Agent does exactly what any harness does: it finds its
work with `inbox_list` and `runs_list`, reads the record with `issues_get`, narrates with
`runs_post_activity`, asks with `gates_request`, reads the Ruling with `gates_get`, clones and pushes with
its own `git`, attaches the pull request it opened with `links_add`, and ends with `runs_finish`. It marks its
inbox read over `/api`, as a loop does rather than a model. Its key is the only thing deevy gave it.

**What this cannot stand in for is a model.** A scripted Agent always calls the right tool in the right
order; a model may not. Pointing a real coding agent at a deployment this script starts, with an Agent's key
(apps/docs/content/agents/your-own-harness.md), is the manual step.

## What it walks

1. **A Human connects a tool**, over the surface the SPA calls, after signing in. Connecting proves the
   connection by asking who deevy is there. Then a Project bound to that Socket's container, its Checkpoints
   (`plan`, and a `ship` that wants somebody other than the Human the work is for), an Agent, the grant that
   makes the Project exist to it, and a key shown once.
2. **The work arrives as a record**, opened in the tracker through the Socket and projected. Nobody is
   routed yet: it is a record like any other in the team's backlog.
3. **The tracker says it is for the Planner**, as a signed delivery carrying the record with an
   `agent:planner` label. deevy routes it and opens a Run. The same delivery twice is one delivery; an
   unsigned one is 401 and changes nothing.
4. **The Agent finds its work.** The label put an `assignment` in its inbox and opened one Run in `pending`.
   The record it reads is the tracker's, and carries the Checkpoints this Project asks for; it says what it
   intends to do and stops at the `plan` Gate, and its Run is `awaiting_input`.
5. **deevy says so where the team reads.** The Proposal becomes a comment in the tracker, signed with the
   Agent and the Run id. (The `deevy:awaiting-approval` label that goes with it is the same delivery and is
   asserted against the tracker's own state in `packages/core/tests/mirror.test.ts`.)
6. **A Run nobody has ruled on stays at its Gate**, whatever the sweeps do meanwhile.
7. **The Human rules from the tracker**, where they read the Proposal. First an account nobody linked
   comments `/approve`: it rules nothing, the Gate stays open, and deevy answers on the record with where to
   link it. Then the admin comments `/approve` with a note from the GitHub account they signed in to deevy
   with — no linking step — and the Gate records the Ruling `via: socket`. A `run_answered` lands in the
   Agent's inbox, the Run is `active` again, and `gates_get` carries the decision and the note. The Agent
   pushes its own branch, attaches its pull request, and stops at the `ship` Gate.
8. **Four eyes, from both doors.** The Human the Run is for is refused at that Checkpoint in deevy, and from
   the tracker, in the same words. Somebody else rules in deevy and the Gate records it `via: web`; the
   Agent hears it in its inbox, its Run is `active` again, and it finishes.
9. **The evidence.** There is exactly one pull request on the record, the one the Agent attached,
   attributed to the Run that produced it, and the ruling is said back in the tracker too. What reached the
   remote is the Agent's own push, so the walk checks nothing of deevy's there.
10. **The record.** The Event log reads
    `run.started run.activity gate.requested run.awaiting_input gate.ruling_refused identity.linked
gate.approved run.answered issue.link_added gate.requested run.awaiting_input gate.ruling_refused
gate.approved run.answered run.completed`, with the Agent as actor throughout and the Human exactly one hop
    away at the Events that are theirs — the label that routed the work, the two rulings, and each ruling
    reaching the Run — and the tracker's own at the two refusals and the account it came to know.
11. **The same walk on the other deployments**, and each Event log is compared with Node's.

## Whose account is whose

The stub's accounts are GitHub's sign-in accounts because the walk connects it with
`config: { signInProvider: "github" }`, which is how github.com's Socket behaves and a GitHub Enterprise
Server's does not. The sign-in stub gives a Human their address as their GitHub account id, so the admin's
`/approve` carries `ada@example.com` as its author id, and that is what Better Auth's `account` row holds.
A login is never matched, which is why the stranger in step 7 is named by an id nobody signed in with.

## Running it against something else

```bash
vp run acceptance#walk -- --url https://deevy.example.com
```

It walks whatever is there. It connects a Socket, creates a Project `deevy` and an Agent `Planner`, and
writes records into whatever tracker that Socket reaches — so point it at an instance you do not mind it
writing to, and expect it to need `DEEVY_DEV_STUB_SOCKETS=1` and a container of its own. Signing in still
goes through the sign-in stub, so against an instance that was not started this way the sign-in step is the
one that will fail. Set `DEEVY_ACCEPTANCE_REPO` to a bare repository the Agent may clone and push to; the
walk does not start without one, because the Agent's git is its own and deevy cannot say where the code is.

## What the walk found

**Moving it out of the runtime** (simplify.md, slice 0) found nothing in deevy. The walk had driven
the reference runtime's supervisor, so what deevy did and what the supervisor did were one story; with the
supervisor gone, four kinds of Event left it, each one appended by deevy for a call only the supervisor
made: `run.checkout_issued` (its checkout), `run.pull_request_opened` (it opened the pull request through
deevy), `run.usage_reported` (it reported each session's spend) and a `comment.created` (it commented on the
record when it delivered), along with the Activity it wrote for each ref a session moved. Slice 2 then
removed the checkout and `pulls.open` themselves, and slice 3 removes Usage. And the old walk proved one thing
about deevy only in passing: that a Ruling puts its Run back to `active`, because the supervisor resumed
nothing else. The new walk checks it after each Ruling.

Rewriting it around a Socket found five things, and each was a defect rather than a surprise:

- **A Run waiting at a Gate was un-waited by anything said to it.** The supervisor writes one such Activity
  itself — what refs the session moved — after the session that asked for the Gate has ended, which moved the
  Run back to `active` and put it under the stale sweep. A Run that is waiting now keeps waiting; only a
  Human un-waits one.
- **And it was said twice.** `run.awaiting_input` was appended whenever an Activity left a Run waiting,
  including one that was already waiting, so a Human got a second Notification about one question.
- **Two pull requests for one attempt.** The instructions tell the Agent to open it and the supervisor opens
  one for any branch a session pushed and left. `pulls.open` answered with the one the Run already had, until
  slice 2 removed it.
- **A Project with no repository cost a 404 a pass.** The supervisor asks for a checkout on every Run it
  takes up, and a Project bound to a tracker and nothing else is ordinary; `runs.checkout` answered null
  rather than refusing, so nothing lands in an operator's log on nothing going wrong.
- **The stub handed deliveries back without their clocks.** `normalize` reads a parsed body and answers
  deevy's own types, two of which are Dates; a string reached `getTime` on the first record deevy was told
  about.

Two more were in the walk itself rather than in deevy: the seed's sign-in was reaching the real github.com
(the stub answers everything after the `code`, not the authorization page a person would click), and both
deployments shared one bare repository, which made the second push a non-fast-forward.

## Recording the result

The script is the record: a failing check names itself and what it saw. When something is added to deevy,
add its check here rather than to a document nobody executes — a walk that runs on every commit is the only
kind that stays true.
