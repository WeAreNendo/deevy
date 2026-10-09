# Hosted: Workspaces deevy runs for a team, on Cloudflare, in vertical slices

Planned with Matt on 2026-10-09. Vocabulary is [CONTEXT.md](../../CONTEXT.md); the decision is
[ADR-0028](../adr/0028-a-hosted-workspace-is-a-durable-object.md). It is done when a team that has never run
anything can ask for a Workspace at `app.deevy.dev`, sign in at `acme.deevy.dev` with the GitHub or Google
account it already has, connect its tools and its Agents as a self-hosted team does today, and take its
Workspace home to a self-hosted deployment whenever it likes; and when one deploy upgrades every hosted
Workspace, with no Cloudflare resource made, migrated or keyed per Workspace.

Why this and why now. deevy is AGPL and self-hosted, one Workspace per deployment, on Docker or on a Worker
with D1 ([ADR-0006](../adr/0006-runtime-agnostic-core-node-first.md)). Running it is small but it is not
nothing: an OAuth App per sign-in provider, a secret or two, a database to back up, a release to apply. A
team that wants Gates and Agents and not a deployment has no way in today, and the AGPL was chosen in
[ADR-0002](../adr/0002-agpl-3-license.md) precisely to keep a hosted offering possible. The open question was
never the product; it was how one platform holds many Workspaces' data, configuration and secrets, and
upgrades them all, without a person doing anything per Workspace.

The first audience is an invite-only free beta. Plans and payment are the next phase, designed below and
built after the beta has proved provisioning, upgrades and support.

## What is already there

- **One Workspace per database, by design.** `bootstrapWorkspace` (`packages/core/src/auth.ts`) creates the
  Workspace when `DEEVY_ADMIN_EMAIL` first signs in with an address its provider verified; `joinWorkspace`,
  `runDueWork` and invitations find it with `workspace.findFirst()`. Users, handles and Identities are
  unique per database. All of it is right as long as each Workspace keeps a database of its own — which is
  the shape this plan keeps.
- **A core that already runs where a Durable Object runs.** Web-standard APIs only (ADR-0006), no
  interactive transactions, no `db.batch`, no `$client`, no D1 run metadata — the core avoided all of them
  for D1's sake. Drizzle 1.0 rc.4, the pinned version, ships `drizzle-orm/durable-sqlite`, a driver of the
  same "sync" kind as the Node one, assignable to `Db`, with relations v2, `.returning()` and `db.query.*`.
  Better Auth's adapter runs without transactions. The D1 migration projection already refuses `PRAGMA`,
  `BEGIN`, `SAVEPOINT`, `ATTACH` and `VACUUM`, which is exactly what a Durable Object refuses.
- **Configuration that is already per Workspace in the database.** The allowlist, invitations, Sockets with
  their credentials sealed under `DEEVY_SECRET`, Channels, routing rules, Notification preferences and
  Settings › Email (which wins over the environment) all live in the Workspace's own rows. What stays in the
  environment is what a deployment is: its origin, its admin's address, its secrets, its sign-in providers.
- **Webhooks that name their Socket.** `POST /hooks/:socketId` finds the Socket by the id in the path, with no
  session and no host, so a tool's deliveries reach the right Workspace wherever it lives.
- **A Worker build, an acceptance walk and a smoke.** `web#build:workers`, `web#check:workers`, the seven
  phases of `web#test:workers` on `wrangler dev --local`, and `vp run agent#acceptance`, which takes a record
  through both deployments on every commit. A third shape joins them rather than replacing them.
- **Better Auth's `oAuthProxy`.** In 1.7.3 it is stateless on the relaying side: the relay exchanges the code
  with its own client secret, encrypts the profile and tokens, and hands them to the Workspace's
  `/callback/:id/oauth-proxy`, which signs the Human in against its own database. `admit()` runs (the user
  and session hooks fire through `handleOAuthUserInfo`), the `read:org` token arrives for `github_org` rules,
  Slack's id token arrives for [ADR-0027](../adr/0027-a-sign-in-vouches-inside-the-workspace-it-was-to.md),
  and `lastLoginMethod` still sets its cookie.
