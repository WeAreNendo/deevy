# Simpler: deevy listens, announces and holds the Gate, in vertical slices

Breakdown of the next shape of deevy, decided with Matt on 2026-10-25 in one grilling session. Vocabulary is
[CONTEXT.md](../../CONTEXT.md), which slice 13 rewrites. It is done when deevy ships no agent runtime and
manages no access to anything an Agent works on; when a Socket listens to its tool and says nothing there but
a Gate and its Rulings; when any tool can reach deevy, through a module or through the generic Socket; when a
Human's attention is the Gates they may rule on, in deevy or in the one chat channel a Project binds; when
only Agents speak MCP; and when there are two deployment shapes, the image and the hosted Worker.

Fourteen slices, 0 to 13, in dependency order. Each is one PR on `main` and carries its own tests. They are
built as one `gh stack` and released together, because slice 12 starts the migration history afresh and no
release between the first slice and that one would upgrade cleanly.

**Status: planned, 2026-10-25.** Nothing is built yet. What each slice finds goes under "What it found", at
the end.

Why this and why now. deevy's goal is to be the glue between whatever software a product and engineering team
uses and its Agents, and that only works if adding a tool is cheap. Three things made it expensive. The
reference runtime kept growing: #208 and #216 each found further gaps in a supervisor that holds a git
credential beside an untrusted session, and fixing those was never the product. Each Socket proxied its tool
for the Agent, so a tracker had to implement nine methods (640 to 1,160 lines, and 1.1k to 1.9k of tests)
before deevy could route a single record from it. And breadth was built ahead of need: seven email senders,
eight sign-in providers, three storage drivers, an OAuth server for Humans' own MCP clients, and four kinds
of Channel with routing rules and preferences, for a product with no real Workspaces yet.

The kernel stays: an **Agent** with a Sponsor, a **Run** that records one attempt, a **Gate** only a Human can
rule on, and an **Event** log that says who did what. This plan cuts what sits around that kernel, so each
new tool costs a small module or none.

## What is already there

- **Bringing your own harness already works.** `apps/docs/content/agents/your-own-harness.md` connects
  Claude Code, OpenCode, Cursor and Copilot to `/mcp` with an Agent's key, and Settings › Agents shows a tab
  for each with the key filled in. [agent-loop.md](../agent-loop.md) is the contract a loop follows.
- **The stub already speaks deevy's own wire format.** `packages/sockets/src/stub` receives
  `{ events: InboundEvent[] }`, HMAC-signed, at `/hooks/:socketId`. That is the normalized shape every module
  produces, so a generic Socket can reuse it unchanged.
- **Needs me is already derived.** `apps/web/src/routes/home.tsx` reads `gates.list { mine: true }` and
  `runs.list { mine: true }`; nothing on it reads an inbox row.
- **The Gate's comment and its Ruling are already the mirror's core.** `packages/core/src/sockets/mirror.ts`
  says the Gate kinds at the default `gates` level, and only the `runs` level adds the rest.
- **An Agent is told a Ruling through `run.answered`**, which `gates.ts` appends when a decision moves the
  Run on, and which `notifications.ts` turns into a `run_answered` row in the Agent's inbox. Removing
  `runs.answer` doesn't remove that Event.
- **The hosted Worker takes only the SPA from `apps/web`** (`apps/hosted/scripts/package.ts` reads
  `apps/web/dist/client`). Its database is the Durable Object's own SQLite (`@deevy/adapters/durable`), and
  its jobs are alarms (`createAlarmJobQueue`), so neither D1 nor the Queues adapter is in its path.
- **Linear already links an Identity through its own consent** (`accountLink` in
  `packages/sockets/src/linear/index.ts`, `packages/core/src/account-links.ts`). That is the one way every
  tool will link.
- **There are no real Workspaces.** deevy Cloud holds test Workspaces only, so the cut can start the
  migration history afresh.

## What is in the way

- **The acceptance walk lives in the runtime.** `vp run agent#acceptance` is `apps/agent/scripts/acceptance.ts`,
  131 checks across four deployments, and it drives the real supervisor. It has to move before the runtime
  can go.
- **`runs.checkout` and `pulls.open` assume a supervisor.** The checkout is deliberately not a tool, because
  it returns a credential, and `pulls.open` is called by both the Agent and the supervisor. Neither has a
  caller once deevy manages no git.
- **Only the runtime reports Usage.** `runs.reportUsage` is called from `apps/agent/src/work.ts` and
  `deevy.ts` and from the seed, and a model can't count its own tokens.
- **Notion's webhooks carry nothing.** They name what changed (`changed`, `commented` in the port), so a
  Notion module still reads the record back even when deevy only listens.
- **Pasted-token Sockets can't run a consent flow.** GitLab is a group access token and Notion an internal
  connection's token. Linking an Identity through the tool's consent needs an OAuth client there: an OAuth
  application on the GitLab instance, and a public Notion connection.
- **GitHub never retries a failed delivery.** With polling gone, a missed `agent:` label or `/approve`
  comment is lost. That is the decision, and the risk is named below.
- **ADR-0031 promises in-place upgrades**, and CI's `previous` job runs the last release on this tree's
  schema. A fresh migration history breaks both once.

## Decisions taken with Matt, 2026-10-25

