# deevy: the plan

Discovery output, 2026-09-03; rewritten 2026-09-24, when the Sockets milestone closed and deevy stopped being
a tracker of its own. Vocabulary is defined in [CONTEXT.md](../CONTEXT.md); the reasoning behind the
hard-to-reverse choices is in [docs/adr](./adr). Research notes that informed this plan are in
[docs/research](./research).

## What deevy is

The glue between a team's tools and its Agents. Humans and Agents collaborate as peers on the work the team
already keeps in GitHub, Linear, GitLab or Notion; deevy routes that work to Agents, records what they do,
and holds the decisions only a Human may make. Open source (AGPL-3.0), self-hosted, built first for our own
team of 2 to 10 people who use coding agents every day, with the solo developer as the zero-config case.

Four things make it different:

1. **Every Agent has a Sponsor.** An Agent is a first-class Member with its own identity, keys, and audit trail,
   and exactly one Human is accountable for it.
2. **Gates are Human decisions an Agent cannot make.** A Gate is a Run's request to go past a Checkpoint, with
   a Proposal the Human rules on, and an Agent can never rule on one.
3. **The Event log is the audit trail.** Every change is an immutable Event with actor and timestamp; webhooks,
   the live UI, notifications and what deevy says back in the tools all derive from it.
4. **deevy never runs agents, and never owns the tracker.** It triggers Agents through events and an MCP
   inbox and receives Runs back — Claude Code in CI, an Agent SDK service, the reference runtime or a local
   loop does the running — and the work stays where the team keeps it.

## What deevy became

Decided 2026-09-19, after v1 was complete and used, and built in fifteen slices by 2026-09-24. v1 was a
complete tracker of its own — Issues with `DEV-42` keys, Documents, a Workflow of States, Labels, Teams,
comments, a board — and every one of those was a thing a team already had somewhere else. Asking them to move
it into deevy, or to keep two of everything, to get the four things above was a heavy layer nobody asked for.
So the tracker came out, and deevy connects to the team's tools instead: a **Socket** is one connected tool
under one identity — a GitHub App, a Linear application, a GitLab user, a Notion integration, a Slack app.
The plan was [sockets.md](./plans/sockets.md); the choices that are expensive to reverse are
[ADR-0024](./adr/0024-an-issue-is-a-projection-of-a-record-in-a-socket.md) and
[ADR-0025](./adr/0025-the-forge-may-vouch-for-the-human-who-rules.md); what each slice found is at the end of
the plan. A clean break: the first release of this shape starts from an empty database.

## Domain model in one paragraph

A **Workspace** holds **Members** (Humans and Agents), **Sockets**, **Projects**, and settings. A Socket is a
connected tool, with capabilities: a **tracker** (GitHub, Linear, GitLab, Notion), a **forge** (GitHub,
GitLab), **docs** (Notion) and **chat** (Slack). A **Project** is a binding: the container in a tracker its
records come from, optionally the repository its code is in and where its documents live, which Agents may
work it, the default Agent, how a record names an Agent (a label prefix, a mention), its **Checkpoints**, and
how much deevy says back in the tracker. An **Issue** is a projection of a record in a tracker — its key, URL,
title, body and state as the tool last said them — routed to one Agent; deevy authors none of it. An Agent
working an Issue produces a **Run** that records who triggered it, posts **Activities** (thought, action,
elicitation, response, error), asks at Checkpoints for **Gates**, attaches **Links** and opens a pull request,
and ends in a state. A Gate carries the Agent's **Proposal** and the **Rulings** on it, made in deevy, in the
tracker or in Slack. A Human's **Identities** are their accounts on the tools, linked so a Ruling made there is
theirs. Every change becomes an **Event**. **Notifications** derive from Events and are delivered to
**Channels**: each Human's in-app inbox, a Slack room, a Slack direct message.

## Checkpoints