- **Email.** Cloudflare Email Service behind the `send_email` binding is one of the seven senders
  ([email-channel.md](./email-channel.md)), so hosted Workspaces have a platform sender from day one, and an
  admin can still set their own in Settings › Email.

## What is in the way

- **A deployment is one origin.** `BETTER_AUTH_URL` is the OAuth issuer, the MCP and API resources, the base
  of every Socket webhook URL and every link in a Notification; the CLI reduces whatever it is given to an
  origin; an Agent's `DEEVY_URL` points at it. A Workspace must have a host of its own — a path would not do.
- **Sign-in providers are per deployment.** Every provider's OAuth App holds one callback (GitHub's one, the
  others a short exact list). A platform cannot register a callback per Workspace, and must not ask a team to
  register OAuth Apps to sign in. The stock `oAuthProxy` does not relay `/link-social` (Settings ›
  Identities' "Link GitHub"), would proxy per-Workspace OIDC by mistake (`genericOAuth` starts through
  `/sign-in/social` in 1.7.3), and drops a provider configured with a client id alone (`configuredClient`).
- **Module-level caches assume one Workspace per isolate.** The Linear Socket caches app tokens by
  `${api}:${clientId}` (`packages/sockets/src/linear/index.ts:85`), without the secret: a Workspace that
  connects with another's public client id and any secret gets the other's token. GitHub's caches are keyed
  without the API base and are one refactor from the same hole. Many Workspaces in one isolate makes this
  routine, so it is fixed first.
- **The live stream keeps whatever serves it awake.** `events.subscribe` polls the database every second or
  two for as long as a tab is open. A Worker bills CPU and does not care; a Durable Object bills wall time
  while it is awake, so an always-open tab costs about $4 a month per Workspace. Hidden tabs must let go, and
  the stream must eventually be pushed rather than polled.
- **Releases assume a person.** A Worker deployment applies `wrangler d1 migrations apply` by hand, then
  deploys, and OPERATIONS.md allows a minor release to break in place. A platform that rolls a release out
  gradually, and may roll it back, runs the previous release's code on the new schema.
- **Workspaces on `*.deevy.dev` are same-site.** `SameSite=Lax` does not separate one Workspace from
  another, or from the console. Nothing but deevy's own code is ever served on a deevy.dev host, which is
  what makes it acceptable; the CSP, `frame-ancestors` and request-origin checks deevy lacks today are what
  make it safe.
- **There is no dump.** D1 has an export; a Durable Object has point-in-time recovery for 30 days and no
  export. Backups beyond 30 days, and a team's way home, need a logical dump deevy writes itself.
- **No source link.** The SPA does not say which version it is or where its source is. AGPL §13 asks that
  users of a network service be offered the source of what they use; a hosted offering should be beyond
  reproach on it.
- **A latent bug in the Worker's queue path.** With `JOBS` bound, `appendEvent` enqueues socket-mirror and
  chat-update deliveries as `webhook.delivery`; `claimDeliveries` (`work.ts`) does not filter by target and
  `sendClaimedWebhooks` retires them unsent. Found while mapping the Worker for this plan.

## Decisions taken with Matt, 2026-10-09