| Question                                       | Decision                                                                                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The reference runtime                          | **Removed.** `apps/agent`, its four images, its CI smokes and its docs go. deevy is the API, and agent-loop.md is the contract.                                                                           |
| How an Agent learns there is work, or a Ruling | **The MCP inbox, plus an optional signed webhook to the Agent's URL**, as today. Whatever runs the Agent decides how to use them.                                                                         |
| Git access                                     | **Not deevy's.** The operator gives the Agent whatever access it needs. `runs.checkout` and every `credential()` go.                                                                                      |
| The pull request                               | **The Agent opens it**, with its own access, and attaches it to its Run with `links_add` or in the ship Gate's links. `pulls.open`, the forge capability and a Project's repository binding go.           |
| Usage                                          | **Tokens and cost go; time stays.** Working and waiting time are derived from Events. Budgets leave PLAN.md.                                                                                              |
| What deevy does with a tool                    | **Listens and announces.** It verifies and normalizes the tool's webhooks to route, wake and take Rulings, and posts only its own Gate comments. The Agent reads and writes the tool with its own access. |
| A tool with no module                          | **The generic Socket**: deevy's own signed `{events}` format, public. Rulings through it don't count. Announcements go back out as Event webhooks.                                                        |
| The four tracker modules                       | **All stay, trimmed** to the new port. One that hasn't had a real walk is labelled **preview** in Settings and on its docs page. Notion keeps its read-back.                                              |
| Polling for what webhooks missed               | **Dropped.** deevy must be reachable; a missed delivery is lost.                                                                                                                                          |
| What deevy says on a record                    | **Gate comments only**: one per Gate request and per Ruling or refusal. No label, no Run comments, no `mirror` setting.                                                                                   |
| What deevy delivers to Humans                  | **The in-app inbox and a chat Socket a Project binds**, which posts each Gate with buttons. Channels, routing rules, preferences, Slack incoming webhooks, DMs, team addresses and all email go.          |
| A question that isn't a Gate                   | **In the tracker.** The Agent comments; a reply that mentions it lands in its inbox and wakes it. Elicitations and `runs.answer` go; a Run waits only at a Gate.                                          |
| A Human's inbox                                | **Needs me**: the open Gates they may rule on, derived, with no rows. Gate reminders go with it.                                                                                                          |
| Deployment shapes                              | **The Docker image and the hosted Durable Object Worker.** The single-Workspace Worker on D1 goes.                                                                                                        |
| The OAuth server for Humans' MCP clients       | **Dropped.** Only Agents speak MCP, with API keys. The CLI's browser login goes with it.                                                                                                                  |
| How a tool account becomes a Human's           | **One way: the tool's own OAuth consent**, from Settings › Identities. Sign-in stops linking Identities, and so does a verified email.                                                                    |
| Sign-in providers                              | **GitHub, Google, Microsoft and generic OIDC.** GitLab, Linear, Slack and Atlassian sign-ins go, and so does the GitLab-group allowlist rule.                                                             |
| Sub-issue delegation                           | **The parent wake and one ceiling.** deevy routes sub-issues the Agent opened, wakes the parent when the last one closes, and refuses to open a Run past `maxDelegationDepth`. The other two counts go.   |
| The CLI                                        | **Kept, as an Agent's tool.** It signs in with an Agent's key only, and stays on npm.                                                                                                                     |
| Schedules on Agents                            | **Dropped.** Routing and the parent wake are the only triggers; retrying is the operator's call.                                                                                                          |
| The Gate policy                                | **Whole**: N distinct approvals, requester exclusion, named approvers, and an approval that stands for its record (ADR-0020, ADR-0026).                                                                   |
| Existing Workspaces                            | **None to keep.** The migration history starts afresh, deevy Cloud's test Workspaces are recreated, and ADR-0031 holds again from the release after.                                                      |

## The model

### What deevy is after the cut

A **Workspace** holds Members, Sockets and Projects. A **Socket** is one connected tool with capabilities
`tracker` or `chat`; `forge` and `docs` are gone. A **Project** binds one tracker container, optionally one chat
channel, the Agents granted to it, a default Agent, how a record names an Agent (a label prefix, a mention),
and its Checkpoints. An **Issue** is deevy's projection of a record, as the tool's webhooks last described it.
An Agent working an Issue has a **Run**, posts **Activities** (thought, action, response, error), asks at
Checkpoints for **Gates**, and attaches **Links**, its pull request among them. A Human rules on a Gate in
deevy, with `/approve` or `/reject` on the record, or with a button in the Project's chat channel; a Ruling
from a tool counts when the account is one of the Human's **Identities**. Every change is an **Event**.

### The Socket port (`packages/core/src/sockets/port.ts`)

`TrackerSocket` keeps `verifyInbound`, `normalize` and `createComment`, and makes the rest optional:

- `getIssue` and `getComment`, for a provider whose deliveries name a change without carrying it (Notion's
  `changed` and `commented`);
- `listContainers`, for the picker in a Project's settings; without it the admin types the container;
- `handshake`, as today.

`listIssues`, `listComments`, `createIssue`, `setLabels`, `ForgeSocket` and `DocsSocket` leave the port.
`SocketModule` keeps `identity`, `setup`, `install` and `identityScope`, and `accountLink` becomes what makes
Rulings from a tool count. `ChatSocket` loses `openDm`.

`sockets.providers` gains `walked: boolean`, true for GitHub and false for Linear, GitLab, Notion and Slack
until each is walked. Settings shows **Preview** beside a provider that isn't walked, and so does its page
under `apps/docs/content/tools/`.

### The generic Socket (`packages/sockets/src/generic`)

A provider whose deliveries are deevy's own: `{ events: InboundEvent[] }`, signed with HMAC-SHA256 over the
raw body under a secret deevy mints when the Socket is connected, with a delivery id and an event name in
headers, as the stub signs today. Its `normalize` accepts `issue` and `comment` events, each carrying the
whole record, so it needs no read-back. It drops `ruling`: a Ruling through the generic Socket never
counts, because whoever holds the secret is not the tool vouching (ADR-0025). Its `createComment` is a no-op
that appends nothing, because what deevy would announce goes out as `gate.*` Events on the Workspace's
webhook subscriptions, and the adapter posts it back. The format is a public page, `tools/generic`, with a
script and an n8n example. The stub keeps its in-memory store for tests and shares the wire code with `generic`.

### Data (`packages/db/src/schema`)

- `project`: `forge_socket_id`, `forge_scope`, `docs_socket_id`, `docs_scope`, `mirror` and
  `last_polled_at` go; `chat_socket_id` (nullable, `set null`) and `chat_channel` (nullable) arrive.
- `socket`: `poll_minutes` goes.
- `issue`: `created_by` goes, since deevy opens no record (slice 4).
- `agent`: `schedule_minutes` and `schedule_ran_at` go.
- `workspace`: `max_children_per_issue` and `max_open_descendants` go; `max_delegation_depth` stays.
- `run_usage`, `channel`, `routing_rule`, `notification_preference` and `email_sender` go.
- Better Auth's OAuth server tables go: `oauth_client`, `oauth_resource`, `oauth_client_resource`,
  `oauth_refresh_token`, `oauth_access_token`, `oauth_consent`, `oauth_client_assertion` and `jwks`.
