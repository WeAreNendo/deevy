# Hosted: Workspaces deevy runs for a team, on Cloudflare, in vertical slices

Planned with Matt on 2026-10-09. Vocabulary is [CONTEXT.md](../../CONTEXT.md); the decision is
[ADR-0028](../adr/0028-a-hosted-workspace-is-a-durable-object.md). It is done when a team that has never run
anything can ask for a Workspace at `app.deevy.dev`, sign in at `app.deevy.dev/acme` with the GitHub or
Google account it already has, connect its tools and its Agents as a self-hosted team does today, and take
its Workspace home to a self-hosted deployment whenever it likes; and when one deploy upgrades every hosted
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
  environment is what a deployment is: its URL, its admin's address, its secrets, its sign-in providers.
- **Webhooks that name their Socket.** `POST /hooks/:socketId` finds the Socket by the id in the path, with no
  session, so a tool's deliveries reach the right Workspace wherever it lives.
- **Discovery that already speaks paths.** RFC 8414 and RFC 9728 insert the well-known segment after the
  host and keep the path, and deevy already answers `/.well-known/oauth-protected-resource/*` and
  `/.well-known/oauth-authorization-server/*` for its `/mcp` and `/api` resources
  (`packages/core/src/app.ts`). An issuer with a path is the same rule one segment longer.
- **Clients that mostly keep a path.** The SPA calls root-relative `/rpc` and `/api/auth` and routes with
  TanStack Router, which takes a `basepath`; the Agent runtime keeps whatever path `DEEVY_URL` has
  (`${url}/api…`, `${url}/mcp`). The CLI is the exception (below).
- **A Worker build, an acceptance walk and a smoke.** `web#build:workers`, `web#check:workers`, the seven
  phases of `web#test:workers` on `wrangler dev --local`, and `vp run agent#acceptance`, which takes a record
  through both deployments on every commit. A third shape joins them rather than replacing them.
- **Better Auth's `oAuthProxy`**, studied and refused for the relay (ADR-0030): its relay exchanges the
  code and passes the profile and tokens to the deevy, and its callback follows each deevy's base path. What
  it showed is that `admit()` runs on whatever path creates the user, which the relay deevy built instead
  keeps by letting each Workspace finish its own sign-in.
- **Email.** Cloudflare Email Service behind the `send_email` binding is one of the seven senders
  ([email-channel.md](./email-channel.md)), so hosted Workspaces have a platform sender from day one, and an
  admin can still set their own in Settings › Email.

## What is in the way

- **deevy assumes it sits at the root of its origin.** Its routes (`/api`, `/rpc`, `/mcp`, `/hooks`,
  `/healthz`, `/.well-known`), Better Auth's base path, the OAuth issuer, the session cookies (`Path=/`), the
  SPA's router and its index all start at `/`. A Workspace at `app.deevy.dev/acme` needs every one of them
  under `/acme`, with the issuer `https://app.deevy.dev/acme` and its metadata at
  `/.well-known/oauth-authorization-server/acme`.
- **The CLI keeps only the origin.** `originFrom` (`apps/cli/src/main.ts`) reduces whatever it is given to
  `new URL(...).origin`, credentials are stored per scheme and host, and login discovers
  `${origin}/.well-known/oauth-authorization-server`. Pointed at `app.deevy.dev/acme`, it would talk to no
  Workspace at all. It is published on npm, so the fix ships as a CLI release.
- **Every hosted Workspace shares one origin.** The browser separates origins, not paths: a script that runs
  in one Workspace's page can read and act in every other Workspace on `app.deevy.dev` the visitor is signed
  into, `Path` on a cookie notwithstanding. Every Workspace runs deevy's own code, so this is about bugs, not
  tenants' scripts — but an XSS through a tracker's title or a Proposal's markdown, contained to one
  subdomain, reaches every Workspace on one origin. deevy has no CSP today.
- **Cookies collide on one host.** Two Workspaces setting Better Auth's session cookie at `Path=/` on
  `app.deevy.dev` overwrite each other: signing in to one signs you out of the other.