| Question                      | Decision                                                                                                                                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How Workspaces are isolated   | **One Worker serves every hosted Workspace; each Workspace's SQLite database is its own Durable Object, and the app runs inside it** (ADR-0028). One deploy reaches every Workspace; nothing on Cloudflare is created, migrated or keyed per Workspace.                      |
| What was refused              | Workers for Platforms with a Worker and a D1 per Workspace (a release is N uploads and N migration runs through an API limited to 1,200 requests per 5 minutes, and user Workers cannot have Cron); one shared D1; Postgres on a VPS behind Hyperdrive. See ADR-0028.        |
| Billing                       | **A free, invite-only beta first.** Plans, a trial, Stripe Checkout and its portal, and limits are the next phase.                                                                                                                                                           |
| Where the control plane lives | **A private repository** (`deevy-cloud`) holding the console, provisioning, deploys and later billing. It deploys only the artifact this repository releases and talks to it only over a service-binding RPC; it never imports `@deevy/*`, so the AGPL boundary stays clean. |
| Where data lives              | **The EU only.** Every Workspace object is created in the `eu` jurisdiction.                                                                                                                                                                                                 |
| Domains                       | Left to the plan; recommended below.                                                                                                                                                                                                                                         |
| The queue bug                 | Fixed as slice 0.                                                                                                                                                                                                                                                            |

Reconciled in writing this:

- **Postgres does not solve this.** deevy has no Postgres support (PLAN.md lists the adapter as later), and
  Hyperdrive is a connection pool: it decides nothing about tenancy. One shared Postgres means `workspace_id`
  on every row and every query, where one missed filter shows one team another's Gates; a database per
  Workspace there is the same fan-out as a D1 per Workspace; and a VPS is a server to patch, back up and keep
  up. A Durable Object per Workspace keeps SQLite, the schema and the migrations every deployment already
  has.
- **Workspaces stay on `deevy.dev`.** Matt wants the existing domain reused. A second registrable domain on
  the Public Suffix List would separate Workspaces at the browser's level; it is recorded in ADR-0028 as the
  road not taken, and slice 2 hardens for the shared one.
- **Slugs are immutable**, in v1 at least: a Workspace's origin is baked into OAuth issuers, MCP audiences,
  the webhook URLs inside a team's tools and its Agents' configuration. Renaming is a later feature that
  keeps the old host as an alias.
- **Secrets are derived, never stored.** A Workspace's two secrets come from a platform master secret and
  the object's immutable key. Storing generated secrets in the object would put the key beside the
  ciphertext it seals, and a derived secret can be handed to a team that leaves without exposing anybody
  else.

## The model

### Domains

| Host               | What                                                                                    | Served by                                |
| ------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------- |
| `deevy.dev`        | The public site: what deevy is, hosted or self-hosted, the waitlist                     | A static Worker (private repository)     |
| `docs.deevy.dev`   | The public docs                                                                         | `apps/docs`, a static Worker (this repo) |
| `app.deevy.dev`    | The console: ask for a Workspace, list yours, later billing                             | The console Worker (private repository)  |
| `auth.deevy.dev`   | The sign-in relay: every provider's OAuth App is registered once, with this host        | The hosted Worker                        |
| `<slug>.deevy.dev` | A hosted Workspace                                                                      | The hosted Worker                        |
| later, any host    | A team's own hostname, through Cloudflare for SaaS custom hostnames, the slug host kept | The hosted Worker                        |

Reserved slugs: `app`, `auth`, `docs`, `www`, `api`, `mail`, `status`, `admin`, `hooks`, `cdn`, `static`,
`assets`, `help`, `support`, `blog`, `deevy`, and whatever the console adds before it takes a name.

A first-level wildcard (`*.deevy.dev`) is covered by Universal SSL, a proxied wildcard DNS record and one
`*.deevy.dev/*` route; the apex, `docs` and `app` are Custom Domains of their own Workers.

### The hosted Worker (`apps/hosted`)

```
browser · CLI · Agent ──► *.deevy.dev ──► hosted Worker
                                           ├─ router: Host → directory (KV) → object key
                                           │    auth.deevy.dev → the relay
                                           ├─ WorkspaceObject — a SQLite Durable Object per Workspace, jurisdiction eu
                                           │    constructor: read its configuration, apply pending migrations in one transaction
                                           │    fetch: the app, built once by createApp — today's core
                                           │    alarm: runDueWork — in place of Cron and the JOBS queue
                                           └─ Platform — a WorkerEntrypoint reached only by service binding
                                                provision · status · configure · suspend · resume · dump · restore · destroy
console (app.deevy.dev) ──service binding──► Platform
```