- `notification` stays, for Agents only: `assignment`, `mention` and `run_answered`.
- `activity` loses the `elicitation` and `prompt` kinds.

That leaves 29 of today's 42 tables. Slice 12 squashes everything into one `0001_init`.

### Operations and tools after the cut

These go: `runs.checkout`, `runs.reportUsage`, `runs.answer`, `pulls.open`, `agents.usage`,
`issues.create`, `comments.create`, `docs.get`, the seven `channels.*`, `routing.*`, `preferences.*`, the four
`email.*`, `oauthClients.*`, `inbox.unreadCount` and `inbox.markAllRead`. `issues.get` loses `comments`. That
leaves about eighty of today's 106 operations.

The MCP tool set becomes fourteen, all facing an Agent: `inbox_list`, `runs_list`, `runs_get`, `runs_start`,
`runs_post_activity`, `runs_finish`, `gates_request`, `gates_get`, `issues_list`, `issues_get`, `projects_get`,
`links_list`, `links_add` and `links_remove`. A pull request is `links_add` with `kind: "pull_request"`.

These Event kinds go: `run.checkout_issued`, `run.pull_request_opened`, `run.usage_reported`,
`email.configured`, `email.cleared`, `email.exhausted`, the four `channel.*` and `routing.updated`.
`run.answered` stays: a Gate decision appends it.

### Triggers and wake-ups (`packages/core/src/triggers.ts`)

- Routing as today: the label prefix, an assignment or delegation in the tool, the default Agent.
- A mention of an Agent opens a Run where it has none open, as today. Where it has an open Run, the mention
  lands in its inbox as `mention` and goes to its webhook, which is how an answer in the tracker wakes it;
  slice 5 found that already so.
- A sub-issue whose parent is routed to an Agent is routed by its own label. When the last child closes,
  `issue.children_closed` opens a Run on the parent for the Agent the parent is routed to (slice 4: deevy no
  longer knows who opened a child). A child deeper than `maxDelegationDepth` is
  refused with `delegation.refused`, as today.
- No schedule.

### Attention

- **An Agent's inbox** carries `assignment`, `mention` and `run_answered`, and each also goes to the Agent's
  webhook when it has one.
- **A Human's Needs me** is the Gates they may rule on. `routes/inbox.tsx`, the inbox badge and
  `remindAboutGates` go.
- **The record** gets the Gate comments, rendered from the Event as now.
- **The Project's chat channel**, when bound, gets each Gate as a message with Approve and Reject, updated
  in place as Rulings land. Rulings from it count as today (`sockets/chat.ts`).
- Invitations are links an admin copies. Nothing deevy sends is email.

### Identity and sign-in

- Sign-in is GitHub, Google, Microsoft or generic OIDC. Better Auth keeps `socialProviders` for the first
  three and `genericOAuth` for OIDC, plus the `apiKey` plugin. `mcp()` and `jwt()` go.
- An Identity is linked one way: the tool's OAuth consent, begun from Settings › Identities while signed in.
  GitHub links through its App's user authorization (the manifest flow already holds the client id and
  secret), GitLab through an OAuth application the operator registers on the instance, Slack through its
  app's OpenID sign-in, Linear as today, and Notion through a public connection. A tool with no consent flow
  configured links nobody, and Rulings made there are answered with how to rule in deevy.
- `linkBySignIn`, `signInProvider`, `signInClaim` and the verified-email link leave `IdentityScope`.
- The sign-in relay (ADR-0030) relays four providers, not seven.

### Two deployment shapes

The image runs `apps/server` on `node:sqlite`. The hosted Worker runs `apps/hosted`, one Durable Object per
Workspace. `apps/web` builds only the SPA, into `dist/client`, and both shapes serve it. The core keeps its
D1-era rules (no interactive transactions, statement budgets, chunked inserts) because the Durable Object is
also SQLite under an async core; a rule that turns out to be D1's alone is lifted in the slice that finds it.

## The slices

Sizes are t-shirt estimates for one developer plus agents: S under a day, M two to three days, L a week.

### Slice 0: The walk without a runtime (M)

**Goal.** The acceptance walk proves the loop with no supervisor, so the runtime can go.

**Work.** A new package `tools/acceptance` (name `acceptance`, task `walk`, so `vp run acceptance#walk`) that
moves `apps/agent/scripts/acceptance.ts` and `boot.ts` out of the runtime. Its scripted Agent speaks MCP with
the Agent's key, clones and pushes with real `git` against the bare repository the stub container names
(git is its own, never `runs.checkout`), and attaches its pull request with `links_add`. It runs the same four
deployments as today. CI's `runtime` job runs it in place of `agent#acceptance`; CLAUDE.md and
DEVELOPMENT.md say the new command; `sockets-acceptance.md` becomes `acceptance.md`.

**Acceptance test.** The walk passes on all four deployments with an Event story of `run.started`,
`run.activity`, `gate.requested`, `run.awaiting_input`, `gate.approved`, `run.answered`, `issue.link_added`
and `run.completed`, compared with Node's on each; it never calls `runs.checkout` or `pulls.open`; and
`tools/acceptance` imports nothing from `apps/agent`.

### Slice 1: No runtime (M)

**Depends on.** 0.

**Work.** `apps/agent` deleted, with its four image entries in `release.yml`, the image smokes in `ci.yml`'s
`images` job, `harness.sh`, `docs/harnesses.md` and the `agent` package name in CLAUDE.md. The public page
`agents/reference-runtime` goes, and `agents/overview`, `get-started/add-an-agent`, `self-hosting/docker`,
`tools/github` and `tools/gitlab` stop pointing at it. `agent-loop.md` loses its runtime paragraphs and
says git, the pull request and the session are the operator's. ADR-0034 is written, and notes on 0013, 0014,
0018 and 0019 say they are superseded.

**Acceptance test.** `vp check`, `vp run -r test` and `vp run acceptance#walk` are green; the release
workflow builds one image; no file outside `docs/plans`, `docs/adr` and CHANGELOG.md names `apps/agent`;
`vp run docs#build` has no broken links.

### Slice 2: No git, no pull requests (M)

**Depends on.** 1.

