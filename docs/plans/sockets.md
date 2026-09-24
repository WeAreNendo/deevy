# Sockets: deevy as the glue between a team's tools and its Agents, in vertical slices

Breakdown of the next shape of deevy, decided 2026-09-19. Vocabulary is [CONTEXT.md](../../CONTEXT.md),
rewritten by this plan; the two choices that are expensive to reverse are
[ADR-0024](../adr/0024-an-issue-is-a-projection-of-a-record-in-a-socket.md) and
[ADR-0025](../adr/0025-the-forge-may-vouch-for-the-human-who-rules.md). It is done when a team that keeps
its work in GitHub Issues — then Linear, GitLab, Notion — can label an issue for an Agent, read the Agent's
proposal where the issue lives, rule on it there, in Slack or in deevy, and get a pull request back, while
deevy holds no Issue, Document, Workflow or Label of its own.

Fifteen slices, 0 to 14, in dependency order. Each is one PR on `main` and carries its own tests. The first
carries a major changeset; the rest carry ordinary ones.

Why this and why now. v1 made deevy a complete tracker: Issues with keys, a Workflow of States and Gates per
Project, intent/spec/plan Documents materialised from templates and edited live, Labels, Teams, comments, a
board. Every one of those was built well, and every one of them is a thing a team already has somewhere
else. A team that keeps its work in Linear or GitHub and its plans in Notion was being asked to move all of
it, or to keep two of everything, in exchange for the part of deevy they actually wanted: an Agent with its
own identity and a Sponsor, a Run a Human can read, a Gate an Agent cannot pass, and an Event log that says
who did what. That part is the product. The tracker around it is a heavy layer nobody asked for, and this
plan takes it out.

What deevy becomes is a hub with sockets. A **Socket** is one connected external tool under one identity.
The unit of work lives in the team's tracker; deevy mirrors it, routes it to an Agent, records the Run,
holds the Gate, and writes the outcome back where the team reads. The honest size of the change, from the
inventory that preceded this plan: the tracker is roughly 8,800 lines of production code across core, db,
web and the editor package, twelve tables, the only Durable Object, and the Yjs, Hocuspocus, Tiptap, dnd-kit
and ws dependencies; the sockets are roughly 2,400 lines of core, 2,400 across four providers and Slack, and
3,300 of web. Net about 4,000 lines fewer with everything shipped, and an operation count that stays near
ninety. What gets simpler is not the line count. It is the concept count, the operator's story, and the
answer to "what do I have to move into deevy": nothing.

## What is already there

More than the size of the cut suggests, which is why the rebuild is fourteen slices and not twenty.

- **The Event tail is the spine, and it is generic.** `appendEvent` (`packages/core/src/events.ts`) inserts
  the row and then runs `deriveNotifications`, `deriveWebhookDeliveries`, the job nudge and `triggersFor`,
  in that order. Nothing in the trigger, notification or webhook path reads an Issue's body; almost all of
  it reads `event.kind`, `event.subjectType` and `event.payload`. A fourth derivation slots in beside the
  third.
- **`triggersFor`'s `issue.assigned` and `comment.created` arms** (`packages/core/src/triggers.ts`) open a
  Run from the Event alone, guarded by "at most one open Run per (Issue, Agent)" twice — a read, then the
  partial unique index `run_open_per_issue_agent_uidx`. An assignment that arrives from a tracker's webhook
  is the same Event.
- **The Run status machine** (`packages/core/src/runs.ts`) is pure: `openStatuses`, `statusAfterActivity`,
  `statusAfterAnswer`, `assertFinishable`, `setRunStatus`. The stale sweep, `remindAboutGates` and
  `sweepSchedules` in `work.ts` read `(status, lastActivityAt)` and nothing about a State.
- **The `delivery` table and everything around it** — `claimDeliveries`, backoff, jitter, the lock, the
  unique `(target, targetId, eventSeq)`, `webhook.exhausted` — already serve two arms, webhooks and Slack. A
  third arm is a `target` value and a send function.
- **Outbound is already a signed, Event-shaped fan-out.** `webhookBody` is the Event row; `wants()` matches
  kinds and a Project. Any subscriber that can take a signed POST is already first-class; the missing half
  is entirely inbound.
- **A GitHub or GitLab sign-in already records the external user id.** Better Auth's `account` row carries
  `providerId` and `accountId`, and `accountId` is the numeric id a GitHub webhook puts in
  `comment.user.id`. Mapping a commenter to a Member is, for those two providers, a lookup that already
  exists.