- **The router** resolves the host through a directory the console writes (KV: host → object key), so an
  arbitrary subdomain is a 404 and never creates an object. It hands the request to
  `env.WORKSPACE.jurisdiction("eu").get(id)` and adds nothing to it.
- **A `WorkspaceObject`** reads its configuration from its own synchronous storage, applies pending
  migrations inside `blockConcurrencyWhile`, and builds the app the first time a request needs it (an alarm
  does not: it needs the database, the Sockets and the senders, not Better Auth). A failed migration is
  recorded and answered with a 503 that says so, never thrown, because a throw resets the object and repeats
  on every request.
- **The alarm** is the sweep: `runDueWork` with the limits the Node runner uses, then the next alarm. A job
  that would have gone on the queue sets the alarm to now instead, which is durable and retried.
- **`Platform`** is the only door the console has: `provision({ key, slug, name, adminEmail })`, `status()`
  (version, applied migrations, error, counts), `configure()`, `suspend()`, `resume()`, `dump()`,
  `restore(at)` and `destroy()`. It is never routed to a host.
- **The same artifact can serve several Workspaces for anybody.** It is open source, built by this
  repository, and a self-hoster running many Workspaces (an agency, a company with teams) can use it.

### Configuration, in three layers

1. **The platform's**, the same for every Workspace: the hosted Worker's variables and secrets, set by the
   private repository's deploy — the master secret, the relay secret, each provider's client id (and, for the
   relay, its secret), the domain, the Email Service binding and its From address, default limits.
2. **The Workspace's provisioned configuration**, set by the console through `Platform`: key, slug and
   origin, the Workspace's name, the admin's address, status, and later plan limits, a custom hostname and
   SSO. It lives in the object's own storage. The admin's address is today's `DEEVY_ADMIN_EMAIL`: the first
   verified sign-in with it becomes the admin through `bootstrapWorkspace`, unchanged.
3. **The Workspace's settings**, set by its admins, already in its database: the allowlist, Sockets,
   Channels, routing, Settings › Email. Unchanged.

### Secrets

Each Workspace's `BETTER_AUTH_SECRET` and `DEEVY_SECRET` are HKDF(platform master secret, the object's key,
`deevy:hosted:<purpose>:v1`). Nothing per Workspace is stored, a dump carries only what was already sealed,
a leaving team is handed its own two values with its export, and the version in the info string is how the
master rotates. Better Auth's `account.encryptOAuthTokens` is turned on, so a dump or Data Studio never shows
a provider's access token in the clear.

### Sign-in through the relay

`auth.deevy.dev` is the one callback every platform OAuth App knows. A Workspace's Better Auth runs the
client half of `oAuthProxy` for the platform's providers only and needs only their client ids; the relay
holds the client secrets, exchanges the code, and redirects to the Workspace with the encrypted profile —
but only to a host the directory knows. A Workspace's own OIDC provider, and GitLab on a team's own
instance, are never relayed: they use the Workspace's host directly, as a self-hosted deployment does.
"Link GitHub" in Settings › Identities goes through the relay too, linking to the signed-in Human.

### Live updates

Inside an object, the stream reads a local SQLite and costs almost no CPU, but an open stream keeps the
object awake and billed. In order: the SPA lets go of the stream when its tab is hidden and resumes from its
cursor (every deployment benefits); a stream in an object ends after minutes rather than living on; then,
for hosted Workspaces, a hibernatable WebSocket the object pushes to when an Event is appended — the "real
bus" [ADR-0012](../adr/0012-the-cron-port-stayed-node-s-and-a-stream-ends-itself.md) deferred.

### Data and operations

- **Migrations** are applied by drizzle's durable-sqlite migrator from a third committed projection of
  `packages/db/drizzle` (folder name → SQL), recorded by name in `__drizzle_migrations` as the Node migrator
  records them, so a dump opens under `openDatabase`.
- **Releases upgrade in place.** A migration adds in one release and removes in a later one, so the previous
  release still runs on the new schema during a gradual deploy and after a rollback.