**Work.** `runs.checkout`, `pulls.open` and `pulls_open` go, with `ForgeSocket`, `credential()` and
`openPullRequest()` in the GitHub, GitLab and stub modules, `packages/core/src/forge.ts`, `branchFor`, the
`forge` capability, and `forge_socket_id` and `forge_scope` on `project`. The token narrowing #215 added goes
with `credential()`. `run.checkout_issued` and `run.pull_request_opened` leave `EventKind` with their
consumers. A Project's settings lose the repository picker. `mirror.ts` drops the `issue.link_added` case.
`your-own-harness.md` says the Agent opens its own pull request and adds it with `links_add`.

**Acceptance test.** `links_add { kind: "pull_request" }` attaches a pull request to the Run and the record;
the record closes when the tracker says it closed, with nothing from deevy; the OpenAPI and tool snapshots
lose the two operations and one tool; `budget.test.ts` is re-ratcheted.

### Slice 3: Time, not tokens (S)

**Depends on.** 2.

**Work.** `run_usage`, `usage.ts`, `runs.reportUsage`, `runs_report_usage`, `run.usage_reported` and
`agents.usage` go, with the Usage block on a Run's page, the Cost column in the feed and the Usage section on
an Agent's page. `timing` stays on `runs.get` and `runs.list`, and the Time column and the Working, Waiting
and Queued lines stay. The seed loses its usage. PLAN.md's list loses budgets.

**Acceptance test.** A Run that waited twice at Gates still reports the sum; the feed sorts by Time; nothing
on any screen shows a token or a dollar.

### Slice 4: The port listens and announces (L)

**Depends on.** 2.

**Work.** The port above. `listIssues`, `syncSockets`, `last_polled_at` and the polling arm of `runDueWork`
go. `listComments`, `createIssue` and `setLabels` go from GitHub, Linear, GitLab, Notion and the stub, with
their fixtures and tests. `DocsSocket`, the `docs` capability, `docs_socket_id`, `docs_scope`, `docs.get` and
`docs_get` go. `issues.create`, `issues_create`, `comments.create` and `comments_create` go, and so does
`comments` on `issues.get`. `mirror.ts` keeps the Gate kinds only; `mirror`, the `runs` level and
`AWAITING_LABEL` go. Notion keeps `getIssue` and `getComment` for its read-back. `listContainers` becomes
optional, and a Project's settings take a typed container where a module has none. The public pages under
`tools/` and `agents/` say the Agent reads and writes the tool itself.

**Acceptance test.** A stub delivery labelled `agent:planner` still opens one Run; a Gate request puts one
comment on the record and a Ruling another, and nothing else does; a Notion `changed` delivery reads the
record back and applies it; a module with only the three required methods registers, routes and announces;
the statement count of one inbound delivery is asserted exactly and is lower than today's; the tool snapshot
loses `issues_create`, `comments_create` and `docs_get`.

### Slice 5: Questions in the tracker (M)

**Depends on.** 4.

**Work.** The `elicitation` and `prompt` Activity kinds, `runs.answer`, `packages/core/src/mcp/elicitation.ts`
and the `run_awaiting_input` Notification kind go; `runs.postActivity` no longer moves a Run to
`awaiting_input`, so only `gates.request` does. The new mention rule in `triggers.ts`: a mention of an Agent
that has an open Run on that record is a `mention` row in its inbox and a webhook delivery. agent-loop.md
says how to ask.

**Acceptance test.** An Agent posting `kind: "elicitation"` is refused with the kinds it may post; a comment
from the tracker that mentions an Agent with an open Run puts one `mention` row in its inbox and opens no
second Run; a comment mentioning an Agent with no open Run opens one, as before; a stale sweep still leaves a
Run waiting at a Gate alone.

### Slice 6: Delegation and schedules (S)

**Depends on.** 4.

**Work.** `max_children_per_issue` and `max_open_descendants` go from `workspace` and `limits.ts`, with their
settings; the checks that read them went with `issues.create` in slice 4, so what is left is the settings,
their columns and the operation fields. `max_delegation_depth` is checked when deevy would open a Run on a
routed child. deevy's own parent
link resolves from the tracker's `parentExternalId` only. A child taken out from under its parent stays
linked for now: `parentExternalId: null` means "said no parent" on GitHub's `sub_issue_removed` but "said
nothing" on most deliveries, so slice 4 keeps the link on both; telling them apart takes a third value in the
port. `sweepSchedules`, `schedule_minutes`,
`schedule_ran_at`, the `schedule` trigger and the schedule field on an Agent's page go. The `delegation`
Notification kind goes. `agents/delegation.md` says the Agent opens sub-issues in the tracker.

**Acceptance test.** A child the Agent opened in the stub tracker with `agent:builder` opens a Run for
`builder`; the last child closing opens one Run on the parent; a child one level past the ceiling is
`delegation.refused` and opens nothing; `runDueWork` has no schedule arm.

### Slice 7: Preview and the generic Socket (M)

**Depends on.** 4.

**Work.** `walked` on `sockets.providers` and the **Preview** label in Settings and on the four unwalked pages.
`packages/sockets/src/generic` as above, sharing its signing and parsing with the stub; registered by every
entry, never refused in production. Connecting one mints its secret and shows the URL and the secret once.
The public page `tools/generic`, with the format, a signing example in a few lines of script, and an n8n
flow.

**Acceptance test.** A signed generic delivery opens a Run; a bad signature is 401 and no row; a `ruling`
event through it is dropped and appends `gate.ruling_refused`; a Gate request on a generic Project appends its
Event and posts to the Workspace's webhook subscriptions, and writes no comment; the generic secret never
appears in an output schema (`secrets.test.ts`).

### Slice 8: The inbox and a chat binding (L)

**Depends on.** 5, 6.

**Work.** `channel`, `routing_rule`, `notification_preference` and `email_sender` go, with `channels.*`,
`routing.*`, `preferences.*` and `email.*`; Settings › Channels, Email and Notifications; `packages/email`;
`packages/core/src/email`; the SMTP sender in `@deevy/adapters/node` and `createCloudflareSender` in
`@deevy/adapters/workers`; Slack incoming webhooks and `openDm`. A Project gains `chat_socket_id` and
`chat_channel`, set in its settings, and a Gate on it posts and updates one chat message. Human Notification
kinds, `routes/inbox.tsx`, the inbox badge, `inbox.unreadCount`, `inbox.markAllRead` and `remindAboutGates`
go; `inbox.*` is an Agent's. Invitations show a link to copy. The hosted Worker loses its email binding.
The public pages under `notifications/` become one page on Needs me and chat, and
`self-hosting/email.md` goes.