- **`resolvePrincipal` and `sessionOnly`** (`packages/core/src/principal.ts`, the registry's `authorize`)
  are the rule that a delegated credential never rules a Gate. They do not change; the new door is beside
  them.
- **Everything is projected from the registry** — OpenAPI, MCP tools, the CLI's commands — so an operation
  added or removed shows up on every surface without a hand-kept list.
- **`createApp` already takes injected ports** (`jobs`, `liveRooms`, `fetchClientMetadataResource` on the
  MCP side), which is the seam a provider registry goes through so the core never imports a provider.
- **The git loopback proxy and the MCP loopback proxy** in `apps/agent` hold the credential and the key
  outside the session. Neither cares where the repository URL or the token came from.
- **Delegation's arithmetic** — `refusesDelegation` and its two recursive queries, the three ceilings on
  `workspace`, `wakeParent`, the rolled-up `delegation` Notification — is keyed on `issue.parentId` and on
  "is this closed", not on a Workflow.

And five things that are in the way.

1. **A Run's Gate is the Issue's State.** `runs.requestApproval` resolves the Gate from `issue.stateId`
   against `workflow_state` and decides "opened" by `issue.stateId !== gate.id`. That is the one place the
   Gate machinery and the Issue's State are the same object.
2. **Documents are materialised by State entry.** `openStateDocument` fires on every move and every ruling;
   step 5 of the Agent's instructions exists because a State carries a template. Take out the Workflow and
   the Document has no reason to exist.
3. **There is no inbound route and no stored third-party credential.** The HTTP surface is `/healthz`,
   `/api/auth/*`, `/.well-known/*`, `/mcp`, `/rpc/*`, `/api/*`, `/collab`. deevy has never received a
   webhook, and the only credential for another system it has ever held lives in the agent runtime's own
   process.
4. **An Issue is a local row with a derived key.** `issueKey(project.key, issue.number)` and its regex are
   referenced from twenty files in `packages/core`; `run.issueId`, `notification.issueId`, `issue_link`,
   the rooms and the ceilings all hang off it.
5. **Gate policy lives on `workflow_state`** and a visit is keyed on `stateEnteredAt` and
   `approvalsClearedAt`. Four-eyes (ADR-0020) survives this plan, but not where it is stored.

## Decisions taken

2026-09-19, with Matt.

- **An Issue lives outside deevy, always.** Every Issue is a projection of a record in a tracker Socket:
  its URL, its key as the tracker writes it, its title, body and state as the tracker last said them. deevy
  authors none of it. There is no board, no issue editor, no `DEV-42`. The alternative kept a stripped
  built-in tracker for the team with none; it was refused because it is the heavy layer again in a smaller
  coat, and because everyone with a repository already has GitHub Issues.
- **One identity per Socket, and a routing rule picks the Agent.** One GitHub App, one Linear app, one
  GitLab application, one Notion integration, one Slack app, each called "deevy". Which Agent gets a record
  is a label `agent:<handle>`, a mention `@deevy <handle>`, or the Project's default Agent. Per-Agent
  identities, where a provider makes them cheap, come later and the port leaves room for them; they are not
  what a team should have to set up to start.
- **Documents and the Workflow go.** An Agent asks for a Gate by Checkpoint name — `plan`, `ship`, or any
  name the Project's policy lists — and attaches its Proposal as markdown with links. The Human rules on
  that text. Where the team keeps plans afterwards is the Agent's job and a link. The live editing machinery
  goes with it, and with it the only Durable Object.
- **Rulings come from three doors and are recorded with which.** deevy's browser stays canonical and
  `sessionOnly` stays on the operations. The Gate is mirrored into the tracker as a comment and a label and
  into Slack, so a Human reads it where they already are. A Human may also rule there: `/approve` or
  `/reject <note>` as a comment on the record, or a button in Slack, accepted only when the external system
  signed the delivery and the commenter's identity was linked to their Member by that Human while signed in
  to deevy. ADR-0025 says why that is not the hole ADR-0010 closed.
- **A clean break.** The migration history is re-baselined and the first release of this shape starts from
  an empty database. An instance running v1 exports nothing. A plan that carried Issues, Documents and
  comments as a read-only archive was costed and refused: it keeps the tables and the screens alive to serve
  data nobody can act on.
- **Providers in this order: GitHub, Linear, GitLab, Notion.** One end to end before the next. GitHub
  first because one App gives issues, comments, labels, sub-issues, the repository credential and pull
  requests, and because it is the zero-config case. Slack's app follows the rulings-from-outside slice
  rather than the providers, because its buttons are a ruling door.
- **The Human-facing app is setup, "needs me", Runs, Gates, the inbox, the Event log, and a read-only Work
  list.** No issue list, no board. A Work page lists every record deevy knows with its state, its Agent and
  its last Run, filterable, and links out.
- **Two things the two design passes disagreed on, settled here.** Credentials are sealed under a new
  `DEEVY_SECRET`, not under `BETTER_AUTH_SECRET`: rotating the auth secret signs everyone out, which is
  survivable, and must not also destroy every Socket. The pull request is opened by the core through the
  forge Socket, never by the runtime: it is the same App identity that comments and labels, the binding
  already knows the base branch and the slug, and the runtime should not learn a second API.
- **The word Issue stays.** It now means a projection. "Item" and "work item" were considered as a signal
  that something changed, and refused: the Agent's instructions, the tool names and half the code keep their
  words, and the definition in CONTEXT.md is what changed.

## The model

### Sockets and their ports

A Socket has capabilities: `tracker` (records deevy projects Issues from), `forge` (a repository deevy mints
a git credential for and opens pull requests on), `docs` (pages deevy reads as markdown), `chat` (a place
deevy posts to and takes a click from). One provider module implements whichever it can.

The port types live in the core, `packages/core/src/sockets/port.ts`, exported as `@deevy/core/sockets`.
The implementations live in a new package, `packages/sockets` (`@deevy/sockets`): `src/github`,
`src/linear`, `src/gitlab`, `src/notion`, `src/slack`, `src/stub`, each written on `fetch` and
`crypto.subtle` with no `node:` import and the same tsconfig rule the core has. The core never imports the
package at runtime. `apps/server/src/server.ts` and `apps/web/src/worker.ts` build the registry and pass it
as `createApp({ sockets })`, exactly as the MCP surface's metadata fetch is injected today; the core's tests
take the package as a devDependency for the stub, as they take `@deevy/adapters` for `openDatabase`. This is
what respects the Workers build: the package is bundled by the same Vite build that catches a `node:` leak,
and a core that imported it would only have moved that line.

- `TrackerSocket`: `verifyInbound({ headers, rawBody, webhookSecret })` answers `{ ok, deliveryId,
eventName }` and never throws; `normalize(eventName, payload)` is pure and returns `InboundEvent[]`;
  `getIssue`, `listIssues({ updatedSince, cursor, limit })`, `listComments`, `createIssue({ title, body,
parent, labels })` (answering whether the parent could be linked natively), `createComment`,
  `setLabels({ add, remove })`, and `listContainers()` for the binding picker.
- `ForgeSocket`: `credential(scope)` → `{ cloneUrl, username, secret, expiresAt }`;
  `openPullRequest({ head, base, title, body })` → `{ url, number }`.
- `DocsSocket`: `readPage(ref)` → `{ title, markdown, url }`.
- `ChatSocket`: `post`, `update`, `openDm`, `verifyInteraction`, `normalizeInteraction`.
- `SocketModule { provider, capabilities, identity(), tracker?, forge?, docs?, chat? }`, built from
  `{ config, credentials, fetch, now }`. `identity()` proves the credential at connect time and records the
  bot login and id that the inbound loop guard drops.
- `InboundEvent` is one of: `issue` (opened, updated, closed, reopened, carrying an `ExternalIssue`: id,
  key, url, title, body, state open or closed, the provider's state name, assignees, labels, parent id, the
  provider's `updatedAt`), `comment`, `ruling` (a comment whose first line is `/approve` or
  `/reject <note>`), `installation`, `interaction` (a Slack click), `ignored` with a reason.

The `socket` table (`sock_`): workspace, provider, capabilities, name, `identity` JSON, `config` JSON (the
App id and slug, the installations, an API base; never a secret), `credentials` and `webhook_secret` sealed,
`installed_by`, status `active | paused | removed` (never hard-deleted: projections and Runs under it keep
reading), `last_inbound_at`, `poll_minutes`. Operations, all `admin` and none of them tools: `sockets.list`,
`sockets.connect` (proves the credential with `identity()`, records it, answers the inbound URL and, when
deevy minted it, the webhook secret once), `sockets.update` (pause, resume, rename), `sockets.rotate`,
`sockets.remove`, `sockets.containers` (the binding picker), `sockets.inbound` (the last fifty deliveries,
for a settings page that can say "GitHub last spoke two minutes ago"), `sockets.test`, `sockets.rewire` (a
laptop whose tunnel hostname changed).

### Secrets at rest

`packages/core/src/secrets.ts`: `sealSecret` and `openSecret`, AES-256-GCM through `crypto.subtle`, the
key derived by HKDF-SHA256 from `DEEVY_SECRET` with the info string `deevy:socket-credentials:v1`, the
envelope `v1.<iv>.<ciphertext>` so a later key version is a prefix rather than a migration. Web-standard on
both runtimes. `sockets.connect` refuses on an instance with no secret, in the words `elicitationKey`
already uses for the same condition. A GitHub App's private key arrives as PKCS#1 and `crypto.subtle`
imports PKCS#8, so the GitHub module wraps it at connect time and the operator pastes what GitHub gave them.
Losing `DEEVY_SECRET` loses every Socket; OPERATIONS.md says to back it up with the volume.

### A Project is a binding

`project` keeps its id, name, description and `archived_at`; loses `key`, `next_issue_number` and
`team_id`; gains a `slug` (the URL handle, derived from the container), `tracker_socket_id` with a
`tracker_scope` JSON and a stored `tracker_scope_key` that is unique per Socket so one container is one
Project and the inbound route finds it in one indexed read, an optional `forge_socket_id` and `forge_scope`
(which carries the base branch), an optional `docs_socket_id` and `docs_scope`, `default_agent_member_id`,
a `routing` JSON (`{ labelPrefix: "agent:", mention: true }`), and `mirror` as `off | gates | runs`,
default `gates`. `project_grant` is unchanged: it is still what scopes an Agent, and a child in another
Project still needs the grant.

### An Issue is a projection

`issue` loses `number`, `description`, `state_id`, `state_entered_at` and `approvals_cleared_at`. It gains
`socket_id`, `external_id`, `external_key` (the display handle: `acme/deevy#42`, `ENG-12`), `url`, a `body`
snapshot capped at 64 KiB, `state` as `open | closed`, `state_name` as the provider's own word, `assignees`
and `labels` as JSON, `parent_external_id`, `external_updated_at` (the out-of-order guard) and
`last_synced_at`. It keeps `parent_id`, `assignee_member_id` (now the Member deevy routed it to — kept under
its name so the filters, the index and the schedule sweep do not move), `created_by` (set only when deevy
created the record, which is delegation) and `closed_at`. Unique on `(socket_id, external_id)`.

**One handle, two aliases.** Every operation that names an Issue takes one string, `issue`, resolved by
`resolveIssueRef` in `operations/shared.ts`: an `iss_` id, a URL, or otherwise a key within the Workspace,
with `CONFLICT` naming both when two Sockets know a record by the same key. The URL is canonical because it
is what a Human pastes and what a webhook carries; the key is what a Human reads. Outputs carry all three,
and `RunSchema` keeps `issueKey` so the runtime and the instructions change in one place: the value.

**`run.issueId` stays a NOT NULL foreign key to the projection, with its cascade and its partial unique
index.** A Run is deevy's own record of an attempt on deevy's own row; a projection is never deleted except
by a deliberate purge, so the cascade is never exercised in ordinary operation, and every join in
`runs.list`, `dueRunsQuery` and the Gate reminder stays as it is. A nullable or loose reference would put a
left join and a null branch into each of them for a case that does not arise.

### Inbound

`POST /hooks/:socketId` in `packages/core/src/app.ts`, mounted before the `/rpc` and `/api` middleware and
building no session; `/hooks/*` joins `run_worker_first` in `apps/web/wrangler.jsonc`, and
`worker-routes.test.ts` fails until it does. The handler reads the raw body first, loads the active Socket
(404 otherwise), calls `verifyInbound` (401 on `ok: false`), inserts an `inbound_delivery` row (`inb_`:
socket, the provider's delivery id unique per Socket, the event name, a status, an error) with
`onConflictDoNothing` — no row means a replay, answered 200 — then `normalize` and `applyInbound`, and
answers 200 whatever applying did. GitHub disables a hook that fails repeatedly; a failure belongs in the
row and the log, not in the status code. A sweep arm deletes rows older than thirty days, fifty per pass.
`POST /hooks/:socketId/setup` takes a provider's redirect — GitHub's manifest conversion and installation
callbacks — with a signed `state`.

`applyInbound` (`packages/core/src/sockets/apply.ts`) is one function the poll reuses:

- An `issue` event finds the Project by `(socketId, scopeKey)` — none is `skipped` with the container's
  name — and upserts the projection in one statement guarded by `excluded.external_updated_at >=
issue.external_updated_at`, which is what makes a reordered delivery harmless. It appends `issue.synced`
  (with what changed), and `issue.closed` or `issue.reopened` when the state flipped, with `member: null`
  and the external actor in the payload. Then it **routes**: a label `agent:<handle>` naming an Agent
  granted this Project, else the Project's default Agent when the record is open and routed to nobody. A
  change of routed Agent updates `assignee_member_id` and appends `issue.assigned { byRouting: true }`,
  which the unchanged `issue.assigned` arm of `triggersFor` turns into a Run. A closed record routes nobody.
- A `comment` by the Socket's own identity is dropped — that is the loop guard against deevy's own mirrored
  comments — and any other appends `comment.created` with `mentionedMemberIds` resolved from
  `@<mentionHandle> <agent handle>` and `@<member handle>`, which the `comment.created` arm turns into a
  `mention` Run. Nothing stores a comment: `issues.get` reads them live.
- A `ruling` goes to `recordRuling` (below), after the author is resolved to a Member.
- An `installation` merges into the Socket's config and appends `socket.installation_added`.

The worked case: a Human on GitHub labels `acme/deevy#42` with `agent:planner`. `issues.labeled` arrives,
`x-hub-signature-256` checks out over the raw body, `x-github-delivery` is new, `issue.synced` goes in, the
label names `planner`, `issue.assigned` goes in, `startRuns` opens a `pending` Run, `run.started` goes in,
`deriveNotifications` gives `planner` an `assignment` row, and the runtime's `takeUpInbox` reads it exactly
as it does today. A GitHub App cannot be an assignee, so "assign it to deevy" is the label or the default
Agent, and the settings copy says so.

**Polling** is the fallback, not an afterthought: it is what keeps a laptop instance with no public URL
working. `syncSockets` in `work.ts`, a new arm of `runDueWork`, takes one Socket per pass — the one whose
`poll_minutes` is due, else the active one that has been quiet longer than `DEEVY_SOCKET_CATCHUP_MINUTES`
(default 30) — and for each Project bound to it calls `listIssues({ updatedSince, limit: 20 })` through
`applyInbound` with a synthetic delivery id, answering `more` on a full page. Bounded by the page and never
by the Workspace, as every other sweep is. A ruling typed on the tracker arrives by polling too, one
interval late. Slack has no polling equivalent for a click: without a public URL the buttons do nothing and
the message's link into deevy still works.

The statement budget is twenty to twenty-five per inbound delivery, which `budget.test.ts` ratchets. A
burst is many invocations, not one.

### A Gate is a request on a Run

Four tables replace `workflow_state`, `gate_approver`, `gate_decision_document` and the old
`gate_decision`:

- `checkpoint` (`chk_`): project, `name` unique per Project, `approvals_required` (default 1),
  `exclude_requester` (default off); `checkpoint_approver` beside it. `checkpoints.set { projectSlug,
checkpoints[] }` (admin) refuses a threshold nobody could meet exactly as `workflow.update` does today,
  and appends `project.updated`. A Checkpoint the policy does not list gets the default — one approval,
  from anybody — so an Agent that asks for `security-review` is not stranded.
- `gate_request` (`gate_`): run, issue, project, the Checkpoint's name and id, `proposal` (markdown, up to
  100 KiB), `links` JSON, `requested_by` (the Agent), `visit`, status `open | approved | rejected |
superseded`, `asked_at`, `decided_at`; a partial unique on `(run_id, checkpoint) WHERE status = 'open'`.
- `gate_decision` (`dec_`): the request, the Member, the decision, the note, **`via`** as
  `web | socket | slack`, the Socket where one was involved, and an `external_ref` (a comment id, a Slack
  channel and timestamp).

**A visit is a request.** Approvals are counted on one `gate_request`; a rejection sets its status and
nothing on it counts again; asking again is a new row with the next visit number. That is ADR-0020's rule
with `stateEnteredAt` and `approvalsClearedAt` both gone. A Proposal is immutable on its request, so a
changed Proposal is a new request (`gate.superseded` on the old, `gate.requested` on the new) and there is
nothing left for `gate-freshness.ts` to clear. Four-eyes survives by construction: N distinct Members with
`approved` on the open request, the requester excluded if the policy says so, one `rejected` ending it.

**The requester is the Human behind the Run**: `run.triggeredByMemberId` when that Member is a Human, else
the Sponsor of `run.agentMemberId`. That is PLAN.md's accountability rule read off the Run rather than
walked out of the Event log, and the thirty-line walk in `requesterFor` goes. It matters more than it looks:
with an Agent asking from a Checkpoint rather than a Human moving an Issue, the old definition would have
excluded nobody.

Operations, in a rewritten `operations/gates.ts`, with `runs.requestApproval` deleted:

- `gates.request { runId, checkpoint, proposal, links? }` (`agents`, `agentsOnly`, tool `gates_request`).
  An open request for the same `(runId, checkpoint)` with the same Proposal is answered as it stands —
  asking twice is one question — and a different Proposal supersedes it. Otherwise: the row, an
  `elicitation` Activity carrying `{ gateRequestId, url }`, the Run to `awaiting_input`, `run.activity`,
  `gate.requested`, and `run.awaiting_input` carrying `gateRequestId` so the inbox and `remindAboutGates`
  keep working with one field renamed in `notifications.ts`.
- `gates.get { requestId }` (`agents`, tool `gates_get`): the polling half, for a client with no
  elicitation support, which is every client today.
- `gates.list`: what the home page and the Gate page read; `mine` for "awaiting me".
- `gates.approve` and `gates.reject { requestId, note? }` stay `sessionOnly` and become thin wrappers over
  **`recordRuling(source, { requestId, memberId, decision, note, via, externalRef })`** in
  `packages/core/src/gates.ts`, the one policy function all three doors call: `assertHuman`, not suspended,
  a named approver where the Checkpoint names any, the requester refused where the policy says so, the same
  Human refused twice, then `gate.approval` short of the threshold, `gate.approved` at it, `gate.rejected`
  on a rejection, and `resumeGateRun` — `resumeGateRuns` narrowed to the one Run the request names, which
  retires `lastGateRequest`'s scan of twenty Activities — appending `run.answered` with the ruling.

The URL is `/gates/<requestId>`, a new SPA route. `mcp/elicitation.ts` keys its codec on
`{ runId, gateRequestId }` and reads `status === "open"`. `gateRecipients` in `notifications.ts` reads
`checkpoint_approver` or every active Human, and the set of `issue.*` kinds that once meant "arrived in a
Gate" goes: nothing arrives in a Gate any more, only `gate.requested` asks.

### Mirroring

A fourth derivation in `appendEvent`'s tail, `deriveSocketMirrors` (`packages/core/src/sockets/mirror.ts`),
after `deriveWebhookDeliveries`: for an Event on a projection whose Project's `mirror` setting wants it,
one `delivery { target: "socket", targetId: socketId, eventSeq }` row. The row is the record; the body is
rendered at send time from the Event, the Issue and the Run, as Slack's is. `deliverDueSocketMirrors` in
`work.ts` is the third arm beside Slack and webhooks, with the same claim, backoff and retirement (retired
when the Socket is paused or removed), six attempts, and `socket.mirror_exhausted` written to the log the
way `webhook.exhausted` is.

| Event                                        | under `gates` | under `runs` | what the tracker gets                                                                                                                     |
| -------------------------------------------- | ------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `gate.requested`                             | yes           | yes          | a comment: the Checkpoint, the Proposal, the links, the `/approve` and `/reject` hint, the deevy URL; the label `deevy:awaiting-approval` |
| `gate.approval`                              | yes           | yes          | a comment stating the arithmetic: "1 of 2, and not the one who asked"                                                                     |
| `gate.approved`, `gate.rejected`             | yes           | yes          | a comment with the Ruling and its note; the label removed                                                                                 |
| `run.started`, `run.completed`, `run.failed` | no            | yes          | a comment with the trigger or the summary                                                                                                 |
| `issue.link_added` of a pull request         | no            | yes          | nothing on GitHub, whose PR body links the issue; a comment on Linear and Notion                                                          |

Every comment ends `— <Agent name> · <run id> · via deevy`, because the tracker shows the App's bot account
as the author and the reader should not have to guess which Agent spoke. The label is created lazily by the
provider module on first use. `socket_mirror` (request, Socket, kind, external reference) remembers what
was posted where, so a Ruling from any door can edit the tracker's comment and replace the Slack message's
buttons.

### Rulings from outside

Two doors beside the browser, one function behind all three (ADR-0025).

**Identity.** A new `member_identity` table (`mid_`): member, provider, `instance` (a host, a Linear
organisation, a Notion workspace, a Slack team), `external_user_id`, `external_login` for display only and
never matched on, `verified_by` as `sign_in | oauth | link_code | email`, `linked_at`, `revoked_at`; unique
on the live external identity. Not Better Auth's `account`: those rows are written by sign-in, keyed per
provider rather than per Socket (two GitLab hosts would collide), carry sign-in tokens, and do not mean
"verified for ruling". `memberForExternalIdentity` reads the table and, for GitHub and GitLab when the
Socket's instance is the sign-in provider's host, falls back to `account` by `(providerId, accountId)` and
writes the identity row it found with `verified_by: sign_in` — so a Human who signed in to deevy with
GitHub rules from GitHub with no linking step. Explicit links, under `/api/identities/:provider/start` and
`/callback` with an HMAC-signed `state` and no table: GitHub or GitLab for a Google-signed-in Human through
Better Auth's own `link-social`; Linear by OAuth in user scope reading `viewer { id }`; Slack by a
single-use ten-minute link code that Slack delivered to that user alone and deevy redeems only from a
signed-in session; Notion by verified-email match only where an admin enabled `identityByEmail` on that
Socket, and badged "(email)" wherever the Ruling is shown, because Notion has nothing better to offer.
Settings › Identities lists them with how each was verified and lets a Human unlink one.

**The tracker.** The `ruling` inbound event, after the signature and the delivery id: the author is not a
bot (GitHub's `user.type`, which is also what keeps deevy's own mirrored comment, which quotes the words,
from ruling); the latest open request on that Issue is the one; the author resolves to a Member or the
reply comment says "I don't know who you are in deevy; sign in at `<url>/settings/identities` and link your
GitHub account" and `gate.ruling_refused` goes in the log; then `recordRuling(via: "socket")` with the
comment id as the external reference. A refusal — not an approver, the requester, already approved — is
the reply comment, in the same words the web card uses. The confirmation states the arithmetic, because
this Human never sees the card. deevy acts on a comment's `created` and ignores `edited`: the request row
is the authority and the mirrored comment is a record.

**Slack.** A Slack app is a Socket with the `chat` capability; the incoming-webhook Channel stays as the
no-app option that posts a link and takes no click. `docs/slack-manifest.yaml` is committed: a bot user with
`chat:write`, `im:write`, `users:read`, `commands`, interactivity at `/hooks/<socketId>`, a `/deevy` slash
command. The Socket verifies `x-slack-signature` (`v0=` HMAC over the version, the timestamp and the raw
body) within five minutes, accepting the previous signing secret for twenty-four hours after a rotation.
A `block_actions` click maps `(team, user)` to a Member; an unlinked user gets an ephemeral reply carrying
the link code; a linked one rules `via: "slack"`. Reject opens a modal for the note. The message is updated
through the outbox, never inline, so Slack's three-second acknowledgement holds on a cold Worker. A Human
with a linked Slack identity is told by DM where their preference asks for it; a `slack_app` Channel named
by a routing rule gets the room post. Buttons appear on both, and a click is always checked against the
clicker.

### Code: the credential and the pull request

`runs.checkout { runId }` (`agents`, `agentsOnly`, HTTP only — it returns a token and must never be a
tool; the runtime's allowlist is the second fence) answers `{ cloneUrl, baseBranch, headBranch, token,
expiresAt }` from the Project's forge Socket. `headBranch` is `deevy/<key-slug>-<runid8>`, so the core and
the runtime agree on a name without either inventing it. For GitHub it is a one-hour installation token
scoped to that one repository with `contents: write`, `pull_requests: write`, `metadata: read`.
`run.checkout_issued` goes in the log without the token. A Run resumed after a Gate calls it again: a fresh
clone, a fresh token, as today. A Project without a forge answers `NOT_FOUND` "This Project has no
repository".

`pulls.open { runId, head, title?, body? }` (`agents`, `agentsOnly`, tool `pulls_open`) opens the pull
request through the forge Socket with the title and body defaulted from the Run's summary (`titleFor` moves
from the runtime into `packages/core/src/forge.ts`), `Closes <issue url>` and the Run id appended, adds the
`issue_link` with `runId`, and appends `run.pull_request_opened`. `links_add` does not open anything as a
side effect: a write to a third party hidden inside a link operation is the opposite of saying what a tool
does. The runtime's push-nothing fallback pushes `headBranch` and calls `pulls.open` over HTTP.

The runtime's `DEEVY_AGENT_REPO`, `DEEVY_AGENT_GIT_TOKEN` and `DEEVY_AGENT_BASE_BRANCH` become an override
for a repository deevy has no Socket for; `DEEVY_AGENT_GITHUB_API`, `DEEVY_AGENT_GITHUB_REPO` and
`apps/agent/src/forge.ts` go. ADR-0014 and ADR-0019 hold exactly: the token exists in the supervisor
process only, `origin` is loopback, `.git/config` carries nothing.

### Delegation through a Socket

`issues.create { parent, title, body?, assignAgent?, projectSlug? }` (`agents`, tool `issues_create`):
the ceilings first (`refusesDelegation`, with `state <> 'closed'` where the recursive queries joined a
State's category); the Project is the parent's or a granted one named by slug; then `tracker.createIssue`
with the routing label for the named Agent — GitHub's sub-issues API, Linear's `parentId`, GitLab's
relates-to link, Notion's relation property where the scope names one — and the projection is upserted
**now**, with `created_by` and `parent_id` set whatever the tracker could link, so deevy keeps the tree
where the tracker cannot. `issue.created` and `issue.assigned` go in and the Run starts; the webhook that
follows finds the row by `(socket_id, external_id)` and the Run by the partial unique index, and does
nothing twice. `wakeParent` fires on `issue.closed` when every sibling is closed, which arrives when a Human
merges the pull request whose body says `Closes <url>` or closes the record by hand. The three ceilings,
`delegation.refused` and the Sponsor's rolled-up line are untouched.

### Operations and tools after the cut

Out: `workflow.*`, `documents.*`, `labels.*`, `teams.*`, `comments.list`, `comments.update`,
`comments.delete`, `issues.move`, `issues.setLabels`, `issues.update`, `runs.requestApproval`,
`gates.approve` and `gates.reject` in their Issue-keyed shape. In: `sockets.*`, `checkpoints.set`,
`gates.request`, `gates.get`, `gates.list`, `gates.approve` and `gates.reject` keyed on a request,
`identities.list`, `identities.link`, `identities.revoke`, `pulls.open`, `runs.checkout`. Changed:
`projects.create`, `projects.update` and `projects.get` carry the binding; `issues.get`, `issues.list`,
`issues.create` and `comments.create` are Socket-backed and take the one `issue` handle.

The MCP tool set is nineteen once Notion lands: `inbox_list`, `issues_get` (the projection plus the
comments read live, or an empty list marked stale when the Socket refuses), `issues_list`, `issues_create`,
`comments_create`, `projects_get`, `runs_list`, `runs_get`, `runs_start`, `runs_post_activity`,
`runs_finish`, `runs_answer` (a Human's), `gates_request` (an Agent's), `gates_get`, `pulls_open` (an
Agent's), `links_add`, `links_list`, `links_remove`, and `docs_get`. The runtime's allowlist is thirteen:
`inbox_list`, `runs_list`, `runs_get`, `runs_start`, `issues_get`, `issues_create`, `comments_create`,
`runs_post_activity`, `gates_request`, `gates_get`, `pulls_open`, `links_add`, `runs_finish`. One line of
that is a fix rather than a change: the shipped instructions have told an Agent to split work with
`issues_create` since the delegation plan, and the shipped allowlist has never granted it, so every attempt
was refused at the proxy. The changeset says so.

### The SPA

Routes: `/` is Home, "Needs me" — Gates awaiting me, Runs awaiting my answer, my Agents' Runs — and says
"Nothing needs you" when that is true. `/inbox` stays, and its right pane renders the Gate for a
`gate_awaiting` row. `/runs` is the feed, a flat table with the URL carrying status, Agent and Project;
`/runs/$runId` is one Run with its Gate requests. `/gates/$requestId` is the ruling screen: the Issue's
title and key linking out, the Agent, the Proposal rendered as markdown, the links, `GateControls` re-keyed
on the request with the standing it already shows and a `via` badge on each decision, the Run's feed in the
rail. `/work` lists every projection with key, title, state, Agent, last Run, open Gate and Socket, filters
in the URL, each row opening `/work/$issueId` read-only — Runs, Gates, links, Events, and "Read the
conversation on GitHub" where the composer was. Settings keeps Workspace, Members, Event log, Agents,
Channels, Webhooks, Notifications and MCP clients; gains **Sockets** (list, Connect GitHub by
create-from-manifest with a paste-an-existing-App fallback, thin paste dialogs for the others, per-Socket
status with "last spoke", inbound count, installations and repositories, Reconnect, Disconnect), reworks
**Projects** as bindings (Socket, container, base branch, default Agent, routing, mirror) with a
`checkpoint-policy.tsx` in place of the Workflow editor, and gains **Identities**. Gone: `/projects/*`,
`/issues/*`, Teams, Labels, the board, the Documents tab, the Tiptap editor, the pickers, the groupings,
the rooms. Sidebar: Needs me · Inbox · Runs · Work · Settings. The `deevy-ui` skill's test contracts change
where the screens do, and slice 14 rewrites that list.

## The slices

Sizes are t-shirt estimates for one developer plus agents: S under a day, M two to three days, L a week.
The acceptance script `vp run agent#acceptance` walks Documents and a Gate through the Workflow, and there
is no honest intermediate: it is taken out of CI in slice 0 with a note in `apps/agent/README.md`, and
slice 8 is where it comes back and proves the milestone.

### Slice 0: The cut (L)

**Goal.** Everything that made deevy a tracker is gone, the projection shell is in, and the tree is green.

**Work.** The migration history re-baselined to one `0001_init`. The `socket` table with the `stub`
provider only; the `project` and `issue` columns above; `resolveIssueRef`. `packages/sockets` with
`src/stub`: an in-memory tracker and forge whose `emit(event)` builds a signed request for `/hooks`, so a
test and the seed can play a provider without one. `createApp({ sockets })`. Every deletion in the model
section, in core, db, server, web, `wrangler.jsonc` (the Durable Object, its migration, `/collab`) and the
catalog. `gates.*` and `runs.requestApproval` out until slice 2, so the tool snapshot dips to thirteen for
one PR. `triggersFor` loses `stateRule` and `wakeParent` reads `state`. The SPA compiles with the deleted
routes gone, redirects for `/projects` and `/settings/{teams,labels,allowlist}`, and `event-text.ts` and
`notification-text.ts` without the dead kinds. The acceptance script out of CI.

**Acceptance test.** A projection inserted by the stub's `emit` is readable by URL, by key and by id;
`runs.start { issue: <url> }` opens a Run and `runs.list` answers with `issueKey` as the tracker wrote it.
`vp run -r test` is green with the deleted tests gone and nothing else touched; `web#build:workers` and
`web#check:workers` are green with no Durable Object; `budget.test.ts` is re-ratcheted; the OpenAPI and
tool snapshots are committed.

### Slice 1: Sockets, secrets, inbound, polling (M)

**Depends on.** 0.

**Work.** `secrets.ts`; the `sockets.*` operations; `/hooks/:socketId` and `/setup`; `inbound_delivery`
and its sweep; `applyInbound` with the upsert guard, the loop guard and routing; `syncSockets`;
`/hooks/*` in `run_worker_first`.

**Acceptance test.** A stub delivery labelled `agent:planner` opens exactly one Run for `planner` with
trigger `assignment` and one `assignment` Notification. The same delivery id twice is one Run and one
`inbound_delivery` row. An older `updatedAt` never overwrites a newer title. A comment by the Socket's own
identity appends nothing; another's opens a `mention` Run. A bad signature is 401 and no row. Neither the
sealed blob nor the plaintext appears in any output schema, which `secrets.test.ts` holds with a sentinel.
A poll page of twenty-one applies twenty and says `more`. The statement count of one inbound delivery that
opens a Run is asserted exactly.

### Slice 2: Gates are requests (L)

**Depends on.** 1.

**Work.** The four tables; `gates.request`, `gates.get`, `gates.list`, `gates.approve`, `gates.reject`;
`checkpoints.set`; `recordRuling` and `resumeGateRun`; the elicitation codec; `notifications.ts`'s Gate
arms; `remindAboutGates` re-keyed. `gates.ts` replaces `workflow.ts`.

**The test that has to be red first.** The old `runs.requestApproval` answered `approved` on the first of
two approvals until four-eyes fixed it; the same bug is available again with a fresh table. Write the
two-approval case before the operation exists and watch it fail for the right reason.

**Acceptance test.** The same Proposal twice is one request; a changed Proposal supersedes it and the log
says so. A Checkpoint wanting two with `excludeRequester` refuses the Sponsor of the Agent that asked,
accepts two other Humans as `gate.approval` then `gate.approved`, and `run.answered` reaches the Agent's
inbox with the ruling. One rejection closes the request and a re-ask is `visit: 2`. A Human's OAuth token
gets 403 on `gates.approve`, which is ADR-0010's proof moved to the new operation.
`recordRuling(via: "socket", externalRef)` records both columns. A Run at a Gate is not swept stale, and
the reminder re-derives the original ask after four quiet hours.

### Slice 3: Home, Runs, Work, the Gate screen (M)

**Depends on.** 2.

**Work.** `routes/home.tsx`, `routes/runs/list.tsx`, `routes/runs/run.tsx`, `routes/gates/gate.tsx`,
`routes/work/list.tsx`, `routes/work/item.tsx`, `components/work-filters.tsx` (slimmed from the Issue
filters), `components/item-events.tsx` (the activity stream without a composer), `GateControls` re-keyed,
the palette and the breadcrumb, `keysFor` in `lib/live.ts`; the CLI's `gates open` takes a request id or
a key and resolves the awaiting request.

**Acceptance test.** A Gate awaiting me is the first thing on `/`, a Run awaiting my answer the second.
`/work` filters ride in the URL and every one is the server's; the key links out with `rel="noopener"`;
nothing on `/work/$issueId` is editable. On `/gates/$requestId`, `⇧A`, `Note` and `⌘↵` rule; the card
shows "1 of 2" and the requester refusal; a decision `via: socket` reads "via GitHub" in `Gate decisions`.
The inbox's `gate_awaiting` row opens the ruling in the right pane with `data-focused`.

### Slice 4: The GitHub tracker (L)

**Depends on.** 1.

**Work.** `packages/sockets/src/github`: the App JWT (RS256 through `crypto.subtle`, the PKCS#1 to
PKCS#8 wrap at connect), installation tokens, `verifyInbound` (`x-hub-signature-256` compared in constant
time, `x-github-delivery`), `normalize` for `issues`, `issue_comment`, `sub_issues`, `installation` and
`installation_repositories`, the manifest conversion and installation callbacks behind `/setup`,
`listContainers` (an installation's repositories), `getIssue`, `listIssues` with `since`, `listComments`,
`createIssue` with the sub-issue call, `createComment`, `setLabels`. `sockets.connect` for `github` takes
the App id, the private key, the webhook secret and the client pair; `DEEVY_GITHUB_API` for GHES and the
acceptance stub.

**Acceptance test.** Fixture tests in `packages/sockets` against recorded payloads with an injected
`fetch`, never the network. In the core, a fixture `issues.labeled` delivery through `/hooks` opens a Run
for the labelled Agent and `issues_get` answers with the fixture's comments; a fixture `installation`
delivery records the installation; a manifest conversion stores the credentials sealed and nothing else.

### Slice 5: Settings — Sockets, Projects as bindings, Checkpoints (L)

**Depends on.** 2 and 4.

**Work.** `routes/settings/sockets.tsx` and `socket.tsx`; `components/connect-github.tsx` (the manifest
form, whose JSON the test asserts exactly: hook URL, redirect, permissions, events; and the paste
fallback); thin connect dialogs for Slack, Linear, GitLab and Notion behind one shape;
`project-settings.tsx` as a binding; `components/checkpoint-policy.tsx` (list, edit, approvers,
threshold, exclusion, explicit `Save policy`); Channels' `slack_app` kind; Notifications' Slack DM column;
the settings navigation regrouped.

**Acceptance test.** Both connect flows drive to a Socket through the stub client; `Save policy` refuses a
threshold nobody could meet in the words the Workflow editor used; a binding picks a Socket, a container
from `sockets.containers` and a default Agent; a Socket's page says when it last spoke and that it is
polling after twenty-four quiet hours.

### Slice 6: The GitHub forge (M)

**Depends on.** 4.

**Work.** `runs.checkout`, `pulls.open`, `packages/core/src/forge.ts` with `titleFor`, the
`run.checkout_issued` and `run.pull_request_opened` kinds.

**Acceptance test.** A Run on a Project with a forge binding gets a credential whose token appears in no
Event, no read and no log line; the credential is refused for a Run that is not the caller's; the pull
request's body carries `Closes <issue url>` and the Run id; `issue.link_added` carries `runId`; a Project
without a forge answers `NOT_FOUND`; `runs.checkout` is absent from `tools/list`.

### Slice 7: Mirroring (M)

**Depends on.** 2, 4 and 6.

**Work.** `deriveSocketMirrors`, `deliverDueSocketMirrors`, `socket_mirror`, the signature line, lazy
label creation, the `mirror` setting on the binding form.

**Acceptance test.** `gate.requested` on a `gates` Project owes one socket delivery whose send calls
`createComment` and `setLabels` with the label; `gate.approved` removes it; `run.started` owes nothing
under `gates` and one under `runs`; a Socket paused mid-retry retires the row; a mirrored comment echoed
back through `/hooks` is dropped by identity — and that test is written before this slice ships, because a
loop here is a loop between deevy and GitHub.

### Slice 8: The runtime after the cut, the seed, the acceptance walk (M)

**Depends on.** 6 and 7.

**Work.** `config.ts`'s override group; `deevy.ts` gains `checkout` and `openPull`; `work.ts` checks out
before it clones; `deliver.ts`'s fallback pushes `headBranch` and calls `pulls.open`; `forge.ts` deleted;
`tools.ts` at thirteen; `instructions.md` rewritten — find the work, find your Run, read the record and
its comments where they live, narrate, write the plan and `gates_request { checkpoint: "plan" }` then
stop, split with `issues_create` and finish, on approval build and push, `pulls_open` when it is ready to
be read and `gates_request { checkpoint: "ship" }` where the Project lists it, say what a Human needs to
know, finish — with `docs/agent-loop.md` and `docs/as-yourself.md` following. `DEEVY_DEV_STUB_SOCKETS=1`
(refused in production, reported on `health.ping` like `devSignIn`) registers the stub; `seed.ts` connects
one, binds a Project, projects thirty records, opens Runs and Gates with Proposals, rules some `via: web`
and some `via: socket`; `acceptance.ts` and `boot.ts` walk the stub; `docs/m4-acceptance.md` becomes
`docs/sockets-acceptance.md`; the script back in CI.

**Acceptance test.** On Node and on workerd: a signed label delivery opens a Run; the scripted session
reads the record, narrates, and asks for the `plan` Gate; the Proposal is in the stub's state as a comment
under the Agent's name and Run id; a signed `/approve` by the admin's GitHub id rules `via: socket` and
the Run is `active` with `run_answered` in the inbox; the second pass writes a file, pushes, opens the pull
request, attaches it and finishes; the branch is on the bare repository, the link carries the Run id, the
pull request is in the stub's state, and the Events are in order. Then the refusals: `/approve` by an
unknown id gets the linking reply and no decision; `/approve` by the requester where the policy excludes
them gets the four-eyes words. The token is in neither the session's environment nor `.git/config`, and
`runs.checkout` through the proxy is denied and named in the feed.

### Slice 9: Identities and rulings from the tracker (L)

**Depends on.** 7.

**Work.** `member_identity`; `identities.ts` (the resolver with the `account` fallback, the link flows,
the link code); `/api/identities/*`; `rulings.ts` (`parseRulingCommand`, the bot filter, the reply
comments that state the arithmetic, `gate.ruling_refused`); `routes/settings/identities.tsx`; the
`budget.test.ts` case.

**Acceptance test.** An admin who signed in with GitHub rules by commenting `/approve` with no linking
step; a Google-signed-in Human is refused with the linking message, links GitHub, and the same comment then
rules; a bot comment containing `/approve` rules nothing; a replayed delivery rules nothing; the requester
is refused with the web's own words; a Gate wanting two records "1 of 2" in the reply and the Run stays
waiting; an identity linked to a suspended Member is refused; email-match is refused on a Socket where it
is off; the hook path's statement count is asserted exactly.

### Slice 10: The Slack app Socket (L)

**Depends on.** 9.

**Work.** `docs/slack-manifest.yaml`; `packages/sockets/src/slack` (verification, `block_actions`,
`view_submission`, `/deevy link`, `chat.postMessage`, `conversations.open`, `views.open`, `chat.update`);
`socket_mirror` for the channel and timestamp; DM routing on the preference; the previous-secret window;
Settings › Sockets › Slack and the `slack_app` Channel.

**Acceptance test.** A signed `block_actions` from a linked user rules `via: slack` and the message is
updated through the outbox; an unlinked user gets an ephemeral reply whose code, redeemed while signed in,
links them; a stale timestamp and a bad signature are 401; a Ruling made in the browser updates the same
message; the incoming-webhook Channel still delivers a link-only message.

### Slice 11: Linear (M)

**Depends on.** 9.

**Work.** `packages/sockets/src/linear`: GraphQL; `Linear-Signature` over the raw body and
`Linear-Delivery`; OAuth with `actor=app`; states of type `completed` or `canceled` are `closed`; native
`parentId`; labels by name; the app user as an assignee routes to the default Agent; identity by OAuth in
user scope; an OPERATIONS.md section.

**Acceptance test.** Fixture tests; one core walk through `/hooks` that opens a Run, mirrors a Gate and
takes a `/approve` back; the setup section walked once against a real Linear workspace and torn down, as
M3's was.

### Slice 12: GitLab (M)

**Depends on.** 9.

**Work.** `packages/sockets/src/gitlab`: REST v4; `X-Gitlab-Token` in constant time and
`X-Gitlab-Event-UUID`; issues, notes and labels; merge request creation; `oauth2:<token>` for git; the
`account` fallback for a GitLab sign-in; an OPERATIONS.md section.

**Acceptance test.** The same shape as Linear's, with the forge half of slice 6's tests run against the
GitLab module.

### Slice 13: Notion (L)

**Depends on.** 9.

**Work.** `packages/sockets/src/notion`: an integration token; the webhook verification handshake and
`X-Notion-Signature`; database rows with a named status property and its closed values; comments; the
people property routing to the default Agent; `docs.readPage` turning blocks into markdown and the
`docs_get` tool; `identityByEmail` on the Socket; an OPERATIONS.md section.

**Acceptance test.** The same shape, plus `docs_get` answering a page's markdown for a Project with a docs
binding and `NOT_FOUND` for one without.

### Slice 14: The record (S)

**Depends on.** everything above.

**Work.** OPERATIONS.md: `ROOMS`, `DEEVY_AGENT_GITHUB_API` and `DEEVY_AGENT_GITHUB_REPO` out;
`DEEVY_SECRET`, `DEEVY_GITHUB_API`, `DEEVY_DEV_STUB_SOCKETS` and `DEEVY_SOCKET_CATCHUP_MINUTES` in; the
override trio described as one; a subsection per provider on what an operator registers and pastes; the
paragraph that says a Socket delivers to a public URL, that a laptop needs a tunnel, that a named tunnel
beats a changing one, that `sockets.rewire` exists, and that polling is why none of that is required for
the local loop. DEVELOPMENT.md for the stub. The `deevy-ui` skill's test contracts rewritten. PLAN.md's
milestone paragraph in the past tense. "What it found" below, answered.

## Conventions every slice follows

The milestone conventions hold (M1's definition of done in [m1.md](./m1.md)). This plan restates the ones
it leans on and adds the last three.

1. **Test-first, and the red is read.** The failure modes here are loops between deevy and a tracker,
   double-triggering from a webhook and its echo, and a credential that leaks into an output; every one is
   invisible in a test written afterwards to match the code.
2. Schema in `packages/db/src/schema/<area>.ts`, relations merged in `relations.ts`, migration generated
   with `vp run db#generate`, `NOT NULL` hand-patched onto text primary keys, `vp run db#check:migrations`
   green. Slice 0 is the one that re-baselines; every later slice adds a migration as before.
3. Operations through `defineOperation` in their area's module; refusals in CONTEXT.md's words;
   `vp run core#snapshot:openapi` and `vp run core#snapshot:mcp-tools` committed when an input or output
   changes.
4. Every write appends its Event through `appendEvent` in the same handler. An inbound delivery is a write.
5. **A new `EventKind` has four consumers**: the sets in `notifications.ts`, `lib/event-text.ts`, the
   Event log's What column, and the webhook subscribers.
6. **Every inbound handler and every sweep arm is counted against the statement budget** in
   `budget.test.ts`, asserted exactly.
7. Core tests through `createRouterClient(router, { context })`; SPA tests against `stub-client.ts`.
8. **No credential in any output schema.** `secrets.test.ts` seeds a sentinel into every sealed column and
   greps every response the registry can produce for it.
9. **A provider module is tested against recorded payloads with an injected `fetch`, never the network.**
   The fixtures are real deliveries with the secrets scrubbed, and a provider changing its payload shape is
   a fixture update with a diff somebody reads.
10. **The stub Socket plays every provider role in a core test.** A rule about inbound, routing, mirroring
    or a ruling is proved against the stub first and against a provider's fixtures second.
11. `vp check` clean, `vp run -r test` green, `vp run web#build:workers` then `vp run web#check:workers`
    green, a changeset written for somebody upgrading deevy.

## Dependency order

```
main
└─ 0 The cut
   └─ 1 Sockets, secrets, inbound, polling
      ├─ 2 Gates are requests
      │  └─ 3 Home, Runs, Work, the Gate screen
      └─ 4 The GitHub tracker
         ├─ 5 Settings: Sockets, bindings, Checkpoints         needs 2 and 4
         └─ 6 The GitHub forge
            └─ 7 Mirroring                                     needs 2, 4 and 6
               ├─ 8 The runtime, the seed, the acceptance walk
               └─ 9 Identities and rulings from the tracker
                  ├─ 10 The Slack app Socket
                  ├─ 11 Linear
                  ├─ 12 GitLab
                  └─ 13 Notion
                     14 The record                             needs everything
```

Slices 2 and 4 are independent once 1 is in, and so are 3 and 5, 8 and 9, and 10 through 13. Built in the
order written, the acceptance walk in slice 8 is the first end-to-end proof, and nine's rulings land with a
walk to extend rather than a walk to write.

## Deferred

Per-Agent identities on a Socket, where a provider makes them cheap: the port carries an `agentMemberId`
key in its credentials for the day, and `identity()` becomes per-credential. Jira and Asana, each its own
module and its own OAuth app. A docs Socket that writes. Approving from email. Sibling ordering inside a
delegation, still. Cost and time accounting per Run, which was first on the list before this plan and is
first after it. A Slack path with no public URL: there is none, and the link in the message is the answer.
Any change to what an Agent may rule: nothing, on any door.

## Risks, named

- **GitHub cannot assign an App.** "Assign it to deevy" is a label or the Project's default Agent, and the
  settings copy says so where a Human will look for the assignee picker.
- **One webhook URL per GitHub App**, so a Socket is the App and installations are a list on it. A second
  organisation installing the same App is a second entry, not a second Socket, and its repositories bind
  as Projects like any other.
- **Delivery reordering and replay.** GitHub redelivers and reorders and signs no timestamp; the
  `inbound_delivery` id table and the `external_updated_at` upsert guard carry it, and a replayed ruling
  finds its comment id already on a decision. Comments have no ordering problem because nothing stores
  them.
- **D1's per-invocation budget.** About twenty-five statements per inbound delivery, one Socket page per
  poll, and the ratchet in `budget.test.ts`. A burst is many invocations. A Human opening ten sub-issues
  by hand is ten deliveries, not one.
- **The App's bot account authors every comment.** The signature line names the Agent and the Run; a
  reader who wants a per-Agent author waits for the deferred item.
- **Installation tokens live an hour**, longer than a Run's timeout; a Run resumed after a Gate re-mints
  and re-clones, as it does today. A session that outlives its token loses push and the feed says so.
- **A repository admin can edit the App's comment.** deevy acts on `created` and ignores `edited`; the
  request row is the authority and the Proposal is what the decision was made on, so an edited comment
  changes nothing that was approved.
- **Slack's three-second acknowledgement on a cold Worker.** The handler writes the decision and returns;
  everything Slack-facing after that is the outbox.
- **The hole ADR-0025 owns rather than closes.** A program holding a Human's own GitHub or Slack account
  rules as them. It always could through a driven browser; the Identities page says so beside
  Unlink.
- **`DEEVY_SECRET` loss loses every Socket**, and OPERATIONS.md says to back it up with the volume.
  Refusing to connect a Socket on an instance with no secret is the honest floor.
- **A tunnel whose hostname changes** breaks every registered hook: `sockets.rewire` and polling exist so
  the loop survives; Slack's buttons need the public URL and nothing else will do.
- **The requester's meaning changes** to "the Human behind the Run". It is the same accountability rule
  PLAN.md states, and the old reading would have excluded nobody once no Human moves an Issue.
- **The acceptance walk is dark for eight slices.** Said here, said in the README, and the reason slice 8
  is where it is.

## What it found

Written before the work, to be answered after it.

**Slice 13, as built.** Notion verifies its webhook with the token deevy received, somebody tags a row
`agent:planner`, deevy reads the row back and routes it, the Proposal is the integration's comment on it, a
Human approves by commenting once an admin allows a verified address to vouch for them, and an Agent reads the
plan with `docs_get` — the real module behind the real route, with only Notion's API replaced
(`packages/sockets/tests/notion-deevy.test.ts`). The MCP tool set is nineteen, as the plan said. As with the
other providers, "Working in Notion" has **not** been walked against a real workspace.

Six things came out differently from the sketch.

- **A Notion delivery is a signal, not a record.** An event names a page or a comment and carries none of it,
  so the port grew two events that mean "read this back" — `changed` and `commented` — and `getComment`
  beside `getIssue`, and `applyInbound` takes the tracker to read them with. A record is read through the
  Project its data source is bound to, because the binding decides what its properties mean; what comes back
  is applied exactly as an `issue`, `comment` or `ruling` event would have been.
- **Notion sends its signing secret once, unsigned.** `TrackerSocket.handshake` takes it, and deevy keeps
  what it is sent until a delivery signed with it proves it was Notion's (`config.webhookVerified`), after
  which nothing unsigned replaces it; a secret an admin chose is never replaced at all. `sockets.handshake`
  shows it to an admin, who pastes it into Notion's Verify, and stops showing it once it is proven.
- **No block converter.** Notion's current API (2026-03-11) reads a page's content as markdown and takes
  markdown for a new page and for a comment, so "turning blocks into markdown" is Notion's own and the module
  asks for it. A poll's query answers properties and not content, so `ExternalIssue.body` may now be absent,
  and deevy keeps the body it last read rather than fetching twenty pages a pass.
- **The binding reads the schema.** `listContainers` answers each data source with what its properties mean
  — the first status property and the statuses in its Complete group, the first multi-select as labels, the
  first people property, a self-relation named like a parent, the ID property as the key — so an admin binds
  a database without naming any of it. The integration among a row's people is the row handed to deevy,
  which reuses Linear's delegate routing.
- **`docs_get` is in the runtime's allowlist**, which is fourteen now. The plan left it out because it was
  written before there was a document to read; a Project with its plans in Notion and a runtime that cannot
  read them would have been a feature nothing used.
- **A Project's documents can be bound after it is made**, from its settings (`projects.update` with `docs`),
  whatever its tracker: a Linear Project with its plans in Notion is one binding each.

**Slice 12, as built.** An issue labelled on GitLab becomes a Run, the Proposal is a comment on it, a Human
who signs in to deevy with GitLab approves it by commenting with no linking step, and the Run clones with the
Socket's token and opens one merge request that closes the issue — the real module behind the real route, with
only GitLab's REST API replaced, and slice 6's forge assertions run against it
(`packages/sockets/tests/gitlab-deevy.test.ts`). As with Linear, the OPERATIONS.md section ("Working in
GitLab") has **not** been walked against a real GitLab.

Five things came out differently from the sketch.

- **A Socket is a GitLab user and its access token, not a GitLab application.** An OAuth application's tokens
  last two hours and rotate their refresh token, which is the writer Linear's slice found a module does not
  have, and GitLab has no client-credentials grant to fall back on. A personal, project or group access token
  is exactly "the user deevy acts as", and connecting proves it with `GET /user`.
- **So the forge credential is the Socket's own token.** GitHub mints a one-repository token per Run; GitLab
  mints nothing narrower from a token, so a Run clones with the Socket's, as `oauth2`, with no expiry deevy
  knows. ADR-0014 and ADR-0019 still hold — it lives in the supervisor and nowhere else — and OPERATIONS.md
  says to give the user Developer on the projects it works and no more.
- **Two ways to prove a delivery.** `X-Gitlab-Token` in constant time, as planned, and GitLab 19's signing
  token — Standard Webhooks' `webhook-signature` over the id, the timestamp and the body, refused past five
  minutes — which the connect dialog takes in place of the secret deevy mints. The delivery id is
  `Idempotency-Key`, which GitLab keeps across its own retries, before `X-Gitlab-Event-UUID`.
- **Whose accounts a GitLab Socket shares is the deployment's to say.** GitHub's sign-in only knows
  github.com, but GitLab's is wherever `GITLAB_ISSUER` points, so the registry takes `gitlabSignInIssuer` from
  each entry and a Socket on that instance — and only that one — rules by sign-in.
- **A pull request's link is named in the forge's words.** The link on the record said "Pull request #7" for
  a GitLab merge request; `openPullRequest` may now answer a `label` ("Merge request !7"), and `pulls.open`
  reads a number back out of either.

What is not here: deevy does not add the webhook to a project itself. It could, through the same token, when
a Project is bound — but that is a write to somebody else's settings hidden inside a binding, and the dialog
says what to add instead. An Agent's sub-issue is related to its parent (`relates_to`), since GitLab has no
parent for an issue, and deevy keeps the tree as it does on a GitHub Enterprise Server without sub-issues.

**Slice 11, as built.** An issue labelled in Linear becomes a Run, the Agent's Proposal is the app's comment
on it, and a Human who linked their Linear account rules by commenting `/approve` — the real module behind
the real route, with only Linear's API replaced (`packages/sockets/tests/linear-deevy.test.ts`). The setup
section in OPERATIONS.md ("Working in Linear") has **not** been walked against a real Linear workspace; that
is the step this slice leaves, and the only one.

Four things came out differently from the sketch.

- **`actor=app` is the client-credentials grant, not the authorization-code install.** Linear made refresh
  tokens mandatory on 2026-04-01: an authorization-code token lives a day and its refresh token changes on
  every use, which needs something to write the new one back, and a provider module has no writer. A
  client-credentials token is an app-actor token minted from the client id and secret the operator pasted,
  cached per isolate like a GitHub installation token, and minted again when Linear stops taking it. The
  authorization-code flow with `actor=app` is still there for the one thing only it gives — installing deevy
  as an agent (`sockets.install`, `SocketModule.install`), which is what lets a Human assign an issue to it.
- **Assigning is delegating.** Assigning a Linear issue to an app now makes the app its delegate and leaves
  the Human its assignee. `ExternalIssue.delegateId` carries that, and is never stored; a record delegated to
  the Socket's own identity goes to the default Agent even where a label had routed it elsewhere. That is
  the plan's "the app user as an assignee routes to the default Agent", in Linear's current words.
- **Linking starts in an operation, not a route.** `identities.begin` is `sessionOnly`, like
  `identities.link`, and answers the consent URL; only `/api/identities/:provider/callback`, which answers a
  browser mid-redirect, is a route. Its `state` is signed over the Socket and the Member, so a callback that
  another Human's browser finishes links nothing, and there is still no table. The account must be in the
  workspace the Socket reads.
- **The pull-request row of the mirror table** lands here, as slice 7 said it would: a comment under `runs`
  wherever the Project's tracker is not also its forge — the rule that "nothing on GitHub" was one case of.
  A pull request's link costs one read more, for the Project's binding; any other link costs nothing.

The HMAC helpers that GitHub, Slack and now Linear would each have carried a copy of are one file,
`packages/sockets/src/signing.ts`.

**Slice 10, as built.** A Gate posted to a Slack room or a linked Human's direct messages carries Approve
and Reject; a click rules as the Human whose Slack account it is, through the same `recordRuling`, and the
message changes through the outbox wherever the Ruling came from. The real module behind the real route
proves it end to end (`packages/sockets/tests/slack-deevy.test.ts`), and a click that rules costs 24
statements, asserted.

Four things came out differently from the sketch, and one was a bug the slice found in an older one.

- **`sockets.connect` never proved the credential it was given.** It built the module from the
  configuration alone, so a real Slack token — or a pasted GitHub App key, since slice 5 — could not answer
  `identity()`, and the fakes hid it because theirs needs no credential. It seals first and proves with
  what it sealed now, and a test fails the old way.
- **Connecting Slack is one trip.** Slack wants the request URL in the app's own manifest, and the URL
  names the Socket, so `sockets.begin` starts it and `sockets.connect` completes it (`socketId`). The dialog
  renders the committed `docs/slack-manifest.yaml`, so the manifest in the repository is the one people
  paste.
- **A link code names its account before it links.** The code links a Slack account to whoever redeems it,
  so a code handed over by somebody else links theirs; `identities.peek` shows which account, and linking is
  a second, deliberate step. Codes are stored as a hash, and nothing about one reaches the Event log.
- **Three things are said inline, not through the outbox.** The plan put everything behind the outbox for
  Slack's three seconds, and the Ruling and the message update are. But a dialog must open within Slack's
  `trigger_id` window, a link code must never sit in a queue, and a refusal is for the one person who
  clicked and nobody else; each is one request, answered to that person alone.

A refusal made in Slack is written to the log (`gate.ruling_refused`, `via: slack`) and not mirrored to the
tracker, where it would be said to everybody. `run.awaiting_input` is what notifies a Gate, so the chat
sweep finds the Gate through that Event's payload as well as its own. A Ruling now costs one statement more
everywhere — it asks where the Gate's chat messages are — which the ratchets record.

**Slice 9, as built.** A Human rules by commenting `/approve` where they read the Proposal, and deevy
proves who wrote it from the tool's own account id: an Identity already written down, the account they sign
in to deevy with, or — only on a Socket an admin allowed it — an address they verified. The acceptance walk
does it on both deployments, the stranger and the requester included. A ruling from the tracker costs 30
statements the first time its author is seen.

Five things came out differently from the sketch.

- **No `/api/identities/*` routes yet.** Every provider this slice can link — GitHub, and GitLab's accounts
  once its Socket lands — is a sign-in provider, and linking one is Better Auth's own `link-social` from a
  signed-in session, which writes the `account` row the resolver already reads. The routes come with the
  first tool whose accounts are not a sign-in's: Linear's user-scope OAuth in slice 11. Slack's link code is
  slice 10's.
- **`allowDifferentEmails` is on.** The sign-in work set it off because "two addresses are two Humans until
  deevy has a screen that says otherwise", and Settings › Identities is that screen. Better Auth reads it
  only on the explicit link a signed-in session starts, which still wants a verified address and still
  refuses an account linked to somebody else; a sign-in on another Human's address links nothing, and a test
  through the real callback says so.
- **Unlinking needed a way back.** A revoked Identity is what stops the account a Human signs in with from
  linking them again behind their back — so nothing else can undo it, and `identities.restore` is how the
  Human does.
- **Which accounts are worth linking is the server's to say.** The screen first offered every sign-in
  provider whose accounts could rule anywhere, which on a stubbed instance meant a GitLab button with no
  GitLab Socket behind it. `identities.list` now answers `linkable` from the connected Sockets' own
  `identityScope`, which is also where github.com and a GitHub Enterprise Server are told apart.
- **The words are the mirror's.** A refused Ruling appends `gate.ruling_refused`, and the reply on the record
  is rendered from it at send time like every other mirrored comment, so a Project that mirrors nothing
  answers nothing — and still takes the Ruling. The confirmation needed no new code: the arithmetic ("1 of
  2, still waiting") was already how slice 7 says a `gate.approval`.

**Slice 8, as built.** The walk is the point of this slice, and running it found five defects that every
test in the tree had missed. They are written up in
[`docs/sockets-acceptance.md`](../sockets-acceptance.md); the two that matter most are a Run at a Gate being
un-waited by the supervisor's own narration — which put it under the stale sweep, the exact thing a Gate is
promised never to suffer — and two pull requests for one attempt, because the instructions tell the Agent to
open one and the supervisor opens one for any branch a session pushed and left.

Three departures from the plan's list.

- **The Ruling from the tracker is not in this walk.** The plan's acceptance for this slice asks for
  `/approve` by the admin's GitHub id, and `applyInbound` says in as many words that deevy cannot yet tell
  whose account wrote a comment — that resolver is slice 9's, and this slice depends on 6 and 7, not on 9.
  The walk rules in deevy, which is the canonical door, and slice 9 adds the tracker's to the same script.
  The refusals the plan asks for are there: the four-eyes one in the Checkpoint's own words, and
  `runs_checkout` refused at the proxy.
- **The runtime's tool list stayed at thirteen, and `issues.get` grew a field.** The instructions tell an
  Agent to stop at the Checkpoints its Project lists, and nothing in those thirteen could say which those
  are — `projects_get` is not among them and `checkpoints.list` is not a tool at all. Rather than widen the
  list, the record an Agent reads carries `checkpoints`: it is read once, at the moment the whole Run is
  being planned, and it costs one query on the read that already assembles the brief.
- **The label half of the mirror cannot be asserted from outside.** `issues.get` answers deevy's projection,
  whose labels are whatever the tracker last said rather than what deevy last asked for, so the walk proves
  the comment and `packages/core/tests/mirror.test.ts` proves the label against the tracker's own state.

The stub grew one thing it should always have had: `normalize` gives a delivery its clocks back. A provider's
`normalize` answers deevy's own types, two of which are Dates, and the core compares one to decide a
reordered delivery and writes it to an integer column — so a stub that handed back JSON's strings only worked
in a test that never wrote one down. The seed found a second: its sign-in was reaching the real github.com,
because the stub answers everything after the OAuth `code` and not the authorization page a person clicks.

**Slice 7, as built.** The derivation reads one row the plan had not counted: an Event of a mirrorable kind
has to ask its Project what it mirrors, so a Gate's ask and its ruling each cost two more statements — the
read and the delivery row. The busy paths pay nothing, because `couldMirror` is a pure check on the kind
and `issue.synced`, `comment.created` and the rest never reach the query. The budgets are 19 for a Gate and
24 for an inbound delivery that opens a Run, still half of D1's cap.

The `issue.link_added` row of the plan's table is not here. On GitHub it was always "nothing", and the
providers it is a comment on — Linear and Notion — are slices 11 and 13; a mirror arm with no provider to
exercise it would have been written blind. It goes in with the first of them.

**Slice 6, as built.** Nothing in the plan's shape changed, and two things were tightened on the way past.
`links.add` and `pulls.open` now attach evidence through one function, so a link looks the same whoever
attached it and the `runId` reaches the Event either way — the plan had them as separate writes, which is
how the two would have drifted. And `requireForgeBinding` is a `NOT_FOUND` about the repository rather than
an error about the Project, because a tracker with nothing to build is an ordinary Project and the refusal
should read like it.

The runtime still carries its own `branchFor` and its own forge client; slice 8 is where they go, and where
it starts reading `headBranch` off `runs.checkout` instead. Until then the two agree because the core's
implementation was moved from the runtime's, which is the weakest form of agreement and the reason slice 8
deletes one of them.

**Slice 5, as built.** The plan's list for this slice included Channels' `slack_app` kind and Notifications'
Slack direct-message column. Both are the Slack Socket's, and it arrives in slice 10; offering either now
would be a setting with nothing behind it, so they move there. What took their place is the one thing the
plan's list did not name and a fresh instance cannot do without: **binding a Project at all**. The old
`/projects` page is a redirect now, so without a `Bind a Project` dialog in Settings a new Workspace could
connect GitHub and then have nowhere to point it.

Two smaller decisions. `sockets.providers` exists because a screen has to offer exactly what the build can
speak — the registry is injected, so the SPA cannot know it — and the `stub` is left out of what it offers,
since a development fixture is not a tool somebody connects. And the container picker stays live while its
answer is in flight rather than disabling itself: a select that goes dead loses the click that opened it.

**Slice 4, as built.** The setup route came back from slice 1 with a shape the plan had not settled, and it
settled itself: a provider's redirect is a port method (`SocketModule.setup`), so the core knows nothing
about manifests, and the operator's browser is sent back to a Socket that already exists —
`sockets.begin` writes that row, in a new `pending` status, before there is any credential to put in one.
The `state` is signed with the instance's own secret rather than a second one, because nothing is sealed
with it and what it protects expires in an hour. The install callback carries no state and needs none: what
it carries is an id, and the module asks GitHub what that id is before deevy writes it down.

Two smaller findings. A GitHub issue's id is its node id rather than its number, because a number belongs to
a repository and a transferred issue would otherwise arrive as a second record; the number is parsed from
the URL deevy already stores, which is the one thing about a record that is true in both places. And
`issues.get` grew the live conversation the model section promised — `comments: true`, off by default,
because it is a request to somebody else's API and a list should not make one.

**Slice 1, as built.** Three things came out differently from the sketch above.

- `POST /hooks/:socketId/setup` is not in this slice. Both flows it exists for are GitHub's — the manifest
  conversion and the installation callback — and the manifest one redirects before there is a Socket to
  name in the path, so its shape is a decision about how a pending Socket is created rather than about
  routing. It lands with the GitHub module in slice 4; `/hooks/*` is already in `run_worker_first`, so the
  route costs nothing to add there.
- A poll asks about **one Project per pass**, not one Socket per pass with every Project under it. Applying
  one record costs about four statements, so a Socket with three Projects and a page of twenty would have
  been three times over D1's cap in a single Cron invocation. `project.last_polled_at` is what makes the
  choice one indexed read, and `more` brings the platform back for the next Project.
- `sockets.connect` refuses **only when there is something to seal**. The sketch said it refuses without
  `DEEVY_SECRET` at all, but the stub holds no credential, and a deployment that cannot seal one should
  still be able to run the in-process provider the seed and the tests use.

One delivery that opens a Run costs **23 statements**, inside the twenty-to-twenty-five the plan predicted
and half of D1's cap. `budget.test.ts` asserts it exactly.

**Slice 2, as built.** Two departures, both small.

- The policy split out of `gates.ts` into `checkpoints.ts`. `notifications.ts` has to know who may rule —
  that is who a Gate asks — and it is imported by `appendEvent`, so anything it reads has to sit below the
  Event log rather than beside it. `gates.ts` keeps the request, the Ruling and the view; `checkpoints.ts`
  holds the policy, the requester and the approvers, and appends nothing.
- `gate.requested` notifies nobody. `run.awaiting_input` is the Event that asks, carrying `gateRequestId`,
  exactly as the plan said — which means the reminder, the Slack rules and the preference matrix all work
  unchanged, and what decides between `gate_awaiting` and `run_awaiting_input` is one field read off the
  row. `gate.requested` stays as the log's record that the Agent asked.

**Slice 3, as built.** The screens needed three things from the server that the plan had left to the page,
and each of them is the same argument: a rule the API enforces must not be re-implemented in a browser.
`gates.get` says where the Human reading it stands and why not, in the words `recordRuling` would refuse
them with; a Ruling carries the Socket it came through, so "via GitHub" needs no read of the Socket list,
which is an admin's alone; and `runs.list` says which Gate each Run waits at, in one query for the page.
`runs.list` also stopped refusing a Human who named nobody: a feed is a Workspace-wide question, and it
rides `(created_at, id)` rather than fanning out.

The Work item has no side peek and no keyboard row yet — `/work` opens a page rather than a panel. The peek
was the Issue page's shape, and what it framed is gone; whether a read-only record wants one is a question
for the screens that come after the providers.

The tool set is **seventeen**: `gates_request` is `runs_request_approval` come back, and `gates_get` beside
it is the polling half for a client that cannot take an elicitation, which is every client today. Asking
costs **17 statements** and ruling **17**, both a third of D1's cap.

- Whether a Proposal in a comment is enough for a Human to rule on from the tracker, or whether the Gate
  screen in deevy stays the place people actually decide. The mirror is built so the tracker is enough;
  the Event log's `via` column will say what people did.
- Whether one identity per Socket is what teams want, or whether the first request after GitHub is
  "planner should be `planner[bot]`". The deferred item is ready if so.
- Whether `gates`, `runs` and `off` are the right three settings for how much deevy says in a tracker, or
  whether a team wants deevy quiet on their issues and loud in Slack.
- Whether thirty minutes is the right catch-up interval for a Socket that has gone quiet, and whether the
  quiet is ever anything other than a tunnel that died.
- Whether a Project with no Checkpoints listed — the default — leaves an Agent asking for `plan` under a
  one-approval policy nobody chose, and whether the seed should list `plan` and `ship` so a new Workspace
  starts with the shape the instructions assume.