- **Backups**: the 30-day point-in-time recovery Durable Objects keep, and a nightly logical dump into an R2
  bucket in the EU jurisdiction.
- **Leaving**: the same dump and `deevy import` into the Docker image, with the Workspace's two secrets.
- **Deleting**: `destroy()` (`deleteAll`, alarm included) after a 30-day grace period and a final dump, then
  the dumps and the directory entry.
- **The EU**: the objects' storage and execution are in the EU; the edge that terminates TLS and runs the
  router is global unless Regional Services (Enterprise) is bought. The data-location page says exactly that.

### Costs, roughly

A Workspace of five Humans and three Agents, on Workers Paid, per month: about $8 for 100 Workspaces and
$165 for 1,000, dominated by rows written — **once the live stream stops keeping objects awake**. Before
that, tabs open through working hours add about $120 for 100 Workspaces and $1,200 for 1,000. Workers for
Platforms with a D1 each comes to about the same once the stream is fixed ($26–30 and $185), so the choice
in ADR-0028 is about operations, not price.

## The spikes

Each on a throwaway branch, time-boxed, riskiest first. A spike's finding goes in "What it found" before the
slice it gates starts.

- **S1 — the app inside a Durable Object** (gates slices 5 and 7). `createApp` in a SQLite object under
  `wrangler dev`: heap per object, the first request after a wake (the app is rebuilt), isolate resets with
  ~300 synthetic Workspaces awake, Better Auth's AsyncLocalStorage across objects. If memory or wake latency
  do not fit, ADR-0028's fallback is taken and this plan is rewritten around Workers for Platforms.
- **S2 — the relay** (gates slice 6). Stock `oAuthProxy` on a test domain with real GitHub and Google apps:
  the Member is created through `admit()`, a `github_org` rule matches, Slack's id token is kept, OIDC is not
  proxied, `linkSocial` fails as predicted, and the relay runs without a database.
- **S3 — live updates and deploys** (gates slices 8 and 9). What an open stream really bills, a hibernatable
  WebSocket through oRPC 2's websocket adapter, and a gradual deploy that carries a migration: resets, the
  stream resuming, a rollback, the `status()` sweep.

## The slices

In this repository, each one pull request with its tests and, where an upgrader sees it, a changeset.

0. **The queue path sends only webhooks** (S). A failing test first in `packages/core/tests/queue.test.ts`:
   a socket-mirror or chat-update delivery named by a queue message is left for the sweep, not retired.
   Then the claim filters on the webhook target. Acceptance: with `JOBS` bound in `web#test:workers`, a
   tracker comment and a Slack update still go out.
1. **Socket caches keyed by their credential** (S). Linear's token cache keyed by a digest of the secret,
   GitHub's `tokens` and `installations` by the API base too. Acceptance: two registries in one module, one
   client id, two secrets, two tokens; a wrong secret is refused before any cache is read.
2. **Hardening for a shared domain** (M). A CSP with `frame-ancestors 'none'`, `nosniff` and a
   Referrer-Policy on both entries; cookie-authenticated mutations on `/rpc` and `/api` require
   `Sec-Fetch-Site: same-origin` (today they rely on CORS alone); session cookies locked to their host;
   `account.encryptOAuthTokens` with its migration for existing rows. Acceptance: a Gate page cannot be
   framed; a cross-site POST with a valid cookie is refused; a bearer-token client is unaffected.
3. **The source of the running version** (S). Settings says which version runs and links to its tag;
   `/healthz` says the version. Acceptance: the SPA test asserts the link.
4. **The durable migration projection** (S). `emit-d1-migrations.ts` also writes
   `packages/db/src/durable-migrations.ts`, and `db#check:migrations` diffs it. Acceptance: a fresh schema
   change regenerates all three projections, and a stale one fails CI.