**Acceptance test.** A Gate on a Project bound to the Slack stub posts one message with Approve and Reject
and updates it in place on each Ruling; a button Ruling from a linked Identity rules, and from anyone else is
answered privately in Slack; Needs me lists exactly the Gates the Human may rule on; no Human has an inbox
row after a mention, an assignment or a finished Run; an invitation link signs a new Human in; `vp run
hosted#test:hosted` is green with no email binding.

### Slice 9: Only Agents speak MCP (M)

**Depends on.** 8.

**Work.** `mcp()` and `jwt()` leave both Better Auth configurations (`packages/core/src/auth.ts` and
`packages/db/auth.generate.config.ts`), and `vp run db#generate:auth` regenerates the schema without the
OAuth tables. `/mcp` accepts an Agent's API key only. `cimd.ts` in core and in `apps/server`, the consent
route, Settings › MCP clients and `oauthClients.*` go. The registry's facing collapses to two: a tool faces an
Agent, an operation faces whoever its `auth` says. The CLI's browser `login` and its stored token go: it
acts as the Agent whose key is in `DEEVY_API_KEY`, as it already can, and its commands that only a Human
could run (issuing a key, answering a question) leave its generated reference. `docs/as-yourself.md` and
`mcp-and-cli/your-own-mcp-client.md` go. ADR-0035 is written.

**Acceptance test.** A Human's session cookie or a bearer that is not an Agent key is 401 on `/mcp`; an Agent
key lists the fourteen tools; with `DEEVY_API_KEY` set, `deevy whoami` names the Agent and `deevy runs list`
answers; `/.well-known/oauth-authorization-server` is 404; `secrets.test.ts` and the OpenAPI snapshot are
green.

### Slice 10: Identity by consent, four sign-ins (L)

**Depends on.** 9.

