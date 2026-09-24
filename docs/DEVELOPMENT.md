# Developing deevy

## Prerequisites

- Node 24 (`.node-version`); Vite+ manages it for you once installed.
- [Vite+](https://viteplus.dev) 0.3.0: `curl -fsSL https://vite.plus | bash`, then open a new shell.
- A GitHub OAuth App or a Google OAuth client for sign-in (below), or neither and the stub (below that).

## First run

```bash
vp install
cp .env.example .env   # fill in the values described in the file
vp run --parallel dev
```

`vp run -r --parallel dev` starts two tasks: the Node server on `DEEVY_PORT` (3000 by default, and 3010 in the
launch configurations, because 3000 is a port everything wants; rebuilt and restarted by `vp pack --watch` on
every change) and the Vite dev server on http://localhost:5173, which serves the SPA and proxies `/api`,
`/rpc`, `/healthz`, `/mcp` and `/.well-known` to it. Open http://localhost:5173. The last two are there so an
MCP client can be pointed at the dev origin: discovery has to answer from the same origin as the endpoint it
describes, or a client looks for the authorization server in the wrong place.

**One port, both halves.** The proxy reads `DEEVY_PORT` too, so moving the server moves the proxy with it —
which is what a machine already running something on 3000, or a second checkout of deevy, needs.
`DEEVY_API_ORIGIN` overrides the target outright, for a server that is not on this machine. Neither is read
from `.env`: Vite's configuration is loaded before the server's environment file is, so set them in the shell
or in `.claude/launch.json`, which is where the 3010 comes from. A sign-in page with no buttons on it is what
this looks like when it is wrong — the page draws one button per provider `health.ping` reports, and a proxy
pointing at something that is not deevy answers nothing.

**A tool's deliveries come through the proxy too.** A Socket's address is `<BETTER_AUTH_URL>/hooks/<socket>`,
which in the dev loop is the SPA's origin, so `apps/web/vite.config.ts` forwards `/hooks` to the server with
the rest. A tool on the internet reaches a laptop only through a tunnel pointed at that origin
(docs/OPERATIONS.md, "Where a tool delivers"); without one, the catch-up poll is what brings records in.

**And the SPA's own port follows the launcher.** Both configurations in `.claude/launch.json` set
`autoPort`, so a busy 5173 does not stop the preview: the launcher picks a free port, hands it to the child
as `PORT`, and Vite's `server.port` reads it. `strictPort` is on, because the alternative is Vite quietly
moving to 5174 while `BETTER_AUTH_URL` still names 5173, which fails much later and somewhere else;
`dev:stub` builds that variable from the port it was actually given.

The SQLite file lives at `DEEVY_DATABASE_PATH` (default `./data/deevy.sqlite`, relative to `apps/server`) and
is created and migrated on start.

### A sign-in provider

A provider is configuration, not a constant (docs/plans/sign-in.md): what a deployment sets is what
`createAuth` registers, what `health.ping` reports, and what the sign-in page draws a button for. Set the
pairs you want offered and leave the rest empty. Half a pair is no provider — with only `GITHUB_CLIENT_ID`
set, GitHub is neither registered nor offered, and the page says this deployment has none configured rather
than offering a button that ends on GitHub's own error page.

**GitHub.** Create an OAuth App at https://github.com/settings/developers with:

- Homepage URL: `http://localhost:5173`
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`

Put the client id and secret in `.env` as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

**Google.** Create an OAuth 2.0 Client ID of type "Web application" in a Google Cloud project's Credentials
with:

- Authorized JavaScript origin: `http://localhost:5173`
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

Put the client id and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. deevy asks for the
default scopes and sets no `hd`, so Google decides nothing about who may join: a Google Workspace is an email
domain, and an `email_domain` allowlist rule is what admits it.

**GitLab.** Create an application under User settings › Applications on gitlab.com or on your own instance,
confidential, with:

- Redirect URI: `http://localhost:3000/api/auth/callback/gitlab`
- Scopes: `read_user` and `read_api`

Put the id and secret in `.env` as `GITLAB_CLIENT_ID` and `GITLAB_CLIENT_SECRET`. A self-hosted instance is
`GITLAB_ISSUER=https://gitlab.example.com`; unset, it is `https://gitlab.com`. Every GitLab endpoint deevy
calls is built from the issuer, so one entry serves either.

**OpenID Connect.** Anything that speaks OIDC — Okta, Entra, Keycloak, Authentik — is one entry, configured
from the issuer and nothing else:

- Redirect URI: `http://localhost:3000/api/auth/callback/oidc`
- Scopes: `openid`, `profile`, `email`
- Grant: authorization code with PKCE

Put the issuer in `.env` as `DEEVY_OIDC_ISSUER` — where the IdP publishes `/.well-known/openid-configuration`,
so `https://acme.okta.com` or a Keycloak realm URL with its path — and the client pair as
`DEEVY_OIDC_CLIENT_ID` and `DEEVY_OIDC_CLIENT_SECRET`. All three or none: the authorization, token, userinfo
and JWKS endpoints are read out of the discovery document, so an issuer is as load-bearing as a client id.
`DEEVY_OIDC_NAME` is what the button says, "Single sign-on" unset. The callback is `oidc` whatever the IdP is
called, because that is deevy's own name for the entry.

Either way, set `DEEVY_ADMIN_EMAIL` to the address that should become the Workspace admin: the first sign-in
with it creates the Workspace.

Anyone else who signs in joins as a Member when an allowlist rule matches them, and otherwise gets an account
and no Membership. The admin manages the rules under Settings, Allowlist. A `github_org` rule is matched by
listing the organizations the sign-in's token can see, which needs the `read:org` scope, and a `gitlab_group`
rule by listing its groups, which needs `read_api`: deevy requests both, so a client created before the slice
that added one asks for the extra scope the next time someone signs in. A group rule holds the full path —
`acme/platform`, and a subgroup is not its parent.

### Running without an OAuth App

Set `DEEVY_DEV_STUB_OAUTH=1` and the Node server imports `apps/web/scripts/stub-oauth.js` — the same stub the
acceptance walk and the Workers smoke prepend to their bundles — so every provider deevy offers answers
locally and the OAuth `code` is the email address. It stands in for the client pairs as well as the
endpoints: half a pair is no provider, so an environment that sets none — a fresh copy of `.env.example` —
would otherwise offer no button at all. A stubbed instance therefore offers all four, GitHub, Google, GitLab
and one generic OpenID Connect entry, and a pair the environment did set is left as it is. The signed-out
page then offers "Sign in as this email" beneath the provider buttons (it learns the flag from
`health.ping`); any address signs in, and the one in `DEEVY_ADMIN_EMAIL` becomes the admin exactly as it
would with a real OAuth App. `readEnv` refuses the flag under `NODE_ENV=production`, and the Worker never
has it.

The stub answers GitHub's and Google's endpoints by host, because Better Auth hardcodes them, and GitLab's
and a generic OIDC provider's by path, because those live wherever the operator's issuer is — never on a
loopback host, which is deevy itself. It generates an RS256 key pair on first use, serves the JWKS at
whichever certificate URL was asked for, and signs the `id_token` it hands back, so a provider that verifies
one against its issuer's keys is satisfied by keys the stub also published. An OpenID Connect sign-in also
binds that token to a nonce from the authorization request the form skips past, so the code carries it —
`ada@example.com|<nonce>` — and the stub signs it in.

`.claude/launch.json` carries a second configuration, `dev:stub`, which runs the same two dev tasks with the
flag on and `DEEVY_DATABASE_PATH=./data/stub.sqlite`, so a stubbed instance never shares a database with one you
sign in to for real. To fill that database:

```bash
DEEVY_DATABASE_PATH=./data/stub.sqlite vp run server#seed          # refuses a database with a Project in it
DEEVY_DATABASE_PATH=./data/stub.sqlite vp run server#seed -- --force  # removes the file first
```

The seed (`apps/server/src/seed.ts`, a second `vp pack` entry beside the server) signs the admin,
`grace@example.com` and `omar@example.com` in through the stub, connects a stub Socket, and creates the
Agents `Planner` and `Builder` with the admin as Sponsor, printing their keys once. Then two Projects bound
to that Socket, thirty-odd records projected from it, Runs in every status, Gates with Proposals — one open,
one ruled in deevy, one ruled `via: socket` — Links, a Slack Channel, routing and a webhook, all through the
operations, so the inbox and the Event log fill themselves. Point a runtime at the printed key
(`DEEVY_AGENT_KEY`) and it will find Planner's pending Runs.

`.claude/launch.json` has a third configuration, `seeded`, for when the `.env` of the checkout you are in
carries real addresses or a real client pair: it seeds `apps/server/data/seeded.sqlite` and serves the built
bundle and SPA on one port with a clean environment — nothing from `.env`, every identity at example.com, the
stubbed sign-in and the stubbed tracker both on. Build first (`vp run -r build`); it reseeds every time it
starts.

### Running without a GitHub App

`DEEVY_DEV_STUB_SOCKETS=1` registers the Socket provider that is not a tool
(`packages/sockets/src/stub`): a tracker and a forge deevy talks to exactly as it will talk to GitHub, in
this process, with no App, no tunnel and no network. Connect it under Settings, Sockets — it needs no
credential — bind a Project to one of its containers, and everything else works as it will in production:
deliveries at `/hooks/:socketId`, routing, Gates, mirrored comments, a checkout and a pull request.

What it holds is `DEEVY_DEV_STUB_CONTAINERS`, `name[=cloneUrl]` separated by commas — `acme/deevy`, or
`acme/deevy=/tmp/origin.git` for a container a Run can actually clone and push to. The default is one
container called `acme/deevy` with no repository. A store lives in the process deevy runs in, so this is the
only way to say what the tracker contains from outside it; that is also how the acceptance walk fills one
(`docs/sockets-acceptance.md`). `readEnv` refuses the flag under `NODE_ENV=production`, and `health.ping`
reports it as `devSockets` the way it reports `devSignIn`.

## Everyday commands

| Command                          | What it does                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `vp check`                       | Format, lint, and typecheck the whole tree (`--fix` to apply formatting).                                     |
| `vp run -r test`                 | Tests in every package (Vitest through Vite+).                                                                |
| `vp run -r build`                | `apps/server/dist/index.mjs` (bundled Node server) and `apps/web/dist` (SPA).                                 |
| `vp run web#build:workers`       | The Cloudflare Worker build (`DEEVY_TARGET=workers`); `vp run web#check:workers` then dry-runs what it wrote. |
| `vp run web#test:workers`        | Boots the built Worker on `wrangler dev --local` against a migrated local D1 and drives it over HTTP.         |
| `vp run db#generate`             | Generate a migration from `packages/db/src/schema` with drizzle-kit. Then run `vp run db#check:migrations`.   |
| `vp run db#generate:auth`        | Regenerate `packages/db/src/schema/auth.ts` from Better Auth's config. Needs the bootstrap step below.        |
| `vp run core#snapshot:openapi`   | Regenerate `packages/core/openapi.json`; CI fails when it is stale.                                           |
| `vp run core#snapshot:mcp-tools` | Regenerate `packages/core/mcp-tools.json`; CI fails when it is stale.                                         |
| `changeset add`                  | Declare what a change means for somebody upgrading; `--empty` when it means nothing.                          |
| `vp run version`                 | Consume the changesets into `CHANGELOG.md` and move the version. CI runs this; you almost never do.           |

The HTTP surface is documented at http://localhost:3000/api/docs while the server runs; the raw document is at
`/api/spec.json`.

## What a commit message says

Conventional commits, in the standard imperative, checked by `.husky/commit-msg` locally and by
`pull-request.yml` in CI (ADR-0017):

```
feat(gates): add ruling authority to Gate
fix(core): stop the sweep from reopening a ruled Gate
docs: explain what a changeset is for
chore(deps): move the Better Auth pin to 1.7.3
```

The type is one of `build chore ci docs feat fix perf refactor revert style test`. The scope is optional and
free-form — there is no enum, because the changelog is grouped by the packages a changeset names rather than
by what a subject line claims.

Two things the rules deliberately allow. The subject may carry the CONTEXT.md vocabulary's capitals
mid-sentence (`fix(core): a Run waiting on a Gate does not go stale`), because `subject-case` judges the whole
subject and a lowercase-initial one with a proper noun in it is fine. And **the body is unconstrained prose**,
unwrapped, as long as you like: `config-conventional` caps body lines at 100 characters by default and this
repository has always written 700-character paragraphs, so that rule is off.

**Merges here are squashed, so the pull request title is the commit message that lands on `main`.** The hook
is a courtesy you can skip with `git commit --no-verify`; the title check in CI is the one that decides what
the log looks like.

## When a change needs a changeset

A changeset is one file saying what a change means for **somebody upgrading deevy** — not what it means for
somebody reviewing the diff. That distinction is the whole value of the file, because the release notes are
nothing but these summaries stitched together.

```bash
changeset add           # pick the packages, pick major/minor/patch, write the summary
changeset add --empty   # a change no user can observe, declared as such
```

`pull-request.yml` fails a pull request that changes a package and carries neither. Docs, tests and CI are
already out of the question — `changedFilePatterns` in `.changeset/config.json` excludes them — so this fires
on real changes only. The `no-changelog` label is the last resort for the change that genuinely warrants no
entry at all.

Some notes on the mechanics, because they surprise people:

- **All seven packages share one version.** They are a `fixed` group, so naming one package in a changeset
  moves all of them. The number is the Docker image tag; there is no per-package release (ADR-0017).
- **`vp run version` needs a `GITHUB_TOKEN`** and fails without one, including locally. The changelog
  generator turns each changeset into a line that links its pull request and credits its author, and that is
  an API call. CI has the token; run this by hand only with one exported.
- **`changeset status --since=origin/main` reads changesets from git, not from disk.** Run it before
  committing and it reports no changeset even when the file is sitting there — it is only a false failure
  locally, because CI always runs it against a commit that contains the file.
- **The per-package `CHANGELOG.md` files are gitignored scratch.** `changeset version` writes them and
  `tools/release/scripts/fold-changelog.ts` folds them into the root `CHANGELOG.md`. They are left on disk on
  purpose — `changesets/action` reads them back — and stay out of the commit by being gitignored. Delete them
  by hand whenever you like; only the newest section of each is ever read.

## Cutting a release candidate

Changesets has a pre-release mode, and deevy's release path understands it: an rc publishes images under its
own tags, is marked as a prerelease on GitHub, and never moves `latest`.

```bash
changeset pre enter rc     # commit .changeset/pre.json through a pull request
```

From then on the flow is the one above and nothing about it changes: pull requests carry changesets, `main`
collects them into a Version PR, and merging that Version PR releases. The versions it produces are
`0.5.0-rc.0`, `0.5.0-rc.1`, and so on. When it is ready:

```bash
changeset pre exit         # commit the change to .changeset/pre.json the same way
```

The next Version PR then carries the final `0.5.0`, whose notes re-list **every** change since the line
opened, not only the ones since the last candidate. The root `CHANGELOG.md` drops the superseded
`0.5.0-rc.*` sections when that lands, because the final section already says all of it.

Three things worth knowing before you start, the first one quoted from
[the changesets documentation](https://github.com/changesets/changesets/blob/main/docs/prereleases.md):

- **"If you decide to do prereleases from the default branch without having a branch for your last stable
  release, you will block other changes until you exit prerelease mode."** That is true here: `changesets.yml`
  runs on `main`, so while pre mode is on, every merge to `main` goes into the rc line and there is no way to
  ship a stable patch without exiting first. For deevy that is usually what you want — an rc is a stabilising
  period — but if a hotfix has to go out mid-rc, exit, release the patch, and re-enter.
- **Changesets are not consumed while pre mode is on.** `changeset version` moves them into `.changeset/pre/`
  instead of deleting them, so that leaving pre mode can re-read every change into the final notes. The
  workflow's `find -maxdepth 1` depends on this and the comment there says so.
- **The npm-shaped caveats in those docs do not apply.** Dist tags, dependent packages falling outside a
  semver range, a new package landing on `latest` — none of it reaches a repository that publishes no
  packages and moves all seven versions together as a `fixed` group.

**Snapshot releases are deliberately not wired up.** They are npm's answer to "let me install this branch":
`changeset version --snapshot` writes a throwaway `0.0.0-tag-timestamp` and the documentation is explicit
that the commit must never be merged — which is the opposite of a flow built on merging a Version PR. deevy's
equivalent is an image tagged by commit, which needs no changesets at all.

## The two snapshots CI diffs

`packages/core/openapi.json` and `packages/core/mcp-tools.json` are generated files, committed, and
regenerated by CI, which then runs `git diff --exit-code` on each (ADR-0009). A change to an operation's
schema, its path, or its `mcp` flag that nobody re-snapshotted fails the build. Regenerate both and commit
them with the change:

```bash
vp run core#snapshot:openapi
vp run core#snapshot:mcp-tools
```

They answer different questions. `openapi.json` is the whole HTTP surface, every operation in the registry.
`mcp-tools.json` is the curated list an agent's context window has to hold: name, operation, summary,
`readOnly`, `agents`, and the input schema, for the operations that say `mcp: true`. Neither the `agents` nor
the `sessionOnly` flag touches the OpenAPI meta, so an authorization change shows up in the MCP snapshot and
in the tests, and never as noise in the HTTP one.

## What CI replays

`test` is a Vite+ task in each package's `vite.config.ts`, so `vp run … test` fingerprints it: the arguments,
the env vars it names, and every file the suite actually read, which Vite+ observes at the file system rather
than reads off a declared graph. A change to `packages/core/src` re-runs every suite that imports it, and
nothing else. Two tool-managed files are excluded, relative to each package: vitest's own results directory
(`node_modules/.vite/**`), which a fresh runner never has, and pnpm's install record
(`../../node_modules/.modules.yaml`), whose `prunedAt` and `storeDir` are the machine's. Until both were
excluded (2026-09-06) no shard ever replayed, and the cache steps in `ci.yml` cost time for nothing. On a pull request a suite
whose inputs match a cached run replays its recorded output; a push to `main` runs with `--no-cache`, so the
default branch always executes for real and is what seeds the cache the next pull request restores. Vite+
cannot see a test reading an env var, so a suite that depended on one is the case a replay would miss; deevy's
are stubbed and deterministic. To force a full run on a pull request, re-run the job after a change to any
`vite.config.ts`, or run `vp run -r --no-cache test` locally.

## Changing a Better Auth plugin

The options that shape Better Auth's tables live twice: `packages/core/src/auth.ts` is the runtime, and
`packages/db/auth.generate.config.ts` is what the generator reads. Change both, keeping them readable side by
side, and never hand-edit `packages/db/src/schema/auth.ts` — it is generated.

Regenerating is three commands rather than one, because of a chicken-and-egg problem in the adapter. Better
Auth's Drizzle adapter resolves every model and field a plugin declares against the schema object before it
will generate anything, and the `mcp` plugin queries its own `oauth_resource` table as it initialises. A
plugin's tables therefore cannot be generated while they do not yet exist. `packages/db/scripts/bootstrap-auth-schema.ts`
is how you get past it: it reads the shapes off the plugin itself and writes a throwaway
`packages/db/auth.bootstrap.ts` with stub table definitions plus the DDL to create them in the generator's
in-memory database. `auth.generate.config.ts` imports it through a variable, so the file is inert — and the
typechecker does not look for it — unless a regeneration is in progress.

```bash
cd packages/db
node scripts/bootstrap-auth-schema.ts   # writes auth.bootstrap.ts
vp run db#generate:auth                 # rewrites src/schema/auth.ts
rm auth.bootstrap.ts                    # never committed
```

Then the ordinary migration steps: `vp run db#generate`, hand-patch `NOT NULL` onto every `text PRIMARY KEY`
in the new `migration.sql` (a drizzle-kit rc regression), and `vp run db#check:migrations`.

## Layout

```
apps/web            React SPA; also the Cloudflare Worker entry (src/worker.ts) when DEEVY_TARGET=workers
apps/server         Node entry (Hono on @hono/node-server), bundled by vp pack; the seed; Dockerfile
apps/agent          the reference agent runtime, which talks to deevy as a stranger does
apps/cli            the command line, generated from the operation registry
packages/core       operation registry, oRPC router, Hono app factory, Better Auth factory, the Socket port
packages/sockets    one module per tool deevy speaks (github, linear, gitlab, notion, slack) and the stub
packages/db         Drizzle schema, relations, migrations
packages/adapters   node/ (node:sqlite, migrator, static assets, timer cron) and workers/ (D1)
tools/release       the changelog fold and the commit-message rules
```

Rules that keep the two deployment targets honest (ADR-0006): `packages/core`, `packages/db` and
`packages/sockets` never import Node modules; anything runtime-specific lives in `packages/adapters`. The core
imports the Socket port's types and never a provider: the two entries build the registry and hand it to
`createApp`. The Worker build in CI is what catches a
leak.

## Background work

Every piece of background work is a bounded function in `packages/core/src/work.ts` — one indexed SELECT with
a LIMIT, one batched UPDATE, never a query per row — and `runDueWork` there is all of them in order, the
whole of one trigger: stale Runs, Agents' schedules, Channel and webhook deliveries, Gate reminders, what the
tools are owed (mirrored comments, chat messages), the catch-up poll, and forgetting old inbound deliveries. Both deployments call it and neither owns it. Node satisfies the `Cron` port in
`packages/core/src/jobs.ts` with `createTimerCron()` from `@deevy/adapters/node`, and
`apps/server/src/runner.ts` starts that schedule beside `serve()`, drains while a pass says there is more, and
stops it on SIGINT and SIGTERM. Cloudflare owns its own schedule, so `apps/web/src/worker.ts` has a
`scheduled` handler instead of a `Cron`, and it asks for one tighter pass per trigger — which is why there is
no Workers cron adapter at all (ADR-0012). Neither lives inside `createApp`, which builds no timer and owns
no schedule.

| Variable                       | Default | What it does                                                                       |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------- |
| `DEEVY_RUN_STALE_MINUTES`      | 30      | Silence after which a Run goes `stale`. A later Activity revives it.               |
| `DEEVY_SWEEP_INTERVAL_SECONDS` | 60      | How often the runner looks for silent Runs. Node only; Workers has a Cron Trigger. |

## The MCP endpoint

`POST /mcp` is the third surface (ADR-0005), projected from the same operation registry as the HTTP API. It is
stateless, so there is nothing to keep warm between requests. To try it against the dev server, create an
Agent under Settings, Agents — which hands back its first key, once — grant it a Project, then:

```bash
claude mcp add --transport http deevy http://localhost:3000/mcp --header "Authorization: Bearer <the key>"
```

Which operations become tools is opt-in: `mcp: true` in the registry. `vp run core#snapshot:mcp-tools` writes
`packages/core/mcp-tools.json` and CI fails on a stale one, so the tool set an agent sees cannot drift without
review, and an oRPC bump that reshapes a schema shows up as a diff.

### As yourself, over OAuth

A Human's own client needs no header: deevy is the authorization server (ADR-0007, docs/OPERATIONS.md). It is
all built from `BETTER_AUTH_URL`, and everything in the dance has to happen on one origin, so in development
that has to name the Vite dev server rather than the Node server. The `dev:stub` launch configuration sets
`BETTER_AUTH_URL=http://localhost:${PORT:-5173}` itself, over whatever `.env` says — the port the launcher
picked, so `autoPort` and sign-in agree. With a real GitHub OAuth App, set
it in `.env` and move the App's callback URL to `http://localhost:5173/api/auth/callback/github` for as long
as it stays there.

The proxy sends `/api`, `/mcp` and `/.well-known` back to the Node server, and `/consent` — where the OAuth
provider sends the browser mid-authorization — resolves to the SPA route that serves it. Then, from a
directory that is not this repository, since the server lands in that directory's local Claude Code
configuration:

```bash
claude mcp add --transport http deevy http://localhost:5173/mcp
claude mcp login deevy
```

`login` opens a browser on deevy's consent page — one that is signed in to deevy, or sign in there first —
and Settings, MCP clients lists the client once you allow it. `claude mcp get deevy` then says `Connected`,
and a `claude -p` session run from that directory acts as you. This was walked on 2026-09-06 with Claude
Code 2.1.261; what it found, and why Better Auth 1.7.3 is the floor, is in OPERATIONS.md under "A Human's
own MCP client".

Left pointing at `http://localhost:3000`, the dance still runs but the consent page 404s: the Node server only
serves the SPA when `DEEVY_WEB_DIST` names a built one, which is how the Docker image runs it and not how
`vp run --parallel dev` does.

Unset `BETTER_AUTH_URL` and the OAuth server is simply not there — a resource identifier is an absolute URL
and there is nothing to build one from. Everything else, an Agent's API key included, works unchanged.

## The reference agent runtime

`apps/agent` is the service on the other side of the MCP endpoint, and it has its own
[README](../apps/agent/README.md) (docs/plans/m4.md). It is in the workspace so `vp check` and
`vp run -r test` cover it, and it may not import `packages/core` or take a `workspace:*` runtime dependency — it talks to deevy the way a stranger does, which is what makes its tests a
test of the surfaces rather than a second view of the same objects. A test asserts that.

Against the dev server:

```bash
vp run agent#build
```

```bash
DEEVY_URL=http://localhost:3000 DEEVY_AGENT_KEY=<the key> node apps/agent/dist/main.mjs --once
```

Create the Agent, grant it a Project and issue its key under Settings, Agents first. `--once` makes one pass
and exits; without it the loop stays up.

**Working on it without an Anthropic key.** Every test in the package runs against a real deevy — built
in-process, reached through the app's own fetch handler — with a _scripted session_: an async generator that
yields the four events the runtime reads and calls back into deevy exactly as the model would. That is the
seam the whole package hangs off, and it means the loop, the envelope, the Gate round trip and the delivery
are all testable for free. `tests/helpers.ts` has the harness.

One test does call the model, and it is skipped unless you ask for it:

```bash
DEEVY_AGENT_LIVE=1 vp run agent#test tests/live.test.ts
```

CI never sets it. A milestone whose suite needs a paid key is a milestone nobody runs twice.

## Docker

```bash
docker build -f apps/server/Dockerfile -t deevy .
docker run -p 3000:3000 -v deevy-data:/data --env-file .env -e BETTER_AUTH_URL=http://localhost:3000 deevy
```

The runtime stage is distroless and runs as uid 65532, so there is no shell in it to debug with and `/data`
has to belong to that user — a named volume created fresh does, a host directory you point at does not
(docs/OPERATIONS.md, "The volume"). To ask the built image whether it still does all of that:

```bash
vp run server#test:image                        # builds deevy:smoke if it is absent
DEEVY_IMAGE=deevy:ci vp run server#test:image   # one already built
```

## Pinned pre-release dependencies

Better Auth 1.7.2, Drizzle 1.0.0-rc.4, and oRPC 2.0.0-beta.32 are pinned exactly in `pnpm-workspace.yaml`
(see the comments there and ADR-0007, ADR-0008, ADR-0009). Upgrade a line on purpose, all of its packages
together, and re-run `vp run core#snapshot:openapi` and `vp run db#generate` to see what moved.