5. **`@deevy/adapters/durable`** (M, after S1). `db.ts`, `migrate.ts` (one transaction, failure recorded),
   `jobs.ts` (`enqueue` sets the alarm) and `dump.ts` (a logical SQL dump from `sqlite_master`, skipping
   Cloudflare's `_cf_*` tables). The core's suites run again on the durable driver through a node-backed
   `SqlStorage` shim. Acceptance: the suites pass on it; raw `db.get` is banned in the core by a lint rule.
6. **Relayed sign-in** (M, after S2). `createAuth` gains a relay option with both halves: the client relays
   only the platform's providers, needs only their client ids, sends absolute callback and error URLs, and
   relays `/link-social` for the signed-in Human; the relay holds the secrets and redirects only to hosts it
   is told are Workspaces. `socialProvidersOf` is shared by both halves. ADR-0029, "A sign-in may be
   relayed". Acceptance: with the stub OAuth server, a sign-in and a link go Workspace → relay → provider →
   relay → Workspace; OIDC goes straight to the Workspace; a forged callback host is refused.
7. **`apps/hosted`** (L, after S1). The router, `WorkspaceObject`, `Platform`, derived secrets, an
   environment reader that refuses `DEEVY_DEV_STUB_*`, `wrangler.jsonc` with a SQLite class, the SPA from
   the `apps/web` build as its assets and the same `run_worker_first` list; `hosted#build`,
   `hosted#check:hosted` and `hosted#test:hosted`. ADR-0006 gains its third shape. Acceptance, on one
   `wrangler dev`: two Workspaces provisioned through `Platform`; a session, a Socket and an Event of one are
   invisible in the other; the relay signs a Human into each; an alarm sends a Gate reminder on an idle
   Workspace; a dump opens in the Docker image.
8. **Live updates in an object** (M, after S3). Hidden tabs let go; streams in an object end; then the
   hibernatable WebSocket for hosted Workspaces, amending ADR-0012. Acceptance: an object with a hidden tab
   hibernates; an Event appended reaches an open tab without a poll.
9. **Every release upgrades in place** (M). ADR-0030: migrations expand and later contract;
   `db#check:migrations` refuses a destructive statement unless it is annotated as a contraction whose
   expansion shipped; a smoke runs the previous tag's build on the new schema. Acceptance: that smoke on
   both Workers shapes in CI.
10. **Take your Workspace home** (M). `deevy import <dump>` for the Docker image; OPERATIONS.md's path to a
    self-hosted Worker. Acceptance: hosted → dump → Docker, sign in, every Socket still unseals.
11. **The release carries the hosted Worker** (M). The changesets release attaches
    `deevy-hosted-<version>.tar.gz` (bundle, SPA, `wrangler.json` template, manifest) with a build provenance
    attestation; CI builds and dry-runs it; the acceptance walk runs on the hosted shape as a third
    deployment.
12. **Beta guardrails** (S). Per-Workspace caps from provisioned configuration — invitations and emails a
    day, since the Email Service quota and its reputation are shared — and the counts `status()` reports.
13. **The docs site** (M). `apps/docs`, Starlight on Workers static assets at `docs.deevy.dev`: getting
    started (hosted and self-hosted), OPERATIONS.md split into pages, tool setup, the glossary from
    CONTEXT.md, the API reference from `packages/core/openapi.json`, the ADRs; plans stay in the repository.
    Links checked in CI; a deploy job on `main` with a scoped token in a protected environment.
14. **The record** (S). The hosted pages of the docs (data location and what is global, leaving, approving
    the OAuth App in a GitHub organization that restricts them, a GitHub App per Socket, the source link),
    OPERATIONS.md for the multi-Workspace Worker, "What it found" for each slice, PLAN.md's line moved to the
    past.

## The control plane (private repository)

Recorded here because the slices above are shaped by it; built in `deevy-cloud`.

- **C1 The account and the zone.** Workers Paid; `deevy.dev`'s records (apex, `www`, `docs`, `app`, `auth`,
  a proxied wildcard); the `*.deevy.dev/*` route and the Custom Domains, checking that a Custom Domain wins
  over the wildcard route; Email Service on a sending subdomain with SPF, DKIM and DMARC; an R2 bucket in the
  EU jurisdiction; the KV directory; one platform OAuth App per sign-in provider (Slack, Linear and
  Atlassian distributed publicly); a staging zone laid out the same.