**Work.** `accountLink` for GitHub (the App's user authorization, github.com and Enterprise Server), GitLab
(an OAuth application the Socket's setup now asks for), Slack (the app's OpenID sign-in, which its setup now
asks the client id and secret for) and Notion (a public connection's OAuth, offered beside the internal one);
Linear as today. `linkBySignIn`, `signInProvider`, `signInClaim` and the verified-email link go from
`identities.ts`. The GitLab, Linear, Slack and Atlassian sign-in providers go from `auth.ts`,
`provider-env.ts`, the relay, the sign-in card and the dev stub; the GitLab-group allowlist rule goes.
`self-hosting/sign-in-providers.md` and each tool's page say how to link. ADR-0036 is written.

**Acceptance test.** A Human who links their GitHub account through consent rules with `/approve` on the
record; one who signed in with GitHub but never linked is answered on the record with how to link or rule in
deevy; a GitLab Socket with no OAuth application links nobody and says so in its settings; a Linear sign-in
attempt is a provider deevy doesn't offer; the relay test signs in through each of the four.

### Slice 11: Two deployment shapes (M)

**Depends on.** 0.

**Work.** `apps/web/src/worker.ts`, `wrangler.jsonc`, `build:workers`, `check:workers`, `smoke-workers.ts`,
`stub-queue-hand.js`, `@deevy/adapters/workers`' `createDb` and `queue.ts`, and the walk's Worker leg go.
`vp run web#build` writes `dist/client`, and `hosted#build:hosted` packages that. The CI Workers smoke goes.
`self-hosting/cloudflare-workers.md` and `docs/m3-acceptance.md` go, OPERATIONS.md loses its Worker sections,
and CLAUDE.md's commands and runtime boundary say two shapes. ADR-0037 is written.

**Acceptance test.** The walk passes on the image, the image under `/deevy` and a hosted Workspace;
`hosted#test:hosted` is green; `packages/core` still builds with no `node:` import (the hosted Worker's build
is now what catches a leak, and CI runs it on every commit).

### Slice 12: The clean break (S)

**Depends on.** Every slice that changes the schema: 2, 3, 4, 6, 8, 9, 10.

**Work.** The migration history squashed to one `0001_init`, with `NOT NULL` hand-patched onto every text
primary key and `vp run db#check:migrations` green. CI's `previous` job is skipped for the one release whose
tag carries the break, by name, and runs again from the next. A note on ADR-0031 records the one exception.
The changeset says the release starts from an empty database. deevy-cloud's companion PR deletes and
recreates the test Workspaces, drops the email binding, and removes the GitLab, Linear, Slack and Atlassian
sign-in Apps from the relay.

**Acceptance test.** A fresh image starts and bootstraps its Workspace; a fresh hosted Workspace provisions;
the walk passes on all three deployments from an empty database.

### Slice 13: The record (S)

**Depends on.** Everything.

**Work.** CONTEXT.md: **Socket** loses `forge` and `docs`, **Project** is as above, **Identity** is linked by
the tool's consent only, **Notification** is a message to an Agent, **Activity** has four kinds, and
**Channel**, **Sender** and **Usage** move to Retired. PLAN.md: "What deevy is" with the fourth promise true
again, the domain paragraph, the agent loop, the surfaces and the fourteen tools, the architecture, and a
"Simpler" milestone entry. CLAUDE.md's history, packages and commands. OPERATIONS.md and DEVELOPMENT.md. What
each slice found.

**Acceptance test.** `vp run docs#build` is green; a grep for `apps/agent`, `runs.checkout`, `pulls_open`,
`Channel` and `email_sender` outside `docs/plans`, `docs/adr` and CHANGELOG.md finds nothing.

## Conventions every slice follows

The Sockets milestone's conventions hold ([sockets.md](./sockets.md), "Conventions every slice follows"). This
plan restates the ones it leans on and adds the last three.

1. **Test-first, and the red is read.** A cut is proved by the test that fails when the cut thing is called,
   not by the tests that stop compiling.
2. Schema in `packages/db/src/schema/<area>.ts`. A slice that cuts a column or a table stops reading and
   writing it and leaves it in the schema, marked unused, for slice 12's fresh history to drop: a rebuilt
   table is refused on D1 and a Durable Object, and ADR-0031's guard refuses a drop (slice 2 found this). A
   column a slice adds is a migration, with `vp run db#generate`. Better Auth's tables only through
   `vp run db#generate:auth`.
3. Operations through `defineOperation`; `vp run core#snapshot:openapi` and the tool snapshot committed in
   every slice that changes them.
4. A removed `EventKind` leaves with its consumers: the sets in `notifications.ts`, `lib/event-text.ts`, the
   Event log's What column, and the webhook subscribers.
5. Every inbound handler and sweep arm is counted in `budget.test.ts`, and a cut re-ratchets it down.
6. A provider module is tested against recorded payloads with an injected `fetch`, never the network.
7. `vp check` clean, `vp run -r test` green, `vp run acceptance#walk` green, and a changeset written for
   somebody upgrading deevy.
8. **A cut takes its public page with it.** A page under `apps/docs/content` that describes what a slice
   removes is changed or removed in that slice, and `vp run docs#build` fails on a link to it.
9. **Nothing is kept for compatibility.** There are no real Workspaces, so a cut column, operation or
   option goes outright, with no shim, alias or deprecation.
10. **Each slice says what it removed**, in lines of source and of tests, under "What it found".

## Dependency order

```
main
└─ 0 The walk without a runtime
   ├─ 1 No runtime
   │  └─ 2 No git, no pull requests
   │     ├─ 3 Time, not tokens
   │     └─ 4 The port listens and announces
   │        ├─ 5 Questions in the tracker
   │        ├─ 6 Delegation and schedules
   │        ├─ 7 Preview and the generic Socket
   │        └─ 8 The inbox and a chat binding                needs 5 and 6
   │           └─ 9 Only Agents speak MCP
   │              └─ 10 Identity by consent, four sign-ins
   └─ 11 Two deployment shapes
         12 The clean break                                  needs 2, 3, 4, 6, 8, 9, 10
         13 The record                                       needs everything
```

Slice 11 depends only on 0, and 3, 5, 6 and 7 are independent of one another once 4 is in. One `gh stack`
in the order written keeps the tree green at every step and lets slice 12 squash a history that no release
has shipped.

## ADRs

### Written by this plan

| ADR                                                         | Slice | What it records                                                                                                                            |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0034 deevy runs no agent and manages no access              | 1     | No runtime, no git credential, no pull request opened by deevy, no Usage reported to it. Restores ADR-0003's promise.                      |
| 0035 Only Agents speak MCP                                  | 9     | No OAuth authorization server; `/mcp` takes an Agent's key; a Human's surface is the browser, the tracker and the chat channel.            |
| 0036 An Identity is linked by the tool's own consent        | 10    | One way to link; sign-in and a verified address no longer vouch; four sign-in providers.                                                   |
| 0037 Two deployment shapes: the image and the hosted Worker | 11    | The single-Workspace Worker on D1 goes; which D1-era rules the core keeps and why.                                                         |
| An amendment to ADR-0024: a Socket listens and announces    | 4, 7  | Written as a section on 0024 rather than a new ADR: the port's three required methods, Gate comments only, no polling, the generic Socket. |

### Superseded

| ADR                                                                                                                    | By   | Why                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------- |
| [0013](../adr/0013-the-reference-runtime-is-a-service-not-a-ci-job.md) The runtime is a service                        | 0034 | There is no reference runtime.                                                               |
| [0014](../adr/0014-an-agents-input-is-untrusted-and-its-tools-are-not.md) An Agent's input is untrusted                | 0034 | What bounds a session is the operator's; the Gate no Agent can pass is ADR-0004's and stays. |
| [0018](../adr/0018-a-harness-is-a-cli-behind-the-session-seam.md) A harness is a CLI                                   | 0034 | No harnesses ship.                                                                           |
| [0019](../adr/0019-the-session-is-its-own-user-and-git-goes-through-the-supervisor.md) Git goes through the supervisor | 0034 | deevy holds no git credential.                                                               |
| [0023](../adr/0023-the-api-is-its-own-protected-resource.md) The API is its own protected resource                     | 0035 | deevy mints no access tokens.                                                                |
| [0027](../adr/0027-a-sign-in-vouches-inside-the-workspace-it-was-to.md) A sign-in vouches                              | 0036 | Sign-in no longer vouches for a Ruling.                                                      |

### Amended

| ADR                                                                                                                       | By          | What changes                                                                               |
| ------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| [0003](../adr/0003-deevy-triggers-agents-but-never-runs-them.md) deevy never runs agents                                  | 0034        | Nothing; a note says it is true again.                                                     |
| [0006](../adr/0006-runtime-agnostic-core-node-first.md) Runtime-agnostic core                                             | 0037        | Two shapes, Node and the hosted Durable Object; no D1.                                     |
| [0007](../adr/0007-better-auth-is-identity-and-oauth-server.md) Better Auth is identity and OAuth server                  | 0035        | Identity only; no OAuth server.                                                            |
| [0010](../adr/0010-a-delegated-credential-cannot-decide-a-gate.md) A delegated credential cannot decide                   | 0035        | No delegated credential is minted any more; the rule stands for any that comes back.       |
| [0012](../adr/0012-the-cron-port-stayed-node-s-and-a-stream-ends-itself.md) A stream ends itself                          | 0037        | The per-invocation cap that made the stream end itself was D1's and is gone.               |
| [0016](../adr/0016-a-run-is-an-agents-and-the-registry-says-which-way-an-operation-faces.md) Which way an operation faces | 0035        | Every MCP tool faces an Agent; Human-facing tools leave MCP.                               |
| [0022](../adr/0022-a-parent-finishes-and-the-last-child-wakes-it.md) The last child wakes the parent                      | slice 6     | The Agent opens sub-issues in the tracker; one ceiling, depth.                             |
| [0024](../adr/0024-an-issue-is-a-projection-of-a-record-in-a-socket.md) An Issue is a projection                          | slices 4, 7 | A Socket listens and announces; no forge or docs capability; the generic Socket.           |
| [0025](../adr/0025-the-forge-may-vouch-for-the-human-who-rules.md) The forge may vouch                                    | 0036        | A tool vouches only for an Identity linked by its consent; the verified-email hole closes. |
| [0028](../adr/0028-a-hosted-workspace-is-a-durable-object.md) A hosted Workspace is a Durable Object                      | 0037        | It is one of two shapes, not the third.                                                    |
| [0030](../adr/0030-a-sign-in-may-be-relayed.md) A sign-in may be relayed                                                  | 0036        | Four providers relayed.                                                                    |
| [0031](../adr/0031-every-release-upgrades-in-place.md) Every release upgrades in place                                    | slice 12    | One exception, the release that carries this plan, because no real Workspace existed.      |

ADR-0001, 0002, 0004, 0005, 0008, 0009, 0011, 0015, 0017, 0020, 0026, 0029, 0032 and 0033 stand unchanged.

## Deferred

A real walk of Linear, GitLab, Notion and Slack, which is what takes a module out of preview. Redelivery of
what a tool's webhooks missed, if losing one turns out to matter more than a module's cost: a per-module
`listIssues` can come back as an optional capability. Per-Agent identities on a Socket. Jira and Asana, each
a module or the generic Socket. Budgets, which need a reporter deevy can trust. Personal API keys for a
Human's own MCP client. Email, as a chat Socket of its own if a team asks for it.

## Risks

- **A missed delivery is lost.** GitHub never retries one, so a label or `/approve` that deevy didn't hear
  starts nothing and rules nothing. The tool's page says to check its webhook deliveries and redeliver from
  the tool, and Settings › Sockets shows when a Socket last heard from its tool.
- **A self-hosted deevy must be reachable.** One behind a NAT needs a tunnel, and `self-hosting/docker.md`
  says so where polling used to cover it.
- **An Agent with access to the tracker can do anything that access allows.** That was true of its git
  access before; now it is true of the tracker too, and it is the operator's to bound. The Gate is still the
  thing an Agent can't pass.
- **Consent flows need OAuth clients the operator registers.** GitLab and Notion Sockets that were a pasted
  token get a second setup step to link Identities, and until it is done their Rulings don't count. Each
  tool's page says so, and so does its Socket's settings.
- **The generic Socket is only as trusted as its secret.** Whoever holds it can open Runs for any Agent
  granted its Project. That is why it carries no Rulings, and its setup says so.
- **deevy Cloud's test Workspaces are wiped.** Slice 12's companion PR recreates them; nobody else is on it.

## What it found

**Slice 0, the walk without a runtime.** `tools/acceptance` is the walk (817 lines, from the runtime's 947)
and `boot.ts`, moved unchanged but for a path. The scripted Agent holds only its key: `/mcp` for its tools,
`/api/inbox/read` for its inbox, its own `git clone` and push against the bare repository, and `links_add`
for the pull request; the Project is bound to its tracker alone, and the stub names the container without a
clone URL. It passes on all four deployments with 115 checks, 28 on each and three comparisons, where the
runtime's walk had 131. The Event story lost four kinds that deevy appended only for the supervisor's calls:
`run.checkout_issued`, `run.pull_request_opened`, `run.usage_reported`, and a `comment.created` that was the
supervisor commenting on the record when it delivered (`apps/agent/src/deevy.ts`), along with the Activity it
wrote per ref moved; the core's tests still cover those operations until slices 2 and 3 remove them, so the
stack ships as one release. Nothing in deevy had to change for an Agent with no supervisor to do the
whole loop. The review found that the old walk proved one thing of deevy's only in passing — a Ruling puts
its Run back to `active`, since the supervisor resumed nothing else — and the new walk checks it after each
Ruling, checks that marking the inbox read marked every row, and checks the four-eyes Ruling on the Gate
rather than the sign-in that preceded it.

**Slice 1, no runtime.** 12,312 lines out and 262 in: `apps/agent` was 11,212 of them, the CI jobs that
built and smoked four runtime images and ran the supervisor's git test as root were 250, and the release
workflow publishes one image with no harness tags. Four pending changesets described fixes to the runtime
alone; two were security fixes merged after 0.11.4 that will now never ship, so they are deleted and the
release note says to stop running a `deevy-agent` image rather than only that it is gone. The runtime's
`instructions.md` and the CLAUDE.md snippet in `agent-loop.md` were the same text twice; the snippet is now
the only copy, and the public harness page points at it. Comments that cited `apps/agent` for a reason keep
the reason and lose the path. The one place that still names it is PLAN.md's milestone history, where each
entry now says it was removed; slice 13 rewrites that page.

**Slice 2, no git, no pull requests.** `runs.checkout`, `pulls.open` and its tool, the forge port and all
three of its implementations, `forge.ts`, the GitHub token minted per Run (#215), the two Event kinds and the
SPA's repository picker are gone, and the mirror says nothing about a linked pull request. The GitHub App's
manifest asks for issues and metadata only: with no clone and no pull request, contents and pull requests
were permissions deevy no longer used. Two things went differently from the plan. The `forge_socket_id` and
`forge_scope` columns stay in the schema, unused and hidden from the API: dropping a column with a foreign
key is a table rebuild, which the migration emitter refuses for D1 and the Durable Object because both run
it with foreign keys on, and ADR-0031's guard refuses a dropped column anyway. Slice 12's fresh history drops
them, so every later slice removes columns the same way, in the code first. And the stub's container spec
keeps reading `name=…`, ignoring what follows, so an older `DEEVY_DEV_STUB_CONTAINERS` still starts. The MCP
tool set is nineteen; the walk, which already attached its pull request with `links_add`, needed no change.

**Slice 3, time, not tokens.** 828 lines of source out and 21 in, 681 of tests out and 156 in, and 609 out
of the two snapshots. `runs.reportUsage` and its tool, `agents.usage`, `usage.ts`, the
`run.usage_reported` Event, the `use_` id prefix, the Usage section on a Run's page and on an Agent's, the
feed's Cost column and the seed's four reports are gone; `run_usage` stays in the schema, unused, by
convention 2. The Runs feed reads in three statements rather than four. The Agent's month-by-month table went
whole, its working time with it, since it was the Usage section: a Run's time is on its own page and in the
feed, and nothing asked for a monthly one without the cost beside it. `duration` moved to `lib/time.ts`, and
CONTEXT.md retires **Usage** now rather than in slice 13. The tool set is eighteen; the walk needed no
change, because its scripted Agent never reported.

**Slice 4, the port listens and announces.** 2,087 lines of source out and 487 in, 2,331 of tests out and
1,241 in, and 2,252 out of the two snapshots. A tracker is now `verifyInbound`, `normalize` and
`createComment`; `getIssue`, `getComment`, `handshake` and `listContainers` are optional, and a test module
with only the three registers, is bound by a typed container (`sockets.containers` answers null and the Bind
dialog asks for the key), routes a record and announces its Gate. GitHub, Linear and GitLab lost `getIssue`
too, since none of them delivers a `changed` that needs a read-back, and Linear's and GitLab's parsers now
read the webhook shape only. Every Project announces a Gate, each approval, the decision and a refused
Ruling, and nothing about a Run; deevy sets no label. One inbound delivery is 23 statements, from 24: the
Run it starts no longer reads its Project for a mirror level. `DEEVY_SOCKET_CATCHUP_MINUTES` went from all
three entries and the hosted artifact's manifest; deevy-cloud never set it. Notion's connection needs read
content, read comments, insert comments and user information, and no longer update or insert content.

Three things went further than the plan said. With `issues.create` gone, the delegation ceilings lost their
only caller, so `refusesDelegation` and the tree it read went with it (slice 6 above now removes only the
settings), and the inbox's "wave of sub-issues" line lost its producer. deevy no longer knows which Agent
opened a child, so when the last one closes it wakes the Agent the parent is routed to, and
`issue.children_closed` carries `routedTo` where it carried `openedBy`; `issue.created_by` stays unused until
slice 12. And GitLab, which has no parent field, has no tree in deevy any more: `issues.create` was what kept
one there.

The walk could no longer open its record or read deevy's comments back through deevy, so the record now
arrives as a delivery like any other, and a deployment that registers the stub serves `/dev/tracker`, the
stub's store as JSON, which the walk reads; it is mounted only where the stub is, sits in the Worker's
`run_worker_first`, and the API gains nothing. The walk also checks that deevy said nothing else on the
record: two Gates, their two Rulings and two refused Rulings. Rewriting the tests on records the tracker
delivers turned up two things that were already true: a tracker comment that mentions an Agent puts no actor
on the inbox row, and an author who mentions themselves from the tracker is not filtered out. The tool set
is fifteen.

One was a bug the cut uncovered. GitHub opens an issue first and adds it under its parent after, in a
`sub_issues` delivery, and deevy took the parent only when it first saw a record, so a sub-issue the Agent
opens on GitHub would never have been linked and its parent never woken. `issues.create` had hidden it by
linking the child itself. A delivery that names a parent now links the record whenever it comes, even after a
newer one, and one that names none keeps the link deevy has; a real-route GitHub test holds the order.

The review found what the cut left saying the old thing: the Socket page told an operator whose tool had gone
quiet that deevy was asking it and nothing was lost, the delegation ceilings promised a refusal nothing makes
any more (they bound nothing until slice 6, and the setting says so), and `issue.createdBy` was still in the
API when every other cut column was not. A test now stores each old `mirror` value on a Project and finds it
says the same two things as any other.

**Slice 5, questions in the tracker.** 518 lines of source out and 128 in, 289 of tests out and 528 in (the
new acceptance file is 237 of them, the walk's three checks 69), and 277 out of the two snapshots. The
`elicitation` and `prompt` kinds, `runs.answer` with its route, tool and CLI command, `statusAfterAnswer`,
and `mcp/elicitation.ts` (171 lines) are gone, and with that file the URL elicitation `gates_request`
answered a capable client with, and the `input_required` retry; the MCP server lost its `secret` and its
state lifetime, since that request state was all it signed. The `run_awaiting_input` kind went from the
inbox, the preferences, routing, Slack, the email and its renderer, and Needs me lost **Runs awaiting your
answer**. `runs.postActivity` refuses the two kinds with the four it takes, and a Run waits only where
`gates.request` puts it. The tool set is fourteen, every one an Agent's, which is the number this plan set.

The mention rule needed no code. `deriveNotifications` already gave every Member a comment names a `mention`
row, Agents included; `comment.created` already went to an Agent's webhook in its granted Projects; and a
mention already opened no Run for an Agent with one open. `triggers.ts` is unchanged, and the new tests and
the walk pin all three, through a delivery from the tracker.

It went further than the plan said in one place. A Gate's ask and its Ruling were written into the Run's
feed, as an `elicitation` and a `prompt` Activity, so with the kinds gone the feed is only what the Agent
narrated. The Gate's own rows, beside it on the Run's page, carry the Proposal and the Ruling, and the Agent
reads them with `gates_get`, as the loop already told it to; the line that says a Checkpoint was passed on an
approval given before stays, as an `action`. Four counted paths are a statement shorter for it: a Ruling
from the tracker is 29, a Slack click 22, asking at a Gate 20 and a Ruling in deevy 18. And the email sender
no longer looks up which Runs were asking before it skips a stale ask.

Two reads in the SPA had been wrong since Gates became requests on a Run: the Event log looked for a
`gateStateId` no Event carries, so every Gate wait read "is waiting on a Human", and the Inbox looked for
`ruling` where the Event says `decision`, so a Ruling read as an answer to a question. Both say the
Checkpoint and the decision now. agent-loop.md says how to ask: a comment on the record that names who is
asked and asks them to mention the Agent back, an `action` saying so, and a Run left open, which goes stale
after thirty minutes and is meant to; a test holds that the reply still finds the stale Run and opens no
other.

The review found that what this slice reads strictly, older rows break. A Gate's `elicitation` and
`prompt` Activities, a `run_awaiting_input` inbox row and a routing rule for that kind, all written before
it, now fail the API's output schema, so `runs.get`, `inbox.list` and `routing.list` refuse a database that
has them. Convention 9 keeps no shim for that and slice 12 starts from an empty one, so the schema's comment
now says so, and a developer's database from before this slice wants reseeding. It also found that an
Agent's webhook carries every comment in its Projects, mention or not, which agent-loop.md now says; only the
inbox and a new Run wait for the mention, and a Project's **Route by mention** turned off stops the Run and
not the row.