- **Sign-in providers are per deployment.** Every provider's OAuth App holds one callback (GitHub accepts a
  subdirectory of it; Google, Microsoft and Atlassian want an exact list). A platform cannot register a
  callback per Workspace, and must not ask a team to register OAuth Apps to sign in. Better Auth's `oAuthProxy`
  does not relay `/link-social` (Settings › Identities' "Link GitHub"), would proxy per-Workspace OIDC by
  mistake (`genericOAuth` starts through `/sign-in/social` in 1.7.3), and drops a provider configured with a
  client id alone (`configuredClient`).
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
- **There is no dump.** D1 has an export; a Durable Object has point-in-time recovery for 30 days and no
  export. Backups beyond 30 days, and a team's way home, need a logical dump deevy writes itself.
- **No source link.** The SPA does not say which version it is or where its source is. AGPL §13 asks that
  users of a network service be offered the source of what they use; a hosted offering should be beyond
  reproach on it.
- **A latent bug in the Worker's queue path.** With `JOBS` bound, `appendEvent` enqueues socket-mirror and
  chat-update deliveries as `webhook.delivery`; `claimDeliveries` (`work.ts`) does not filter by target and
  `sendClaimedWebhooks` retires them unsent. Found while mapping the Worker for this plan.

## Decisions taken with Matt, 2026-10-09

| Question                      | Decision                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| How Workspaces are isolated   | **One Worker serves every hosted Workspace; each Workspace's SQLite database is its own Durable Object, and the app runs inside it** (ADR-0028). One deploy reaches every Workspace; nothing on Cloudflare is created, migrated or keyed per Workspace.                  |
| What was refused              | Workers for Platforms with a Worker and a D1 per Workspace (a release is N uploads and N migration runs through an API limited to 1,200 requests per 5 minutes, and user Workers cannot have Cron); one shared D1; Postgres on a VPS behind Hyperdrive. See ADR-0028.    |
| Where a Workspace lives       | **In the path, not a subdomain: `app.deevy.dev/acme/gates/…`**, the slug as the first segment, like `linear.app/acme`. The console has `app.deevy.dev/` and its own paths are reserved slugs.                                                                            |
| Signing in to two Workspaces  | **Per Workspace, with a quick switch.** Each Workspace keeps its own Members and sessions in its own database, as a self-hosted one does (ADR-0007 unchanged); switching goes through the relay, one redirect when the provider already knows you.                       |
| Billing                       | **A free, invite-only beta first.** Plans, a trial, Stripe Checkout and its portal, and limits are the next phase.                                                                                                                                                       |
| Where the control plane lives | **A private repository** (`deevy-cloud`) holding the console, provisioning, deploys and later billing. It deploys only the artifact this repository releases and talks to it only over a service binding; it never imports `@deevy/*`, so the AGPL boundary stays clean. |
| Where data lives              | **The EU only.** Every Workspace object is created in the `eu` jurisdiction.                                                                                                                                                                                             |
| The queue bug                 | Fixed as slice 0.                                                                                                                                                                                                                                                        |

Reconciled in writing this:

- **Postgres does not solve this.** deevy has no Postgres support (PLAN.md lists the adapter as later), and
  Hyperdrive is a connection pool: it decides nothing about tenancy. One shared Postgres means `workspace_id`
  on every row and every query, where one missed filter shows one team another's Gates; a database per
  Workspace there is the same fan-out as a D1 per Workspace; and a VPS is a server to patch, back up and keep
  up. A Durable Object per Workspace keeps SQLite, the schema and the migrations every deployment already
  has.
- **A path means one origin, so the CSP is not optional.** A subdomain per Workspace would have contained a
  script bug to its Workspace; Matt wants the path, as Linear and GitHub have it, and one origin is what
  that costs. Slice 2 makes deevy's pages refuse any script deevy did not ship, and audits every place a
  tool's text is rendered. The subdomain is recorded in ADR-0028 as the road not taken.
- **The base path is a deployment's URL, everywhere.** `BETTER_AUTH_URL` gains a path when it has one, and
  everything follows it: routes, issuer, cookies, the SPA, links. That is also what lets a self-hosted team
  serve deevy under `company.com/deevy`, and what lets a hosted team's own hostname serve its Workspace at
  the root later.
- **Slugs are immutable**, in v1 at least: a Workspace's path is baked into OAuth issuers, MCP audiences, the
  webhook URLs inside a team's tools and its Agents' configuration. Renaming is a later feature that keeps
  the old path as an alias.
- **Secrets are derived, never stored.** A Workspace's two secrets come from a platform master secret and
  the object's immutable key. Storing generated secrets in the object would put the key beside the
  ciphertext it seals, and a derived secret can be handed to a team that leaves without exposing anybody
  else.

## The model

### Hosts and paths

| URL                                   | What                                                                    | Served by                                |
| ------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| `deevy.dev`                           | The public site: what deevy is, hosted or self-hosted, the waitlist     | A static Worker (private repository)     |
| `docs.deevy.dev`                      | The public docs                                                         | `apps/docs`, a static Worker (this repo) |
| `app.deevy.dev/`                      | The console: your Workspaces, ask for one, later billing                | The console, behind the hosted Worker    |
| `app.deevy.dev/auth/…`                | The sign-in relay: every provider's OAuth App is registered once, here  | The hosted Worker                        |
| `app.deevy.dev/<slug>/…`              | A hosted Workspace                                                      | The hosted Worker                        |
| `app.deevy.dev/.well-known/…/<slug>…` | A Workspace's OAuth and MCP discovery, path inserted (RFC 8414, 9728)   | The hosted Worker                        |
| later, a team's host                  | Its Workspace at the root, through Cloudflare for SaaS custom hostnames | The hosted Worker                        |

`app.deevy.dev` is one Custom Domain of the hosted Worker; there is no wildcard record or route. The
hosted Worker owns the whole host and hands the console's paths to the console through a service binding,
so one router decides what a first segment is. Reserved slugs: the console's paths (`new`, `login`,
`signin`, `signup`, `settings`, `account`, `billing`, `workspaces`, `invite`…), `auth`, `api`, `rpc`, `mcp`,
`hooks`, `assets`, `static`, `healthz`, `docs`, `admin`, `status`, `help`, `support`, `www`, `deevy`, every
file the SPA ships at its root, and whatever the console adds before it takes a name.

