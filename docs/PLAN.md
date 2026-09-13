# deevy: v1 plan

Discovery output, 2026-09-03. Vocabulary is defined in [CONTEXT.md](../CONTEXT.md); the reasoning behind the
hard-to-reverse choices is in [docs/adr](./adr). Research notes that informed this plan are in
[docs/research](./research).

## What deevy is

Project management where Humans and Agents collaborate as peers on the same Issues. Open source (AGPL-3.0),
self-hosted, built first for our own team of 2 to 10 people who use coding agents every day, with the solo
developer as the zero-config case.

Four things make it different from Plane, Linear, It's a Plan, Paperclip, and Vikunja's bot users:

1. **Every Agent has a Sponsor.** An Agent is a first-class Member with its own identity, keys, and audit trail,
   and exactly one Human is accountable for it.
2. **Gates are a workflow primitive.** A Gate is a State an Issue cannot leave without a Human's approval, and an
   Agent can never approve one.
3. **The Event log is the audit trail.** Every change is an immutable Event with actor and timestamp; webhooks,
   live UI, notifications, and metrics all derive from it.
4. **deevy never runs agents.** It triggers them through events and an MCP inbox, and receives Runs back. Claude
   Code in CI, an Agent SDK service, a GitHub Action, or a local loop does the running.

Everything else is deliberately conventional so agents and humans already know how to use it: Issues with keys
like `DEV-42`, Projects, Teams, Labels, a board, comments, links to pull requests.

## Domain model in one paragraph

A **Workspace** holds **Members** (Humans and Agents), **Teams**, **Projects**, Labels, and settings. A Team owns
Projects and can be mentioned; it is not a permission wall, and every Human sees every Project in v1. A Project
has a **Workflow**: an ordered list of **States**, some of which are **Gates**, plus rules that fire on entering
a State. An **Issue** belongs to a Project, has a key, a Description, named **Documents** (intent, spec, plan,
each versioned markdown with a template from its State), Labels (plain or scoped, one per scope), an optional
parent Issue, one **Assignee** (Human or Agent), comments, and typed **Links** to pull requests, commits,
branches, and URLs. An Agent working an Issue produces a **Run** that records who
triggered it, posts **Activities** (thought, action, elicitation, response, error), attaches evidence and
Links, and ends in a state. Every change becomes an **Event**. **Notifications** derive from Events and are
delivered to **Channels**: each Human's in-app inbox, and Slack.

## Default workflow template

Intent → Spec → Plan → Build → Review → Done, with Gates on leaving Intent, Spec, Plan, and Review. Each of the
first three States supplies a Document template following the playbook's headings (Problem, Proposed outcome,
Affected users and systems, Constraints, Open questions for intent; requirements, design, and flagged concerns
for spec; files that change, order of work, tests that prove it for plan). Teams that want Todo, Doing, Done
delete the middle. Sizing is binary: fits in one PR, or needs an intent. No estimates.

## The agent loop

**Triggers** that create a Run: assigning an Issue to an Agent; mentioning an Agent in a comment; a workflow
rule on entering a State (for example, entering Plan assigns the planning Agent); a schedule on an Agent.

**Delivery.** A trigger appends an Event, creates a Run in `pending`, and delivers a signed webhook to the URL
the Agent registered, with retries and backoff from the Event log. Agents without a URL poll their inbox over
MCP. Either way the Agent then reads the Issue and its Documents over MCP.

**Run lifecycle.** `pending` → `active` on first Activity → `awaiting_input` when the Agent posts an elicitation
→ back to `active` when a Human answers → `completed` or `failed`; `stale` after a configurable silence (default
30 minutes), recoverable. The Run's final response carries a summary and Links. This is the shape Linear, Plane,
and Notion converged on, so existing agents port with a thin adapter.

**Gates.** When an Issue reaches a Gate, Humans with Project access (or the approvers the Gate names) get a
Notification. Approval or rejection is an Event. An Agent that reaches a Gate mid-Run can surface it as a URL
elicitation so the Human approves in deevy and the Agent resumes. One approval from anybody, with no
requester-cannot-approve rule, was v1; both are now settings on the Gate (see Four-eyes Gates, below).

**Accountability.** The Run records the Member that triggered it. The accountable Human for any agent action is
one hop away: the triggering Human, or the Sponsor when an Agent triggered it.

## Authentication and access

- Humans sign in with GitHub, GitLab, Google, or generic OpenID Connect. No local passwords. Each provider is
  a client pair in the environment — GitLab and the OIDC provider also take an issuer, so a self-hosted GitLab
  and any one IdP behind Okta, Entra, Keycloak or Authentik work — and an instance offers exactly the
  providers whose variables are set, reported publicly by `health.ping` and rendered as one button each.
- A Human who signs in with a second configured provider on the same verified address links onto the user row
  they already have: one Human is one Member, with one handle and one inbox.
- A Workspace admin allowlists a GitHub organization, a GitLab group, or an email domain; matching sign-ins
  auto-join. Everyone else is invited: an admin creates an invitation for one address and gets a URL to send
  however they like, good for seven days, spent after sign-in by the Human whose address it names. deevy sends
  no email until the email Channel exists, and never needs to. The first sign-in matching the configured admin
  email becomes admin.
- Every Member is a Better Auth user. Agents are token-only users created by their Sponsor, who issues and
  rotates their API keys. A suspended Sponsor suspends their Agents until someone else sponsors them.
- Agents get a fixed capability set scoped to granted Projects: read and write Issues, comment, create and
  update Runs. Never administer, never manage Members, never approve a Gate.