- **C2 Deploys.** On a release: fetch the artifact, verify its attestation, render the private overlay
  (routes, bindings, secrets), `wrangler versions upload`, a gradual `versions deploy`, then `status()` on
  every Workspace, which migrates the ones asleep and records versions and errors. A rollback is the previous
  version.
- **C3 The console.** Sign-in through the relay; a registry in an EU D1 (people, beta invitations,
  Workspaces with their key, slug, owner, status and version), an audit log; asking for a Workspace (name,
  slug) calls `Platform.provision` and lands the person on their Workspace, where the first sign-in makes
  them its admin.
- **C4 Lifecycle.** Suspend and resume; delete with its grace period; an owner's export with their secrets;
  nightly dumps; restoring from point-in-time recovery.
- **C5 Operations.** Logs carrying the object's key, Analytics Engine points per request, alerts, a status
  page, and a written support policy: no impersonation, and a named list of who may use Data Studio.
- **C6 The site.** `deevy.dev`, static, with cookieless analytics — no third-party script on any deevy.dev
  host, ever.

## Conventions every slice follows

The definition of done every milestone has had: `vp check`, `vp run -r test`, `web#build:workers` and
`web#check:workers` green, a changeset for anything an upgrader sees, the OpenAPI and MCP snapshots
regenerated. From slice 7 on, `hosted#build`, `hosted#check:hosted` and `hosted#test:hosted` too. Nothing in
`packages/core` knows it is hosted: a difference is a parameter the entry passes, never a branch on the
deployment (ADR-0012's rule). No credential in any output, and the core never learns the word "billing".

## Deferred

- **Billing**, the next phase: Stripe Checkout, its portal and webhooks in the console; a plan becomes
  provisioned limits through `Platform.configure`, enforced by the core as Workspace limits (where PLAN.md's
  budgets meet it); a suspension is the router's.
- **A team's own hostname**, through Cloudflare for SaaS, the slug host kept for `/hooks` and as the issuer.
- **One deevy App per tool**: a public GitHub App, a distributed Slack app and a Linear application the
  platform verifies and routes by installation, team or organization, with a token broker so no Workspace
  holds an App's private key. Until then a hosted Workspace makes its own, as a self-hosted one does.
- **SSO set from the console**, **"your Workspaces" across memberships**, **importing a self-hosted
  Workspace**, renaming a slug, and a US jurisdiction if a team asks.

## Risks

- **Memory and wake cost per object.** Many Workspaces' apps share an isolate's 128 MB, and a woken object
  rebuilds its app. S1 measures both; the fallback is recorded in ADR-0028.
- **The live stream's bill.** Until slice 8, an always-open tab costs a Workspace about $4 a month. The beta
  is small enough to carry it; growth is not.
- **A cache that leaks between Workspaces.** Slice 1 fixes the two known; slice 7's isolation test is the net
  for the next one, and any module-level state in a Socket or a sender is reviewed as a cross-Workspace risk.
- **The relay is a key to every Workspace.** It holds the providers' secrets and the relay secret, both
  platform secrets in one Worker that runs nothing else of a team's. It redirects only to hosts the
  directory knows, and the payload lives 60 seconds.
- **Betas underneath.** Email Service sending and Data Studio are betas; SQLite Durable Objects, alarms,
  point-in-time recovery and jurisdictions are generally available.
- **Shared sender reputation.** One Workspace's invitations to strangers could hurt everybody's email.
  Slice 12's caps, and the confirmation every team address already needs.
- **The AGPL.** Hosted Workspaces run the released, unmodified artifact and say where its source is; the
  private repository never imports this one's packages. Not legal advice; checked with counsel before the
  first paid plan.

## What it found

Nothing yet.