### A deployment under a path

The base path is the path of `BETTER_AUTH_URL` (empty when it has none, as every deployment's has today):

- **Routes.** `createApp` mounts everything under it — `/acme/api`, `/acme/rpc`, `/acme/mcp`,
  `/acme/hooks/:socketId`, `/acme/healthz` — and Better Auth's base path is `/acme/api/auth`.
- **Discovery.** The issuer is `https://app.deevy.dev/acme`; its metadata is answered at
  `/.well-known/oauth-authorization-server/acme` and `/acme/.well-known/openid-configuration`, and the
  resources' at `/.well-known/oauth-protected-resource/acme/mcp` and `…/acme/api`. On hosted, the router
  sends a root well-known request to the Workspace its path names; a self-hosted operator serving under a
  path routes the same requests to deevy, and OPERATIONS.md says so.
- **Cookies.** Session and last-login cookies are scoped `Path=/acme` with no `Domain`, so two Workspaces'
  cookies never meet; the console's cookies carry another name.
- **The SPA.** Its assets stay at the root and are shared; the index is served with the base path in a
  `<meta>`, from which the router's `basepath`, the oRPC and auth clients, the live stream and local storage
  keys all derive.
- **Links.** Notifications, emails, Slack messages, Socket webhook URLs and the GitHub App manifest are
  already built from the deployment's URL and so carry the path.
- **The CLI** keeps the whole base URL, stores credentials per base URL, and discovers with path insertion:
  `deevy login https://app.deevy.dev/acme`.

### The hosted Worker (`apps/hosted`)

```
browser · CLI · Agent ──► app.deevy.dev ──► hosted Worker
                                             ├─ router: first path segment
                                             │    a reserved console path → the console (service binding)
                                             │    auth → the relay
                                             │    a slug → directory (KV) → that Workspace's object
                                             │    /.well-known/…/<slug>… → that Workspace's object
                                             ├─ WorkspaceObject — a SQLite Durable Object per Workspace, jurisdiction eu
                                             │    constructor: read its configuration, apply pending migrations in one transaction
                                             │    fetch: the app, built once by createApp under /<slug> — today's core
                                             │    alarm: runDueWork — in place of Cron and the JOBS queue
                                             └─ Platform — a WorkerEntrypoint reached only by service binding
                                                  provision · status · configure · suspend · resume · dump · restore · destroy
console (private) ◄──service binding──► hosted Worker
```

- **The router** reads the first path segment. A slug is looked up in a directory the console writes (KV:
  slug → object key), so an unknown one is a 404 and never creates an object; the request reaches
  `env.WORKSPACE.jurisdiction("eu").get(id)` unchanged, path and all.
- **A `WorkspaceObject`** reads its configuration from its own synchronous storage, applies pending
  migrations inside `blockConcurrencyWhile`, and builds the app the first time a request needs it (an alarm
  does not: it needs the database, the Sockets and the senders, not Better Auth). A failed migration is
  recorded and answered with a 503 that says so, never thrown, because a throw resets the object and repeats
  on every request.
- **The alarm** is the sweep: `runDueWork` with the limits the Node runner uses, then the next alarm. A job
  that would have gone on the queue sets the alarm to now instead, which is durable and retried.
- **`Platform`** is the only door the console has: `provision({ key, slug, name, adminEmail })`, `status()`
  (version, applied migrations, error, counts), `configure()`, `suspend()`, `resume()`, `dump()`,
  `restore(at)` and `destroy()`. It is never routed to a URL.
- **The same artifact can serve several Workspaces for anybody.** It is open source, built by this
  repository, and a self-hoster running many Workspaces (an agency, a company with teams) can use it, with
  or without a console behind it.

### Configuration, in three layers

1. **The platform's**, the same for every Workspace: the hosted Worker's variables and secrets, set by the
   private repository's deploy — the master secret, the relay secret, each provider's client id (and, for the
   relay, its secret), the host, the Email Service binding and its From address, default limits.
2. **The Workspace's provisioned configuration**, set by the console through `Platform`: key, slug (and so
   its URL), the Workspace's name, the admin's address, status, and later plan limits, a custom hostname and
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

### Signing in, and switching

