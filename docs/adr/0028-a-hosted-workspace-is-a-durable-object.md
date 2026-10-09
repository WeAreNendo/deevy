# A hosted Workspace is a Durable Object

Amends [ADR-0006](./0006-runtime-agnostic-core-node-first.md), which gave deevy two deployment shapes —
Node with SQLite in Docker, and a Worker with D1 — each serving one Workspace, by adding a third shape that
serves many. Planned in [hosted.md](../plans/hosted.md).

deevy is to be offered hosted as well as self-hosted ([ADR-0002](./0002-agpl-3-license.md) kept that door
open): a team asks for a Workspace at `app.deevy.dev` and uses it at `<slug>.deevy.dev` without running
anything. Every part of deevy assumes one Workspace per database — `bootstrapWorkspace`, `workspace.findFirst()`,
users and handles unique per database — and every deployment is configured by its environment. The question
is how one platform on Cloudflare holds many Workspaces' data, configuration and secrets, and upgrades all of
them, without a person doing anything per Workspace.

## The decision

**One Worker serves every hosted Workspace, and each Workspace's SQLite database is its own Durable Object,
which runs the app.** A router maps the host to the Workspace's object; the object applies its pending
migrations when it wakes, builds the app with `createApp` the first time a request needs it, and runs the
sweep from its alarm. Its configuration — origin, name, the admin's address, status — lives in its own
storage, set by the control plane through an RPC entrypoint no host routes to. Its secrets are derived from
a platform secret and the object's immutable key, and never stored. Every object is created in the `eu`
jurisdiction.

The core does not change to be correct. Drizzle's `durable-sqlite` driver, in the pinned rc, is of the same
synchronous kind as the Node driver; the core already does without transactions, `db.batch` and D1's run
metadata; and one Workspace per database stays true. The new code is an adapter (`@deevy/adapters/durable`)
and an entry (`apps/hosted`), both in this repository and released with it, so a hosted Workspace runs
exactly what anybody can read and run.

## Why not the alternatives

**Workers for Platforms, with a Worker and a D1 per Workspace.** Closest to today: each Workspace would run
the self-hosted Worker unchanged, configured by its own variables and secrets. Refused for its operations:
every release is an upload and a migration run per Workspace through Cloudflare's API, at 1,200 requests per
5 minutes; every Workspace is a script, a database and a set of secrets to create, rotate and delete; user
Workers cannot have Cron Triggers, so a platform clock would be needed anyway; and they cannot be deployed
gradually. It stays the fallback if a Workspace's app does not fit a Durable Object (memory, wake latency),
which the plan's first spike measures.

**One shared D1 with a `workspace_id` on every row.** One database and one migration per release, bought
with a refactor of everything ADR-0007 assumed — users, handles and Identities are unique per database —
and a filter every query must remember, where one forgotten shows one team another's Gates. And one D1 is
10 GB for everybody. Refused.

**Postgres on a server of our own, behind Hyperdrive.** Hyperdrive is a connection pool and decides nothing
about tenancy: it would be the shared-database refactor above, plus a second SQL dialect beside the SQLite
every self-hosted deployment keeps, plus a server to patch, back up and keep up. deevy has no Postgres
support yet (PLAN.md lists it as later). Refused.

**Workspaces on a registrable domain of their own, on the Public Suffix List.** It would make every
Workspace its own site to the browser, so no cookie or `SameSite` rule could cross between them. Refused for
now because Matt wants `deevy.dev` reused, and because nothing but deevy's own code is served on any
deevy.dev host: the plan's hardening slice (a CSP with `frame-ancestors`, same-origin checks on
cookie-authenticated writes, host-locked cookies, no third-party script on any deevy.dev host) is what makes
sharing the domain safe. A Workspace's origin is baked into OAuth issuers, MCP audiences and webhook URLs, so
this is the choice hardest to undo; it is written down here so it is undone on purpose if ever.

## The cost, stated

- **A third shape to keep.** The core's suites run again on the durable driver, and the acceptance walk runs
  on three deployments instead of two.
- **An app per object in a shared isolate.** Many Workspaces share 128 MB, and a woken object rebuilds its
  app. Module-level state becomes cross-Workspace state: the Linear Socket's token cache, keyed without its
  secret, is a leak between Workspaces here and is fixed before anything is hosted.
- **Wall time is billed.** A Durable Object bills while it is awake, and today's live stream keeps it awake
  as long as a tab is open. Hidden tabs let go, and the stream becomes a hibernatable WebSocket the object
  pushes to — the bus ADR-0012 deferred.
- **No export.** A Durable Object keeps 30 days of point-in-time recovery and offers no dump; deevy writes a
  logical dump itself, for backups and for a team going home to a self-hosted deployment.
- **Releases must upgrade in place.** A gradual deploy, and a rollback, run the previous release's code on
  the new schema, so a migration adds in one release and removes in a later one.
- **The EU, mostly.** The objects' storage and execution are in the EU; the edge that terminates TLS and
  routes is global unless Regional Services is bought.