A Project names the points a Run stops at — `plan` and `ship` are the usual two, and any name works — each
with how many distinct Humans must approve, whether the Human the work is for may count, and who may rule. A
Checkpoint an Agent names that the Project does not list gets the default: one approval, from any Human. There
are no States and no templates: a Proposal is the Agent's own markdown, and where a team keeps plans
afterwards is the Agent's job and a Link. An approval stands for its record rather than for the attempt: a Run
that fails after its plan was approved, and the one that tries again, are the same question when the Proposal
is, and deevy answers the second with the first's approval rather than asking the Humans twice
([ADR-0026](./adr/0026-an-approval-stands-for-its-record.md)).

## The agent loop

**Triggers** that create a Run: routing a record to an Agent (a label `agent:<handle>`, an assignment or
delegation to deevy in the tool, or the Project's default Agent); mentioning an Agent in a comment on the
record; opening a sub-issue for another Agent; a schedule on an Agent.

**Delivery.** A tool tells deevy what changed at `/hooks/<socket>`, signed, and deevy asks the tool itself
when it has heard nothing for a while, so an instance no tool can reach still works. A trigger appends an
Event, creates a Run in `pending`, and delivers a signed webhook to the URL the Agent registered, with retries
and backoff from the Event log; Agents without a URL poll their inbox over MCP. Either way the Agent then reads
the record and its conversation — live from the tool — over MCP.

**Run lifecycle.** `pending` → `active` on first Activity → `awaiting_input` when the Agent asks a Gate or a
question → back to `active` when a Human rules or answers → `completed` or `failed`; `stale` after a
configurable silence (default 30 minutes), recoverable — but never while it waits on a Human. The Run's final
response carries a summary and Links.

**Gates.** An Agent at a Checkpoint asks with its Proposal and stops. The Humans who may rule are notified,
deevy says so on the record in the tracker and in Slack, and a Human rules in deevy, with `/approve` or
`/reject <why>` in a comment where they read it, or with a button in Slack — the same policy and the same
refusals through all three doors, recorded with where it came from. The Run resumes when the Gate is decided.

**Code.** A Run cloned from a Project's forge gets a credential deevy mints for that attempt, which never
leaves the runtime's supervisor; deevy opens the pull request through the forge, closing the record when it
merges.

**Accountability.** The Run records the Member that triggered it. The accountable Human for any agent action is
one hop away: the triggering Human, or the Sponsor when routing or an Agent triggered it.

## Authentication and access

- Humans sign in with GitHub, GitLab, Google, or generic OpenID Connect. No local passwords. Each provider is
  a client pair in the environment — GitLab and the OIDC provider also take an issuer — and an instance offers
  exactly the providers whose variables are set.
- A Human who signs in with a second configured provider on the same verified address links onto the user row
  they already have: one Human is one Member, with one handle and one inbox.
- A Workspace admin allowlists a GitHub organization, a GitLab group, or an email domain; matching sign-ins
  auto-join. Everyone else is invited with a link an admin sends. The first sign-in matching the configured
  admin email becomes admin.
- Every Member is a Better Auth user. Agents are token-only users created by their Sponsor, who issues and
  rotates their API keys. A suspended Sponsor suspends their Agents until someone else sponsors them.
- Agents get a fixed capability set scoped to granted Projects: read records and their conversation, comment
  and open sub-issues through the tools, read documents, add Links, ask at Checkpoints, open pull requests,
  drive their own Runs. Never administer, never manage Members, never rule on a Gate.
- A Ruling from a tool counts only when the tool signed it and the account is the Human's: the account they
  sign in with, one they linked from a signed-in session, or — where an admin allowed it, for a tool with
  nothing better — an address they verified (ADR-0025).
- MCP clients used by Humans sign in with OAuth 2.1; deevy is its own authorization server. Agents use API keys
  as bearer tokens on the same MCP endpoint.

## Surfaces

One typed core, projected three ways (ADR-0005):

- **HTTP API** defined with oRPC 2.0 (beta) procedures behind our own operation-registry type, served by Hono
  through the fetch adapter, with generated OpenAPI 3.1 and a reference UI. The React SPA uses the typed client
  with TanStack Query (ADR-0009).
- **MCP server** speaking the 2026-07-28 revision in stateless form. Tools are projected from the same
  procedures. The set is nineteen, and each says which way it faces (ADR-0016): `issues_list`, `issues_get`,
  `issues_create`, `comments_create`, `projects_get`, `docs_get`, `links_list`, `links_add`, `links_remove`,
  `inbox_list`, `gates_get`, `runs_list`, `runs_get` for anyone; `runs_start`, `runs_post_activity`,
  `gates_request`, `pulls_open`, `runs_finish` for an Agent alone, because a Run is its attempt; `runs_answer`
  for a Human alone. A client is offered what it may call. Ruling on a Gate stays off it: a Gate is a Human's to
  rule on, in a browser or from a tool that vouches for them.
- **The hooks** at `/hooks/<socket>`, beside the registry rather than through it: a tool with a signature is
  not a Member with a session.
- **Events** delivered as signed webhooks to Agents and to generic subscribers, and consumed internally by the
  SSE stream, the inbox, Slack and what deevy says back in the tools.

## Architecture

- **Runtime-agnostic core** (ADR-0006): web-standard APIs only. Two deployment shapes, operator's choice: a
  single Node process with SQLite in a Docker image, and a Cloudflare Worker with D1. The Workers build runs in
  CI on every commit.
- **Sockets behind a port.** The core holds the types a tool must answer to (`@deevy/core/sockets`); each tool
  is a module in `packages/sockets`, written on `fetch` and `crypto.subtle`, and the two entries hand the
  registry to the app. Credentials are sealed under `DEEVY_SECRET`.
- **Adapters** with a Node and a Workers implementation: storage driver, job queue (in-process outbox on Node,
  Queues on Workers), cron (timer on Node, Cron Triggers on Workers), static assets.
- **No interactive transactions in the core.** D1 has none, so multi-statement writes are batches, and every
  inbound delivery's statement count is a number a test asserts.
- **Live UI** over server-sent events fed by an Event-log cursor, with heartbeats; identical on both targets.
- **Data**: Drizzle 1.0 release candidate, pinned to the exact rc, on the SQLite dialect; `node:sqlite` on Node,
  D1 on Workers (ADR-0008). Migrations are generated by drizzle-kit and applied by the Node migrator or by
  `wrangler d1 migrations apply`. Timestamps as integers. Postgres is a later third adapter.
- **Auth**: Better Auth 1.7 with the GitHub, GitLab, Google, and generic OAuth providers, the API-key plugin, and
  the MCP plugin as OAuth authorization server (ADR-0007).
- **Toolchain**: Vite+ (`vp`) on Node 22.18+; a pnpm workspace; React with shadcn on Base UI.

Repository layout:

```
apps/web          React SPA; also the Cloudflare Worker entry
apps/server       Node entry (Hono on @hono/node-server), built with vp pack; Docker image
apps/agent        the reference agent runtime
apps/cli          the command line, generated from the operation registry
packages/core     operation registry, Event log, Gates and Checkpoints, the Socket port, MCP tool projection
packages/sockets  GitHub, Linear, GitLab, Notion and Slack, and the stub
packages/db       Drizzle schema and migrations (shared by node:sqlite and D1)
packages/adapters node/ and workers/ implementations of storage, jobs, cron, assets
```

## Notifications

Notification kinds: assignment, mention, Gate awaiting you, Run awaiting input, Run finished or failed, and
the sub-issues an Agent opened or finished. Channels: each Human's in-app inbox (always), a Slack room through
an incoming webhook or a connected Slack app, and a Slack direct message for a Human whose Slack account is
linked. Routing is both Workspace rules (this kind, for this Project, to this Channel) and per-person
preferences. A Gate in Slack carries Approve and Reject.

## Milestones

What each milestone built, written when it was built. Sockets removed a good deal of what M1, Four-eyes Gates
and Live Documents describe — the Workflow, Documents, Labels, Teams, the board — so read those as the record
of v1, and the paragraphs above as what deevy is now.

**M0 Scaffold.** Monorepo from the Vite+ template; `packages/core` with the first oRPC contracts; Drizzle
schema; Better Auth on Node with GitHub sign-in; CI running lint, typecheck, tests, the Node build, and the
Workers build. Done when a Human can sign in and see an empty Workspace.

**M1 Humans.** Workspace bootstrap and allowlist auto-join; Projects, Teams, Labels; Issues with keys, Documents,
parent links, comments, Links; the Workflow engine with States, Gates, and the default template; board and Issue
views; Event log; SSE live updates; in-app inbox. Done when our own team runs its work in deevy on the Docker
image with no agents yet.

**M2 Agents.** Agents created by Sponsors with API keys; MCP server with the v1 tool set; OAuth authorization
server for Human MCP clients; all four triggers; Runs and Activities with the stale sweep; signed webhooks with
retries; Gate approvals including URL elicitation; Slack Channel and routing rules. Done when a Claude Code loop
outside deevy picks up an assigned Issue, writes a plan Document, hits the Plan Gate, and resumes after a Human
approves in deevy.

**M3 Workers.** D1 storage adapter, an optional Queues adapter, static assets configuration, the client-ID-
metadata-document fetch transport for Workers, and the token-verification workaround for a shared Worker. Done
when the M2 scenario runs on a free Cloudflare account, which [m3-acceptance.md](./m3-acceptance.md) walks as
a numbered runbook. **That walk has been executed**, on a real account with a real GitHub OAuth App, both torn
down afterwards.

Two things shipped differently from the sentence above, both recorded in
[ADR-0012](./adr/0012-the-cron-port-stayed-node-s-and-a-stream-ends-itself.md). There is **no Workers cron
adapter**: Cloudflare owns the schedule and hands a one-shot `scheduled` handler, so the sweep itself moved
into `packages/core/src/work.ts` and the `Cron` port stayed Node's. And a **live stream on Workers ends
itself**, signing off with the cursor the browser resumes from, because each poll is one D1 query against a
per-invocation cap.

The three things M2 left are closed. The **`delivery` table has its uniqueness guard** back, as a unique
`(target, targetId, eventSeq)` with the matching one on `notification`, so a message duplicated by an
at-least-once queue costs one POST. The **v1 tool set matches the promise above**, at the twenty tools M2 had
listed; ADR-0016 later widened it to the twenty-three above and said which way each faces. And the **DNS-rebinding gap closes on Node and narrows on Workers**, which is not the single answer M2
expected: `apps/server/src/cimd.ts` resolves with `node:dns`, checks every address, and connects to one that
passed with the name kept for SNI, so the address checked is the address used. workerd has no primitive that
pins an address to a connection while preserving SNI, so the Workers transport puts a DNS-over-HTTPS
pre-resolution in front of its shape check, and the residual race is written down in
[OPERATIONS.md](./OPERATIONS.md#client-registration-and-what-is-known-to-be-weak) rather than claimed away.

**M4 Reference runtime.** `apps/agent`: a service holding one Agent's API key that finds the Issues
that Agent is assigned, runs Claude against them through the Claude Agent SDK, stops at Gates, resumes when a
Human rules, and delivers a branch and a pull request linked back to the Run that produced it. It reaches
deevy over HTTP and MCP like any third party — no `packages/core` import, no `workspace:*` dependency — which
is what makes it a test of ADR-0005's surfaces rather than a second view of them. Built in ten slices from
[m4.md](./plans/m4.md), with operator docs for both targets in [OPERATIONS.md](./OPERATIONS.md) and its own
acceptance walk in [sockets-acceptance.md](./sockets-acceptance.md) — a script rather than a runbook, which walks both
deployments on this machine with no account, no OAuth App and no repository on the internet, and runs on
every commit.

Two things shipped differently from the sentence this paragraph replaced, both recorded in ADRs. There is
**no GitHub Action**: an agent bills for thinking, a Run stopped at a Gate may wait days, and a fresh runner
pays for a clone it throws away, so the runtime is a long-running service on a laptop or in a container
([ADR-0013](./adr/0013-the-reference-runtime-is-a-service-not-a-ci-job.md)). And the webhook it consumes
**wakes the service** rather than dispatching a job, which is the whole of what a delivery has to do when the
thing that does the work is already up; polling stays on, so a missed delivery costs latency and never a Run.

The runtime's session holds file and shell tools in a checked-out repository, and everything it reads was
written by whoever has access to the Project. What bounds that — the container, the named tool list, an
environment with the runtime's own secrets removed, a git credential the session never sees, and a Gate no
Agent can approve — is
[ADR-0014](./adr/0014-an-agents-input-is-untrusted-and-its-tools-are-not.md), along with what is deliberately
not bounded.

**Harness spike.** After v1, `apps/claude-agent` became `apps/agent`: the supervisor drives a coding-agent
CLI as a subprocess behind the same session seam, four recipes are in the tree (Claude Code, OpenCode, Cursor
CLI, GitHub Copilot CLI) and shipped as one image each, the Agent's key never enters a session's process
tree, and [docs/harnesses.md](./harnesses.md) is how a fifth is added. Built in six slices from
[harnesses.md](./plans/harnesses.md), recorded in
[ADR-0018](./adr/0018-a-harness-is-a-cli-behind-the-session-seam.md).

**The agent owns git.** The harness spike left the session and the supervisor sharing a user, which meant a
shell in a session read the Agent's key and the git token out of `/proc` whatever the environment allowlist
handed it. The session is now its own user; git reaches the world through a loopback proxy that holds the
credential, so an Agent branches, commits and pushes as it likes and its checkout holds no token; the
harnesses deny no git command, because where an Agent can push is the scope of the token and the forge's
protections rather than a list the runtime wrote; and every ref a Run moves is an Activity naming both
commits and whether history was rewritten. Built in five slices from
[agent-owns-git.md](./plans/agent-owns-git.md), recorded in
[ADR-0019](./adr/0019-the-session-is-its-own-user-and-git-goes-through-the-supervisor.md).

**Sign-in and invitations.** The two things the section above promised that M1 and M2 both deferred. A sign-in
provider is now configuration rather than a constant, so GitHub, Google, GitLab and one generic OIDC provider
are each a client pair (and an issuer, for the last two) that an operator sets or leaves unset; a Human who
uses two of them stays one Member; a GitLab group is an allowlist rule beside a GitHub organization; and an
invitation is a link an admin creates for one address, accepted after sign-in as an operation with a Member
and an Event rather than a branch inside an auth hook. The dev stub that lets all of this be walked and tested
without an account anywhere answers for every provider. Built in eight slices from
[sign-in.md](./plans/sign-in.md).

**Four-eyes Gates.** The two things M1 and M2 both deferred, and the first feature off the list below. A Gate
now carries how many distinct Humans must approve before an Issue leaves it, and whether the Human who
brought the Issue there may be one of them — two settings rather than one, defaulting to one approval from
anybody, so every Workflow that existed behaves as it did. Approvals count for one visit to the Gate, which
begins when the Issue enters the State and again at every rejection; one rejection ends the matter whatever
the threshold, and the requester may still be the one to make it. A partial approval is its own
`gate.approval` Event, so `gate.approved` keeps meaning the Issue left and nothing that reads the log had to
learn a new shape. A threshold nobody could meet is refused when the Workflow is saved, and a Gate stranded
afterwards by a suspension states its arithmetic on the Issue rather than being quietly lowered. Built in
four slices from [four-eyes-gates.md](./plans/four-eyes-gates.md), recorded in
[ADR-0020](./adr/0020-a-gate-may-want-more-than-one-human-and-may-exclude-the-one-who-asked.md).

**Live Documents.** Two Members now write in one Document at the same time. A room holds the live text of
each Document and of each Issue description; carets carry names and colours, and nobody presses save — thirty
seconds of quiet cuts a version naming everybody whose keystrokes are in it, and a further quiet within ten
minutes amends that version rather than adding another, unless a Gate ruling pinned it. Lose the connection
and you keep typing, and it merges when you are back. An Agent still never joins a room: it reads markdown and
writes markdown as it always did, and the server replays what it _changed_ onto what the Document says now,
refusing the Agent rather than the Human where the two collide. One room implementation serves both
deployments — a Durable Object on the Worker, which is what the first slice existed to prove. Built in six
slices from [collaborative-documents.md](./plans/collaborative-documents.md), recorded in
[ADR-0021](./adr/0021-a-document-is-live-and-markdown-is-what-it-becomes.md).

**Agent-to-agent delegation through sub-issues.** An Agent now cuts the work it was given into sub-issues and
hands each to the Agent that should do it. It does not wait: its Run finishes with what it handed over, and
the last sub-issue closing opens a fresh Run on the parent, where it picks the work back up from what the
tracker says. A sub-issue may sit in any Project its Agent was granted and follows that Project's Workflow, so
work whose parts belong to different Projects is one tree rather than a coordination somebody does by hand.
Fan-out is bounded by three counts an admin sets per Workspace — a machine that can start other machines needs
a bottom — and a ceiling that trips is an Event, so a Sponsor can see that a number shaped the work. A wave of
sub-issues is one line in that Sponsor's inbox and not forty. Built in six slices from
[sub-issue-delegation.md](./plans/sub-issue-delegation.md), recorded in
[ADR-0022](./adr/0022-a-parent-finishes-and-the-last-child-wakes-it.md).

**Sockets.** The first milestone to remove more than it added, built in fifteen slices from 2026-09-19 to
2026-09-24. deevy stopped being a tracker and became the glue between a team's existing tools and its
Agents: an Issue is a projection of a record in a Socket, a Project is a binding, a Gate is a request on a Run
with a Proposal, and a Ruling may come from the tracker or from Slack as well as from deevy. GitHub first,
with the acceptance walk rebuilt around a Socket and run on both deployments on every commit; then rulings
from outside, the Slack app, Linear, GitLab and Notion, and a Project's documents read where the team keeps
them. Plan and findings in [sockets.md](./plans/sockets.md), decisions in
[ADR-0024](./adr/0024-an-issue-is-a-projection-of-a-record-in-a-socket.md) and
[ADR-0025](./adr/0025-the-forge-may-vouch-for-the-human-who-rules.md). A clean break: the first release of
this shape starts from an empty database. What no test can do is still owed: each provider's setup walked
once against the real tool.

**After Sockets**, in rough order: cost and time accounting per Run; per-Agent identities on a Socket
where a provider makes them cheap; Jira and Asana; email Channel; private Projects; Postgres adapter.

## Risks worth naming

- oRPC 2.0 is a beta from a single maintainer with no GA date; pin exact versions and keep the registry type ours.
- Better Auth's client-registration surface is changing weekly; pin 1.7.x and expect to chase upstream fixes.
- Drizzle 1.0 is a release candidate: queries and the Better Auth adapter are verified, but drizzle-kit has open
  migration regressions, and a fallback to 0.45 re-baselines the migration history. Decide before the first
  production migration.
- Vite+ is beta with no first-class Node server dev loop; the server dev loop is a watch-and-respawn task.
- Cursor and VS Code have not documented 2026-07-28 support; the SDK's legacy stateless mode covers them.
- D1 free-tier limits (50 queries per invocation, 100k writes per day) shape query design from M1, not M3.