`https://app.deevy.dev/auth/callback/<provider>` is the one callback every platform OAuth App knows. The
relay only redirects ([ADR-0030](../adr/0030-a-sign-in-may-be-relayed.md)): a Workspace names it as its
`redirect_uri` on both legs of a sign-in or a link and wraps its own `state` with where it lives, signed with
a secret it shares with the relay; the relay sends the browser back there — only to a Workspace the directory
knows — and the Workspace exchanges the code itself, with the platform's client secret every object of the
hosted Worker holds. The relay never sees a code it keeps or a token, and Better Auth's own state and cookie
checks decide whose sign-in it is. A Workspace's own OIDC provider, and GitLab on a team's own instance, are
never relayed. "Link GitHub" in Settings › Identities goes through the relay too.

Each Workspace is its own sign-in. The console lists the Workspaces you own; a switcher in a Workspace lists
the ones this browser holds a session for. Opening one you are not signed in to lands on its sign-in page
with your last provider first (`lastLoginMethod`), and a provider that already knows you makes that one
redirect. One account across Workspaces is deferred: it would move identity out of the Workspace's database.

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
- **Leaving**: the same dump and `deevy import` into the Docker image, with the Workspace's two secrets; the
  Workspace's URL changes to the team's own, so its Agents and its tools' webhooks are pointed at it.
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

- **S1 — the app inside a Durable Object** (gates slices 7 and 9). `createApp` in a SQLite object under
  `wrangler dev`: heap per object, the first request after a wake (the app is rebuilt), isolate resets with
  ~300 synthetic Workspaces awake, Better Auth's AsyncLocalStorage across objects. If memory or wake latency
  do not fit, ADR-0028's fallback is taken and this plan is rewritten around Workers for Platforms.
- **S2 — a Workspace under a path, and the relay** (gates slices 4, 5 and 8). The app and Better Auth under
  `/acme`: Better Auth's base path and a path issuer through the `jwt` and `mcp` plugins, deevy's own
  issuer and audience checks (`principal.ts`), path-scoped cookies, and real clients finding the Workspace —
  Claude Code, Cursor and VS Code over MCP, and a patched CLI. Then the relay on a test host with real GitHub
  and Google apps: the Member is created through `admit()`, a `github_org` rule matches, Slack's id token is
  kept, OIDC is not relayed, linking works. An MCP client that cannot find a path issuer is the finding that
  matters most.
- **S3 — live updates and deploys** (gates slices 10 and 11). What an open stream really bills, a
  hibernatable WebSocket through oRPC 2's websocket adapter, and a gradual deploy that carries a migration:
  resets, the stream resuming, a rollback, the `status()` sweep.

## The slices

In this repository, each one pull request with its tests and, where an upgrader sees it, a changeset.

0. **The queue path sends only webhooks** (S). A failing test first in `packages/core/tests/queue.test.ts`:
   a socket-mirror or chat-update delivery named by a queue message is left for the sweep, not retired.
   Then the claim filters on the webhook target. Acceptance: with `JOBS` bound in `web#test:workers`, a
   tracker comment and a Slack update still go out.
1. **Socket caches keyed by their credential** (S). Linear's token cache keyed by a digest of the secret,
   GitHub's `tokens` and `installations` by the API base too. Acceptance: two registries in one module, one
   client id, two secrets, two tokens; a wrong secret is refused before any cache is read.
2. **A page runs only deevy's script** (M). A strict CSP on both entries — `script-src 'self'` with no inline
   script and no `eval`, `frame-ancestors 'none'` (Gate buttons are clickjackable today), `object-src 'none'`,
   `base-uri 'none'` — plus `nosniff` and a Referrer-Policy; an audit of every place a tool's text or a
   Proposal's markdown is rendered; cookie-authenticated mutations on `/rpc` and `/api` require
   `Sec-Fetch-Site: same-origin` (today they rely on CORS alone); `account.encryptOAuthTokens` with its
   migration for existing rows. Acceptance: a Gate page cannot be framed; an injected inline script is
   refused by the browser in the SPA tests; a cross-site POST with a valid cookie is refused; a bearer-token
   client is unaffected.
3. **The source of the running version** (S). Settings says which version runs and links to its tag;
   `/healthz` says the version. Acceptance: the SPA test asserts the link.
4. **deevy under a path** (L, after S2). The base path from `BETTER_AUTH_URL` through `createApp`, Better
   Auth's base path, the path issuer and its path-inserted metadata, path-scoped cookies, the SPA's base
   from a `<meta>` in the index both entries serve, local storage keys, and every link. ADR-0029, "A
   deployment may live under a path". Acceptance: `web#test:workers` and the Docker smoke run a deployment
   at `/deevy`; the acceptance walk runs on one; an MCP client and the Agent runtime connect to it; a
   deployment with no path behaves exactly as before.