- MCP clients used by Humans sign in with OAuth 2.1; deevy is its own authorization server. Agents use API keys
  as bearer tokens on the same MCP endpoint.

## Surfaces

One typed core, projected three ways (ADR-0005):

- **HTTP API** defined with oRPC 2.0 (beta) procedures behind our own operation-registry type, served by Hono
  through the fetch adapter, with generated OpenAPI 3.1 and a reference UI. The React SPA uses the typed client
  with TanStack Query (ADR-0009).
- **MCP server** speaking the 2026-07-28 revision in stateless form through the TypeScript SDK v2 per-request
  handler, serving 2025-era clients through the SDK's legacy stateless mode. Tools are projected from the same
  oRPC procedures by walking the router and registering each procedure's schemas. The set is twenty-three
  tools, and each says which way it faces (ADR-0016): `issues_list`, `issues_get`, `issues_create`,
  `issues_update`, `issues_move`, `issues_set_labels`; `projects_get`; `documents_get`, `documents_write`;
  `comments_create`; `labels_list`, `labels_create`; `links_list`, `links_add`, `links_remove`; `inbox_list`;
  `runs_list`, `runs_get` for anyone; `runs_start`, `runs_post_activity`, `runs_request_approval`,
  `runs_finish` for an Agent alone, because a Run is its attempt; `runs_answer` for a Human alone. A client
  is offered what it may call. Renaming or deleting a Label, and ruling on a Gate, stay off it: a Label is
  Workspace-scoped and a Gate is a Human's to rule on.
- **Events** delivered as signed webhooks to Agents and to generic subscribers, and consumed internally by the
  SSE stream, the inbox, and Slack.

## Architecture

- **Runtime-agnostic core** (ADR-0006): web-standard APIs only. Two deployment shapes, operator's choice: a
  single Node process with SQLite in a Docker image (first), and a Cloudflare Worker with D1 (second). The Workers
  build runs in CI from day one.
- **Adapters** with a Node and a Workers implementation: storage driver, job queue (in-process outbox on Node,
  Queues on Workers), cron (timer on Node, Cron Triggers on Workers), static assets. Webhook delivery and the
  stale-Run sweep are adapter operations.
- **No interactive transactions in the core.** D1 has none, so multi-statement writes are batches behind the
  storage adapter.
- **Live UI** over server-sent events fed by an Event-log cursor, with heartbeats; identical on both targets.
- **Data**: Drizzle 1.0 release candidate, pinned to the exact rc, on the SQLite dialect; `node:sqlite` on Node,
  D1 on Workers (ADR-0008). Migrations are generated by drizzle-kit and applied by the Node migrator or by
  `wrangler d1 migrations apply`, never by drizzle-kit against D1. Timestamps as integers. Postgres is a later
  third adapter.
- **Auth**: Better Auth 1.7 with the GitHub, GitLab, Google, and generic OAuth providers, the API-key plugin, and
  the MCP plugin as OAuth authorization server (ADR-0007).
- **Toolchain**: Vite+ (`vp`) on Node 22.18+; pnpm workspace from `vp create vite:monorepo`; React with shadcn.

Repository layout:

```
apps/web         React SPA (vp dev / vp build); also hosts the Cloudflare Worker entry via the Cloudflare Vite plugin
apps/server      Node entry (Hono on @hono/node-server), built with vp pack; Docker image
packages/core    domain model, workflow engine, Event log, oRPC contracts, MCP tool projection
packages/db      Drizzle schema and migrations (shared by node:sqlite and D1)
packages/adapters node/ and workers/ implementations of storage, jobs, cron, assets
```

## Notifications

Notification kinds in v1: mention, assignment, Gate awaiting you, Run awaiting input, Run finished or failed.
Channels: each Human's in-app inbox (always), and Slack via an incoming-webhook URL per Channel. Routing is both
Workspace rules (this kind, for this Project, to this Channel) and per-person preferences. A Slack app with per-
person DMs and approve buttons comes after v1.

## Milestones

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
acceptance walk in [m4-acceptance.md](./m4-acceptance.md) — a script rather than a runbook, which walks both
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

**Agent-to-agent delegation through sub-issues** is decided and not yet built: an Agent cuts the work it was
given into sub-issues, hands each to the Agent that should do it, finishes its own Run rather than sitting and
waiting, and is woken by the last child closing. Fan-out is bounded by counts an admin sets per Workspace,
because a machine that can start other machines needs a bottom. Decided in
[sub-issue-delegation.md](./plans/sub-issue-delegation.md) in five slices, to be recorded in ADR-0022; cost
and time accounting per Run ships before it, so the first fan-out can be costed rather than guessed at.

**After v1**, in rough order: cost and time accounting per Run; agent-to-agent delegation through sub-issues;
the Slack app; email Channel; private Projects; Postgres adapter; a CLI.

## Risks worth naming

- oRPC 2.0 is a beta from a single maintainer with no GA date; pin exact versions and keep the registry type ours.
- Better Auth's client-registration surface is changing weekly; pin 1.7.x and expect to chase upstream fixes.
- Drizzle 1.0 is a release candidate: queries and the Better Auth adapter are verified, but drizzle-kit has open
  migration regressions, and a fallback to 0.45 re-baselines the migration history. Decide before the first
  production migration.
- Vite+ is beta with no first-class Node server dev loop; the server dev loop is a watch-and-respawn task.
- Cursor and VS Code have not documented 2026-07-28 support; the SDK's legacy stateless mode covers them.
- D1 free-tier limits (50 queries per invocation, 100k writes per day) shape query design from M1, not M3.