5. **The CLI keeps the path** (S, after S2). `originFrom` becomes a base URL, credentials are keyed by it,
   discovery inserts the path, and login, `api` and `spec.json` follow it. Released on npm. Acceptance: the
   CLI's tests log in to a deployment at `/deevy` and at the root, and old credentials still load.
6. **The durable migration projection** (S). `emit-d1-migrations.ts` also writes
   `packages/db/src/durable-migrations.ts`, and `db#check:migrations` diffs it. Acceptance: a fresh schema
   change regenerates all three projections, and a stale one fails CI.
7. **`@deevy/adapters/durable`** (M, after S1). `db.ts`, `migrate.ts` (one transaction, failure recorded),
   `jobs.ts` (`enqueue` sets the alarm) and `dump.ts` (a logical SQL dump from `sqlite_master`, skipping
   Cloudflare's `_cf_*` tables). The core's suites run again on the durable driver through a node-backed
   `SqlStorage` shim. Acceptance: the suites pass on it; raw `db.get` is banned in the core by a lint rule.
8. **Relayed sign-in** (M, after S2). `createAuth` gains a relay option: for the platform's providers only, a
   Workspace names the relay's callback on both legs and wraps its state with where it lives, signed; any
   deevy can be the relay (`/relay/callback/<provider>`), which checks the signature and an allowed list and
   redirects. ADR-0030, "A sign-in may be relayed". Acceptance: two Workspaces on one host share a GitHub App;
   a sign-in and a link go Workspace → provider → relay → Workspace, each keeping its own session; a code
   delivered to the other Workspace signs nobody in; OIDC is not relayed; a forged or disallowed state is
   refused.
9. **`apps/hosted`** (L, after S1, 4 and 8). The router, `WorkspaceObject`, `Platform`, derived secrets, an
   environment reader that refuses `DEEVY_DEV_STUB_*`, `wrangler.jsonc` with a SQLite class, the SPA from the
   `apps/web` build as its assets, an optional `CONSOLE` service binding; `hosted#build`,
   `hosted#check:hosted` and `hosted#test:hosted`. ADR-0006 gains its third shape. Acceptance, on one
   `wrangler dev`: two Workspaces provisioned through `Platform` at `/a` and `/b`; a session, a Socket and an
   Event of one are invisible in the other; signing in to `/b` leaves `/a` signed in; root well-known
   requests reach the Workspace they name; the relay signs a Human into each; an alarm sends a Gate reminder
   on an idle Workspace; a dump opens in the Docker image.
10. **Live updates in an object** (M, after S3). Hidden tabs let go; streams in an object end; then the
    hibernatable WebSocket for hosted Workspaces, amending ADR-0012. Acceptance: an object with a hidden tab
    hibernates; an Event appended reaches an open tab without a poll.
11. **Every release upgrades in place** (M). ADR-0031: migrations expand and later contract;
    `db#check:migrations` refuses a destructive statement unless it is annotated as a contraction whose
    expansion shipped; a smoke runs the previous tag's build on the new schema. Acceptance: that smoke on
    both Workers shapes in CI.
12. **Take your Workspace home** (M). `deevy import <dump>` for the Docker image; OPERATIONS.md's path to a
    self-hosted Worker, and to re-pointing Agents and tools' webhooks at the new URL. Acceptance: hosted →
    dump → Docker, sign in, every Socket still unseals.
13. **The release carries the hosted Worker** (M). The changesets release attaches
    `deevy-hosted-<version>.tar.gz` (bundle, SPA, `wrangler.json` template, manifest) with a build provenance
    attestation; CI builds and dry-runs it; the acceptance walk runs on the hosted shape as a third
    deployment.
14. **Beta guardrails** (S). Per-Workspace caps from provisioned configuration — invitations and emails a
    day, since the Email Service quota and its reputation are shared — and the counts `status()` reports.
15. **The docs site** (M). `apps/docs`, Starlight on Workers static assets at `docs.deevy.dev`: getting
    started (hosted and self-hosted), OPERATIONS.md split into pages, tool setup, the glossary from
    CONTEXT.md, the API reference from `packages/core/openapi.json`, the ADRs; plans stay in the repository.
    Links checked in CI; a deploy job on `main` with a scoped token in a protected environment.
16. **The record** (S). The hosted pages of the docs (data location and what is global, leaving, approving
    the OAuth App in a GitHub organization that restricts them, a GitHub App per Socket, the source link,
    pointing the CLI and an MCP client at a Workspace's URL), OPERATIONS.md for a deployment under a path and
    for the multi-Workspace Worker, "What it found" for each slice, PLAN.md's line moved to the past.

## The control plane (private repository)

Recorded here because the slices above are shaped by it; built in `deevy-cloud`.

- **C1 The account and the zone.** Workers Paid; `deevy.dev`'s records (apex, `www`, `docs`, `app`) and their
  Custom Domains; Email Service on a sending subdomain with SPF, DKIM and DMARC; an R2 bucket in the EU
  jurisdiction; the KV directory; one platform OAuth App per sign-in provider, its callback under
  `app.deevy.dev/auth/` (Slack, Linear and Atlassian distributed publicly); a staging host laid out the same.
- **C2 Deploys.** On a release: fetch the artifact, verify its attestation, render the private overlay
  (routes, bindings, the console's service binding, secrets), `wrangler versions upload`, a gradual
  `versions deploy`, then `status()` on every Workspace, which migrates the ones asleep and records versions
  and errors. A rollback is the previous version.
- **C3 The console.** At `app.deevy.dev/`, behind the hosted Worker: sign-in through the relay, under
  cookies of its own name; a registry in an EU D1 (people, beta invitations, Workspaces with their key, slug,
  owner, status and version), an audit log; asking for a Workspace (name, slug, checked against the reserved
  list) calls `Platform.provision` and lands the person on `app.deevy.dev/<slug>`, where the first sign-in
  makes them its admin; the list of the Workspaces you own.
- **C4 Lifecycle.** Suspend and resume; delete with its grace period; an owner's export with their secrets;
  nightly dumps; restoring from point-in-time recovery.
- **C5 Operations.** Logs carrying the object's key, Analytics Engine points per request, alerts, a status
  page, and a written support policy: no impersonation, and a named list of who may use Data Studio.
- **C6 The site.** `deevy.dev`, static, with cookieless analytics — and no third-party script on
  `app.deevy.dev`, ever.

## Conventions every slice follows

The definition of done every milestone has had: `vp check`, `vp run -r test`, `web#build:workers` and
`web#check:workers` green, a changeset for anything an upgrader sees, the OpenAPI and MCP snapshots
regenerated. From slice 4 on, a deployment under a path in the smokes; from slice 9 on, `hosted#build`,
`hosted#check:hosted` and `hosted#test:hosted` too. Nothing in `packages/core` knows it is hosted: a
difference is a parameter the entry passes, never a branch on the deployment (ADR-0012's rule). No
credential in any output, no inline script in any page, and the core never learns the word "billing".

## Deferred

- **Billing**, the next phase: Stripe Checkout, its portal and webhooks in the console; a plan becomes
  provisioned limits through `Platform.configure`, enforced by the core as Workspace limits (where PLAN.md's
  budgets meet it); a suspension is the router's.
- **One account across Workspaces**: sign in once and see every Workspace you belong to. It would move
  identity out of each Workspace's database into a platform service, amending ADR-0007.
- **A team's own hostname**, through Cloudflare for SaaS, serving its Workspace at the root while the
  `app.deevy.dev/<slug>` URL stays for `/hooks` and as the issuer.
- **One deevy App per tool**: a public GitHub App, a distributed Slack app and a Linear application the
  platform verifies and routes by installation, team or organization, with a token broker so no Workspace
  holds an App's private key. Until then a hosted Workspace makes its own, as a self-hosted one does.
- **SSO set from the console**, **importing a self-hosted Workspace**, renaming a slug, and a US
  jurisdiction if a team asks.

## Risks

- **One origin for every Workspace.** A script bug in any Workspace's page reaches every Workspace its
  visitor is signed into. Slice 2's CSP and audit are the defence, and a CSP violation report is a bug of
  the highest priority.
- **MCP clients and path issuers.** The current MCP authorization spec discovers path issuers, but a client
  that only looks at the root finds no Workspace. S2 tests the clients that matter; a gap there is fixed
  upstream or documented, never answered by guessing a Workspace at the root.
- **Memory and wake cost per object.** Many Workspaces' apps share an isolate's 128 MB, and a woken object
  rebuilds its app. S1 measures both; the fallback is recorded in ADR-0028.
- **The live stream's bill.** Until slice 10, an always-open tab costs a Workspace about $4 a month. The beta
  is small enough to carry it; growth is not.
- **A cache that leaks between Workspaces.** Slice 1 fixes the two known; slice 9's isolation test is the net
  for the next one, and any module-level state in a Socket or a sender is reviewed as a cross-Workspace risk.
- **The relay is a key to every Workspace.** It holds the providers' secrets and the relay secret, both
  platform secrets in one Worker that runs nothing else of a team's. It redirects only to Workspace URLs
  the directory knows, and the payload lives 60 seconds.
- **Betas underneath.** Email Service sending and Data Studio are betas; SQLite Durable Objects, alarms,
  point-in-time recovery and jurisdictions are generally available.
- **Shared sender reputation.** One Workspace's invitations to strangers could hurt everybody's email.
  Slice 14's caps, and the confirmation every team address already needs.
- **The AGPL.** Hosted Workspaces run the released, unmodified artifact and say where its source is; the
  private repository never imports this one's packages. Not legal advice; checked with counsel before the
  first paid plan.

## What it found

The slices were built on 2026-10-09, in parallel where they did not depend on each other: 0, 1, 2, 3 and 11
as pull requests of their own on `main`, and 6, 4, 5, 7, 8 and 9 as one stack.

**The spikes, as far as a machine with no account can take them.** S1's functional half is slice 9's smoke:
the app runs in a SQLite Durable Object on workerd, two Workspaces side by side, with every core suite
passing again on the durable driver. Measured on workerd with 300 Workspaces on one `wrangler dev`: a
Workspace is provisioned, every migration included, in about 120 ms; an object put away after 20 seconds
idle (every sampled one was constructed again) answers its first request, app built, in 4 to 5 ms at the
median and 17 ms at p95, against 2 ms once built; and the process grows by about 0.4 MB for each awake
Workspace's app, and by at most 3 MB for each Workspace provisioned, its SQLite included. Locally every
object shares one process, so those are upper bounds; the same on Cloudflare's own isolates, under their
128 MB, still needs a real account. S2's server half held without a change to Better Auth: its OAuth provider
already answers a path issuer at `/.well-known/oauth-authorization-server/<path>` and at the appended form,
and the full authorization-code flow, the MCP challenge and token audiences work under `/acme` (slice 4's
tests). Then a real Claude Code (2.1.282) against a deevy served under `/deevy`: it found the path issuer on its own,
from the challenge's resource metadata, and asked `…/deevy/api/auth/oauth2/authorize` for `…/deevy/mcp` with its
Client ID Metadata Document; the walk found that every consent had failed its signature since the UI redesign,
on any deployment — the router kept one value of a repeated query key, and Better Auth repeats `ba_param` —
fixed in #152, after which the login completed and the client connected. Then the MCP SDK's own client
(`@modelcontextprotocol/sdk` 1.30), which registers itself rather than naming a metadata document: it found
`/.well-known/oauth-protected-resource/deevy/mcp` and `/.well-known/oauth-authorization-server/deevy` by
itself, and once registered, signed in, consented and listed the 14 tools. The walk found two bugs on any
deployment. A registration that does not state `application_type` was a web client, refused any loopback
callback, which turned away VS Code, the Inspector and every SDK client (#154); and a Human signed out of
deevy landed at home after signing in, the client still waiting, because nothing carried the authorization
through the sign-in (#155). Better Auth also refuses a private-use scheme that is not a reverse-domain name
without an authority (RFC 8252 §7.1), so a client calling back on `cursor://host/…` cannot register at all;
Cursor itself, VS Code's own window and real provider Apps through the relay are still to be walked. S3's
local half is slice 10's smoke, where an object holding a tab's socket is put away and wakes for the next
Event; what an open stream bills, and a gradual deploy with a migration, wait for an account.

- **Slice 0, The queue path sends only webhooks** (#135). The claim now names its target, so a stray id can never
  retire another arm's row, and `appendEvent` queues only webhooks. Email and Slack-room deliveries were
  never affected; they were never queued.
- **Slice 1, Socket caches keyed by their credential** (#134). Linear's and GitHub's token caches are keyed by the
  API base, the client or App id, and a digest of the secret or private key. No other cache in the Sockets or
  the senders had the shape.
- **Slice 2, A page runs only deevy's script** (#142). The audit found one real hole: `links.add` took `javascript:`
  URLs, drawn as links on a Gate and a record; it takes http and https only now, and every link the SPA
  builds from a tool's or an Agent's data skips anything else. `/mcp` accepted a browser's session cookie;
  it takes bearer tokens only. Inline styles stay allowed, because three of the UI's libraries write
  `<style>` as they run; scripts are locked to deevy's own. Better Auth's decrypt throws on an unencrypted
  token, so deevy's own reads accept both until a row is written again. `/api/docs` still loads its reference
  UI from a CDN, now pinned to a version (`@scalar/api-reference@1.72.0`). CI then found that a refused
  cross-site write answered before its body was read broke the next request on that connection under
  workerd on Linux; the refusal reads the body first.
- **Slice 3, The source of the running version** (#136). `health.ping` and `/healthz` say the version; Settings
  links to `v<version>` on GitHub.
- **Slice 4, deevy under a path** (#138). Better Auth routes on the path of its own URL and keeps a URL that has one
  as given, so it is handed `…/acme/api/auth` outright; Hono's `basePath` shares its router, so the app
  mounts under the path with discovery at the root of the host beside it. The SPA is built once, relative to
  a `<base href>` the server writes; `lib/base.ts` is the one place it is read. The acceptance walk runs a
  third time under `/deevy` and leaves the same Event log.
- **Slice 5, The CLI keeps the path** (#140). Login checks the discovered document's issuer, which it used to skip:
  a deevy reached by another name than its own now says which URL to log in to.
- **Slice 6, The durable migration projection** (#137). Both migrators journal by folder name and decide what is
  pending by name alone, so a database migrated in a Durable Object opens under the Node migrator with
  nothing to apply.
- **Slice 7, `@deevy/adapters/durable`** (#143). Every core suite passed on the durable driver with no change to the
  core. drizzle's durable migrator answers any failure with a bare "Rollback", so the adapter watches each
  statement to name the migration and SQLite's message. The dump writes values with SQLite's `quote()`,
  because a Durable Object reads an integer past 2^53 back rounded, and restores `sqlite_sequence`, or a
  restored Workspace could hand out an Event's `seq` twice.
- **Slice 8, Relayed sign-in** (#144). Built as a redirector rather than on `oAuthProxy`, whose callback follows each
  Workspace's base path (which Google's exact match refuses) and whose relay holds the tokens; ADR-0030.
  Better Auth normalises `options.baseURL`, so the Workspace's own URL is handed to the plugin rather than
  read back. The development sign-in now follows the authorization URL's `redirect_uri`, as a provider would.
- **Slice 9, `apps/hosted`** (#145). workerd does not implement jurisdictions, so the smoke runs without `eu`. RPC
  types an empty tuple as `never[]`. The assets binding needs the single-page fallback even though the router
  serves the SPA, because a deep route is asked of the binding by the inner path.
- **Slice 10, Live updates in an object** (#150). A hibernatable WebSocket that says only the newest seq;
  the tab reads the Events under its own session, so nothing about who may see what is said twice. oRPC 2's
  websocket adapter was set aside: its subscription is a generator held in memory, which keeps an object
  awake. A push reaches an open tab in about 60 ms on workerd, and the object sleeps with the tab open
  between Events. Found on the way: an alarm that fired while a Workspace was suspended set no next one, so
  a resumed Workspace never swept again; resuming sets it now. ADR-0032.
- **Slice 11, Every release upgrades in place** (#141). The Node migrator already tolerates migrations it does not
  know, and now names them at startup. A `-- deevy: contract` comment above drizzle's table rebuild could
  have hidden its PRAGMA from the D1 projection's refusal; the projection reads past leading comments now.
- **Slice 12, Take your Workspace home** (#149). `dist/import.mjs` loads a dump into the image and refuses
  any database that already holds something; `--for-d1` writes what a self-hosted Worker's D1 takes, with
  wrangler's own journal, under `defer_foreign_keys`, every statement within D1's size limit. The only data
  bound to a deevy's URL is OAuth's: the import drops the old resources and tokens, and says what else to
  point at the new address, tool by tool.
- **Slice 13, The release carries the hosted Worker** (#148). The archive is written by a small ustar writer,
  sorted and dated by the commit, so two builds of one commit are the same bytes. wrangler uploaded the SPA's
  `index.html` as a module until `find_additional_modules` was turned off. The acceptance walk runs a record
  through a hosted Workspace as a fourth deployment; its sign-in follows the authorization's `redirect_uri`.
- **Slice 14, Beta guardrails** (#147). The core's `limits` is configuration, absent on the image and the
  Worker; past a day's invitations the next is a 429 that says when, and owed emails wait in their rows
  rather than fail. An email an admin sends on the spot — a confirmation, a test — is not counted yet.
- **Slice 16, The record** (#151). OPERATIONS.md says what a hosted Workspace is to the team that has one,
  which the docs site publishes as a page.
- **Slice 15, The docs site** (#146). Starlight on Workers static assets, generated from the repository's own
  Markdown at build time — OPERATIONS.md split at its sections, DEVELOPMENT, harnesses, the glossary, every
  ADR — and an API reference from the OpenAPI snapshot, grouped by area since it carries no tags. The link
  validator fails the build on a broken internal link. Astro is pinned below the release that needs a newer
  Vite than the workspace's, and its own CSP is off, because it blocked the search's inline script. The
  deploy waits for the account: it finishes green with a notice until the `docs` environment has a token.
- **The control plane** (WeAreNendo/deevy-cloud, private). C3 and C4 are the console (#1): a React SPA and its
  API behind the hosted Worker's `CONSOLE` binding, signing in through the same relay with its state wrapping
  reimplemented from ADR-0030 and pinned to an envelope deevy's own code produced; an invite-only beta gate
  that keeps nothing about whoever it turns away; slugs never reused; export, delete with its grace, restore,
  nightly dumps to R2 and the deletions' finish on crons. It was run beside the released archive under
  `wrangler dev`, over real RPC. C1, C2, C5's runbook and C6 are #2: SETUP.md for the account once, a deploy
  that verifies the attested archive, fills its blanks from the manifest, refuses a missing secret, rolls out
  gradually and touches every Workspace before going to 100%; the first deploy has to go hosted Worker,
  console, hosted Worker again, because a service binding cannot name a Worker that does not exist yet; and
  the deevy.dev site with its waitlist, which works without JavaScript too.
- **Metering** (#153). One Workers Analytics Engine data point per request, by Workspace, with nothing
  personal in it; what a console shows and a plan will be billed by.
