# Running deevy

deevy is one container and one volume. A self-hosted instance serves one Workspace (CONTEXT.md), so there is
no tenancy to configure: the first sign-in with `DEEVY_ADMIN_EMAIL` creates the Workspace and becomes its
admin, and everyone else joins through the allowlist or an invitation.

## The image

Published to `ghcr.io/WeAreNendo/deevy` on every `v*` tag, for `linux/amd64` and `linux/arm64`. Tags are the
version (`v0.4.0`) and `latest`. The image carries the bundled Node server, the migrations, and the built SPA;
it runs the SPA and the API on one port, so there is no separate web container.

It is built on Google's distroless Node base and carries nothing else: no shell, no package manager, no
`apt`, no `curl`. There is no `docker exec ... sh` to be had, which is the point — anything that gets into
the container finds no tools there. Work that needs a shell is done from a sidecar against the same volume,
the way [Backup and restore](#backup-and-restore) does it. It runs as uid **65532**, so everything under
`/data` has to belong to that user; see [The volume](#the-volume) and [Upgrading](#upgrading).

The image also carries its own healthcheck, so `docker ps` shows `healthy` and Compose's
`depends_on: condition: service_healthy` works with nothing configured.

The reference runtime is `ghcr.io/WeAreNendo/deevy-agent`, one image per harness
([docs/harnesses.md](./harnesses.md)): `deevy-agent:claude-code`, `deevy-agent:opencode`,
`deevy-agent:cursor` and `deevy-agent:copilot`, each also tagged `<version>-<harness>`. `deevy-agent:latest`
and the bare version tags are Claude Code.

**Both packages are public**, so pulling either needs no account and no `docker login`. A package's
visibility is set on the package rather than inherited from the repository, so if that ever changes the
symptom is a `docker pull` failing with an unexplained `unauthorized`; what a stranger gets can be checked
directly, with no account:

```bash
img=deevy   # or deevy-agent
token=$(curl -s "https://ghcr.io/token?scope=repository:WeAreNendo/$img:pull" | jq -r .token)
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $token" \
  -H 'Accept: application/vnd.oci.image.index.v1+json' \
  "https://ghcr.io/v2/WeAreNendo/$img/manifests/latest"   # 200 public, 403 private
```

Building from source needs no account either way and produces the same image — the release workflow runs
exactly this command:

```bash
docker build -f apps/server/Dockerfile -t deevy:local .
```

Then, with either image:

```bash
docker run -d --name deevy -p 3000:3000 -v deevy-data:/data \
  -e BETTER_AUTH_URL=https://deevy.example.com \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e GITHUB_CLIENT_ID=... -e GITHUB_CLIENT_SECRET=... \
  -e GITLAB_CLIENT_ID=... -e GITLAB_CLIENT_SECRET=... \
  -e GOOGLE_CLIENT_ID=... -e GOOGLE_CLIENT_SECRET=... \
  -e DEEVY_ADMIN_EMAIL=you@example.com \
  deevy:local   # or ghcr.io/WeAreNendo/deevy:latest
```

## Cutting a release

Releases are made by merging, not by tagging (ADR-0017). Every pull request that changes a package carries a
changeset; `changesets.yml` collects them on `main` into a **"Version Packages"** pull request holding the
version bump and the folded `CHANGELOG.md`. Merging that pull request is the release:

1. `changesets.yml` runs again, finds no changesets waiting, and sees a version in `package.json` whose tag
   does not exist yet.
2. It pushes `vX.Y.Z` and writes the GitHub Release from that version's `CHANGELOG.md` section.
3. It calls `release.yml`, which re-runs the whole of CI and then pushes both images.

The tag is pushed for the record and for the image tags; it does **not** drive step 3, because a tag pushed
with `GITHUB_TOKEN` triggers no workflow. Nothing about an ordinary commit on `main` releases anything — the
existing tag is the guard.

Two things this needs on the repository, both one-time and both failing at release rather than on a pull
request, which is the worst place to find out:

- **Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests."** Without it
  `changesets/action` cannot open the Version PR.
- **A `no-changelog` label**, for the pull request that genuinely warrants no changelog entry.

**A release candidate** goes out the same way, with `changeset pre enter rc` committed first: the images are
tagged `0.5.0-rc.0` and `v0.5.0-rc.0`, `latest` is left where it is, and the GitHub Release is marked as a
prerelease. `changeset pre exit` ends the line and the next Version PR carries the final version. While pre
mode is on, everything merged to `main` goes into the rc line — see
[DEVELOPMENT.md](./DEVELOPMENT.md#cutting-a-release-candidate).

**The images are built natively, one runner per architecture.** `linux/amd64` on `ubuntu-latest` and
`linux/arm64` on `ubuntu-24.04-arm`, each pushing an untagged image addressed by digest, with a final job
collecting the digests into the multi-architecture tags. Nothing is emulated, and a tag never points at a
half-published image because it is created only once both architectures exist.

**If a build fails and leaves a version tagged with no images**, run the Release workflow from the Actions tab
with that version (without a leading `v`) as its input. Re-tagging is not possible at that point — the tag and
the GitHub Release already exist — which is what the `workflow_dispatch` input is for.

To release outside this flow, push a `v*` tag by hand; `release.yml` still publishes on one. That skips the
changelog and the GitHub Release, so it is for recovering a botched release rather than for making one.

## The Worker

The second deployment shape: the same codebase on Cloudflare, with D1 instead of the volume and a Cron
Trigger instead of the timer (ADR-0006, ADR-0012). Everything below fits a free account except where it says
otherwise, and none of it needs CI — there is no deploy-on-tag workflow for the Worker, because publishing one
needs an account and the project keeps the deploy in a person's hands.

**The deploy artifact is the build's output.** `vp run web#build:workers` emits two directories:
`apps/web/dist/deevy` — the bundled Worker and `wrangler.json`, the committed `wrangler.jsonc` with the built
entry and the built asset directory filled in — and `apps/web/dist/client`, the SPA those assets are. The
committed `wrangler.jsonc` is a source, not a deploy artifact: it names `src/worker.ts` and an `assets` block
with no `directory`, so wrangler refuses it on its own. The Cloudflare plugin writes
`apps/web/.wrangler/deploy/config.json` pointing at the built file, which is how a bare `wrangler deploy` finds
it, and `vp run web#check:workers` names that same file rather than trusting the note — a dry run of anything
else is a typecheck of a configuration nobody ships.

So: **build, then check, then deploy, in that order**, and a deploy that follows no build uploads the last
build's bundle.

### Deploying to a free account

Run steps 3 onward from `apps/web`, so wrangler finds its own configuration.

1. **Build and validate.** From the repository root:

   ```bash
   vp install
   vp run web#build:workers
   vp run web#check:workers
   ```

   The check ends with `--dry-run: exiting now.` and the bindings it found — `env.DB (deevy)`, a D1 Database.
   A failure here is a configuration that would have failed on upload.

2. **Sign in to Cloudflare.** `wrangler login` opens a browser and ends with `Successfully logged in.`
   `wrangler whoami` names the account everything below lands in.

3. **Deploy once**, which provisions the database and tells you the origin. `wrangler deploy` finds a
   `d1_databases` entry with a name and no id, says so, and creates it before it uploads anything:

   ```
   The following bindings need to be provisioned:
   Binding        Resource
   env.DB         D1 Database

   Provisioning DB (D1 Database)...
   Resource name found in config: deevy
   🌀 Creating new D1 Database "deevy"...
   ✨ DB provisioned 🎉
   ```

   There is no `wrangler d1 create` step and no `database_id` to paste anywhere: wrangler remembers which
   database it made, so the next deploy finds the same one, and nothing account-specific is ever committed. It
   then prints the `workers.dev` URL — `https://deevy.<subdomain>.workers.dev` — and the Cron Trigger it
   registered. Sign-in does not work yet and nothing else has to:
   `curl https://deevy.<subdomain>.workers.dev/healthz` answers `{"ok":true}`, and the SPA loads and says
   nobody is signed in.

4. **Build the schema.** The database exists now but is empty, so this follows the first deploy rather than
   preceding it.

   ```bash
   wrangler d1 migrations apply deevy --remote
   wrangler d1 migrations list deevy --remote
   wrangler d1 execute deevy --remote --command "select name from sqlite_master where type='table' order by name"
   ```

   The first lists every file in `packages/db/migrations` — twenty-four as of migration `0024` — asks to
   confirm, and reports each as applied. The second then says there is nothing left to apply. The third lists deevy's tables plus
   wrangler's own `d1_migrations`. Applying twice is a no-op. Nothing here touches the local D1 that
   `vp run web#test:workers` uses; `--remote` is the whole difference.

5. **Create a client with a sign-in provider** — at least one, and any of the four does. For GitHub that is
   an OAuth App at <https://github.com/settings/developers>, with that origin as the homepage and
   `https://deevy.<subdomain>.workers.dev/api/auth/callback/github` as the Authorization callback URL; for
   Google, GitLab or an OpenID Connect IdP it is the same origin with `/api/auth/callback/<provider>`. The table under [Signing in](#signing-in-and-the-origin-better_auth_url-names) is the full set of
   origins and callbacks; the rule is that `BETTER_AUTH_URL` and the callback change together or sign-in
   breaks.

6. **Put the secrets in.** Each command prompts for the value and answers `Success! Uploaded secret <name>`:

   ```bash
   wrangler secret put BETTER_AUTH_URL          # https://deevy.<subdomain>.workers.dev
   wrangler secret put BETTER_AUTH_SECRET       # openssl rand -base64 32
   wrangler secret put GITHUB_CLIENT_ID
   wrangler secret put GITHUB_CLIENT_SECRET
   ```

   Offering Google or GitLab as well, or instead, is `wrangler secret put GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`, or `GITLAB_CLIENT_ID` and `GITLAB_CLIENT_SECRET`, beside them; the sign-in page
   draws whichever pairs are complete. Offering an OpenID Connect IdP is `DEEVY_OIDC_CLIENT_ID` and
   `DEEVY_OIDC_CLIENT_SECRET` the same way. A self-hosted GitLab also wants `GITLAB_ISSUER`, and an OIDC
   provider `DEEVY_OIDC_ISSUER` and `DEEVY_OIDC_NAME`; none of those three is a credential, so they can go
   in the `vars` block below.

   `wrangler secret list` shows the names you put in and no values. The rest are not credentials, so they can go in
   a `vars` block in `apps/web/wrangler.jsonc`, where a reviewer can see them:

   ```jsonc
   "vars": { "DEEVY_ADMIN_EMAIL": "you@example.com", "DEEVY_WORKSPACE_NAME": "Acme" },
   ```

   Deploying a public fork, put `DEEVY_ADMIN_EMAIL` in with `wrangler secret put` instead. It is not a
   credential, but it is somebody's personal address, and a `vars` block is committed. A secret and a var
   reach the Worker identically — `readWorkerEnv` cannot tell them apart — so this costs nothing but the
   reviewer's view of it.

7. **Deploy again**, if the `vars` block changed: step 1 again from the repository root, because that block is
   part of the source the build projects, then `wrangler deploy` from `apps/web`. The output names the Cron
   Trigger it registered alongside the bindings. A secret needs no deploy — `wrangler secret put` publishes a
   new version by itself, live within a few seconds — so a deployment configured entirely through secrets
   skips this step.

8. **Check the trigger fires**, by giving it something to do rather than by watching the log. `wrangler tail`
   does not reliably surface `scheduled` invocations — ten minutes of it on a working deployment showed
   request traffic and no scheduled event at all, which reads exactly like a dead schedule and is not one. So
   ask the sweep for a visible effect instead: give an Agent that has an assigned Issue a one-minute schedule,
   and a Run with `trigger = "schedule"` appears within two minutes. That is `runDueWork`, one bounded pass
   (ADR-0012), driven by Cloudflare's own timer.

   ```bash
   wrangler d1 execute deevy --remote --command "update agent set schedule_minutes = 1"
   # wait two minutes, then:
   wrangler d1 execute deevy --remote --command "select status, trigger from run"
   # and put it back:
   wrangler d1 execute deevy --remote --command "update agent set schedule_minutes = null"
   ```

9. **Sign in** at the `workers.dev` origin with the GitHub account whose email is `DEEVY_ADMIN_EMAIL`. The
   first sign-in creates the Workspace and makes you its admin, and nothing else ever creates a second one.
   Settings, Members lists exactly one Member — you, `admin`, `human`. Settings, Event log is the whole
   Workspace log, newest first (an Issue's Activity is the same log read per Issue); it opens with
   `member.joined` over `workspace.created`, both with a null actor because deevy did the writing. The raw
   document is `GET /api/events`, which a signed-in browser can simply visit.

### What a free account does not give you

- **Queues are paid.** The `JOBS` binding is optional in the `Env` type and absent from the committed
  configuration for exactly this reason: `wrangler deploy` must not fail on a queue the account may not
  create. Without it a webhook goes out at the next Cron pass instead of the moment it is owed, and nothing
  else differs — see [Queues, when the account has them](#queues-when-the-account-has-them).
- **Durable Objects are paid, and live Documents need one.** A room — one Document several Members type in
  at once — is one Durable Object, so the `ROOMS` binding in `apps/web/wrangler.jsonc` is what makes
  Documents live on this deployment. Unlike `JOBS` the binding is committed, because unlike a queue it is
  what the feature _is_; a deploy on an account without Durable Objects fails on it, and the honest fix is
  either the paid plan or removing the binding. Without it every Document still reads, writes and versions
  exactly as it did before: `health.ping` answers `liveDocuments: false`, the SPA opens no socket, and a
  write that would land on top of somebody else's is refused rather than merged
  ([ADR-0021](./adr/0021-a-document-is-live-and-markdown-is-what-it-becomes.md)).
- **A Cron Trigger comes round once a minute at the finest.** That is Cloudflare's floor, not deevy's, and it
  is why `DEEVY_SWEEP_INTERVAL_SECONDS` is a Node-only knob. A backlog drains twenty rows a minute.
- **D1 caps the queries one invocation may run**, which is what bounds a live stream's life and what
  `DEEVY_STREAM_SECONDS` divides up. The design assumes the free tier's 50 queries per invocation and 100k
  rows written per day; Cloudflare's own limits pages are the current numbers, and a busy Workspace outgrows
  the daily one long before it outgrows the per-invocation one.
- **Nothing deploys the Worker from CI.** `vp run web#check:workers` proves the artifact on every pull
  request; uploading it is `wrangler deploy` by a person. The Docker image is the half CI does publish, on a
  version tag.
- **A deployed Worker cannot pin an outbound address**, which is the one place where the Cloudflare deployment
  is weaker than the Docker one. It is a workerd limitation and it is written out in full under
  [Client registration](#client-registration-and-what-is-known-to-be-weak).

## Environment

One name per knob on both runtimes: an environment variable on Node, a `var` or a secret on Workers. On
Workers a secret is `wrangler secret put NAME`, a var is a `vars` entry in `apps/web/wrangler.jsonc`, and
locally both come from `apps/web/.dev.vars` — copy `apps/web/.dev.vars.example`. wrangler reads it from
beside `wrangler.jsonc`, so run `wrangler dev` from `apps/web` and let it find its own configuration;
`.gitignore` keeps the file itself out of the repository. Nothing on the Worker reads `process.env`; the
bindings arrive with the request.

| Variable                       | Node        | Workers                | Default              | Without it                                                                                                                                                                                                                                                                |
| ------------------------------ | ----------- | ---------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_URL`              | env         | secret                 | the request's origin | Sign-in callbacks are wrong, the OAuth server is off, and Slack deliveries wait.                                                                                                                                                                                          |
| `BETTER_AUTH_SECRET`           | env         | secret                 | —                    | Better Auth falls back to a development key and says so; a Gate elicitation signed by one instance is then refused by the next. Changing it signs everyone out.                                                                                                           |
| `GITHUB_CLIENT_ID`             | env         | secret                 | —                    | GitHub is neither registered nor offered, and with no other provider set the sign-in page says so. Both halves or neither. Callback `${BETTER_AUTH_URL}/api/auth/callback/github`.                                                                                        |
| `GITHUB_CLIENT_SECRET`         | env         | secret                 | —                    | As above.                                                                                                                                                                                                                                                                 |
| `GOOGLE_CLIENT_ID`             | env         | secret                 | —                    | Google is neither registered nor offered, and with no other provider set the sign-in page says so. Both halves or neither. Redirect URI `${BETTER_AUTH_URL}/api/auth/callback/google`.                                                                                    |
| `GOOGLE_CLIENT_SECRET`         | env         | secret                 | —                    | As above.                                                                                                                                                                                                                                                                 |
| `GITLAB_CLIENT_ID`             | env         | secret                 | —                    | GitLab is neither registered nor offered, and with no other provider set the sign-in page says so. Both halves or neither. Redirect URI `${BETTER_AUTH_URL}/api/auth/callback/gitlab`.                                                                                    |
| `GITLAB_CLIENT_SECRET`         | env         | secret                 | —                    | As above.                                                                                                                                                                                                                                                                 |
| `GITLAB_ISSUER`                | env         | var                    | `https://gitlab.com` | GitLab sign-in goes to gitlab.com. Set it to a self-hosted instance's origin; every GitLab endpoint deevy calls is built from it.                                                                                                                                         |
| `DEEVY_OIDC_ISSUER`            | env         | var                    | —                    | The generic OpenID Connect provider is neither registered nor offered. It is where the IdP's `/.well-known/openid-configuration` hangs off, and everything else is discovered from it, so it counts as a third half of the pair: without it there is nothing to register. |
| `DEEVY_OIDC_CLIENT_ID`         | env         | secret                 | —                    | As above. All three or none. Redirect URI `${BETTER_AUTH_URL}/api/auth/callback/oidc`.                                                                                                                                                                                    |
| `DEEVY_OIDC_CLIENT_SECRET`     | env         | secret                 | —                    | As above.                                                                                                                                                                                                                                                                 |
| `DEEVY_OIDC_NAME`              | env         | var                    | `Single sign-on`     | The button says "Sign in with Single sign-on". Set it to what your teammates call the IdP.                                                                                                                                                                                |
| `DEEVY_ADMIN_EMAIL`            | env         | var                    | —                    | No Workspace is ever created, so nobody is a Member.                                                                                                                                                                                                                      |
| `DEEVY_WORKSPACE_NAME`         | env         | var                    | `deevy`              | Nothing: renameable later under Settings, Workspace.                                                                                                                                                                                                                      |
| `DEEVY_WEB_ORIGIN`             | env         | var                    | —                    | Nothing, unless the SPA is deployed on its own origin; then its calls are refused by CORS, and every link deevy hands a Human — a Gate, an invitation, a Slack message — points at the API rather than at the page.                                                       |
| `DEEVY_RUN_STALE_MINUTES`      | env         | var                    | 30                   | Nothing: 30 minutes of silence makes a Run `stale`, which its next Activity undoes.                                                                                                                                                                                       |
| `DEEVY_SWEEP_INTERVAL_SECONDS` | env         | — the Cron Trigger     | 60                   | Nothing: the sweep looks every minute. Node-only, because on Workers the schedule is `triggers.crons` in `apps/web/wrangler.jsonc`.                                                                                                                                       |
| `DEEVY_GATE_REMINDER_HOURS`    | env         | var                    | 4                    | Nothing: an undecided Gate asks its approvers again every four hours.                                                                                                                                                                                                     |
| `DEEVY_STREAM_SECONDS`         | — unbounded | var                    | 60                   | Nothing: a live stream on Workers ends after a minute and the browser resumes from the cursor it signed off with. Workers-only, because a Node process holds a connection for as long as the browser does.                                                                |
| `ROOMS`                        | —           | Durable Object binding | — the object         | Nothing on Node, which serves its own rooms on the port it already listens on. On Workers, a deployment without it has no live Documents: editors behave as they did before, and `health.ping` says so. Durable Objects are a paid feature.                               |
| `JOBS`                         | — the sweep | optional binding       | — no queue           | Nothing: a webhook delivery goes out at the next Cron pass instead of the moment it is owed. Workers-only, and absent from the committed `apps/web/wrangler.jsonc` because Queues are a paid feature.                                                                     |
| `DEEVY_DATABASE_PATH`          | env         | — the `DB` binding     | `/data/deevy.sqlite` | Node writes to `./data/deevy.sqlite`. On Workers the rows are D1's and the path means nothing.                                                                                                                                                                            |
| `DEEVY_PORT`                   | env         | —                      | 3000                 | Node listens on 3000. Workers has no port: the platform routes to the Worker.                                                                                                                                                                                             |
| `DEEVY_WEB_DIST`               | env         | —                      | —                    | Node answers the API and serves no pages. On Workers the SPA is the asset handler's, not the app's.                                                                                                                                                                       |

The Worker serves the SPA, the API, the reference at `/api/docs`, the MCP challenge and, since M3 slice 5,
signing in: `BETTER_AUTH_*`, `GITHUB_*`, `GOOGLE_*`, `GITLAB_*`, `DEEVY_OIDC_*`, `DEEVY_ADMIN_EMAIL` and
`DEEVY_WORKSPACE_NAME` do on Workers exactly what they do on Node, bootstrap and allowlist included.

### Background work, on a timer or on a Cron Trigger

The stale sweep, the schedule trigger, the Gate reminder and both delivery loops are one function,
`runDueWork` in `packages/core/src/work.ts`, and each runtime brings its own schedule to it. Node's
`startRunner` brings a timer every `DEEVY_SWEEP_INTERVAL_SECONDS` and drains: it goes again while a pass says
there is more. Cloudflare owns its own schedule, so the Worker has no interval to configure — `triggers.crons`
in `apps/web/wrangler.jsonc` runs it every minute, the finest Cloudflare offers, and the `scheduled` handler
takes one bounded pass of twenty rows and lets the next trigger find the rest. A backlog therefore drains a
minute at a time on Workers rather than in one tick, which is the trade a CPU budget and a per-invocation D1
query cap buy.

`DEEVY_RUN_STALE_MINUTES` and `DEEVY_GATE_REMINDER_HOURS` mean the same thing on both. `wrangler dev --local`
fires a trigger by hand at `/cdn-cgi/handler/scheduled?cron=*+*+*+*+*`, and the response waits for the pass, so
a 500 there is the sweep's own error. `--test-scheduled`'s `/__scheduled` does not work on a Worker that also
serves assets: the path is not one `createApp` mounts, so it is not in `assets.run_worker_first` and the asset
handler answers it with the SPA's `index.html`.

Which paths the Worker answers rather than the asset handler is `assets.run_worker_first` in
`apps/web/wrangler.jsonc`. It is part of the routing table, not configuration: a path the app mounts that is
missing from it is answered with the SPA's `index.html` — a 200 with the wrong body — so
`packages/core/tests/worker-routes.test.ts` asserts the list against the app's own routes, and
`vp run web#test:workers` drives the built Worker on `wrangler dev --local` to prove it over HTTP.

The GitHub OAuth App needs the `read:org` scope for `github_org` allowlist rules, and a GitLab application
needs `read_api` for `gitlab_group` ones. deevy requests both, so a client created before the slice that
added one will ask for the extra scope at the next sign-in.

### Queues, when the account has them

A webhook delivery is a durable row before it is a message: `appendEvent` writes what a subscribed URL is owed
in the same handler as the write, and the sweep above finds it whether or not anything else does. A Queue only
changes when. On an account that has one, the write's tail hands the row's id to the `JOBS` binding, a
consumer picks it up in the next second and the POST goes out at once instead of at the next trigger; on an
account without one there is no binding, `createApp` discards the job, and the trigger is the whole delivery
path. Nothing else differs, which is why the binding is optional in the `Env` type and absent from the
committed `apps/web/wrangler.jsonc` — Queues are paid, and `wrangler deploy` must not fail on a queue a free
account is not allowed to create.

Adding one is two blocks and a name:

```jsonc
"queues": {
  "producers": [{ "binding": "JOBS", "queue": "deevy-jobs" }],
  "consumers": [{ "queue": "deevy-jobs", "max_batch_size": 10, "max_retries": 10 }],
}
```

then `wrangler queues create deevy-jobs` before the deploy that first names it. Queues are at-least-once, so
the same message can arrive twice; that costs one POST rather than two, because `deliverWebhook` claims the
row before it sends and will not claim one that has already landed. A consumer failure is retried by the
queue, and it is the row's own attempt count — not the queue's — that decides when deevy gives up and appends
`webhook.exhausted`, exactly as it would in a sweep. `max_retries` below eight therefore ends a delivery's
life early on a receiver that is down; the Cron pass still finds the row afterwards, so nothing is lost, but
setting it at or above eight keeps the two paths saying the same thing.

### Live updates, and why a stream on Workers ends

The board keeps itself in step by reading the Event log as it happens, over one long-lived request per
browser: `events.subscribe` polls the log and sends what it finds, plus a heartbeat carrying its cursor. On
Node that request lives as long as the browser holds it and `DEEVY_STREAM_SECONDS` means nothing there.

On Workers it cannot. Each poll is one D1 query and D1 caps the queries one invocation may run — 50 on the
free plan — so a stream's life is that cap divided by its poll interval, and a stream that overran it would be
cut off mid-message. deevy ends it first instead: the Worker polls every two seconds and, after
`DEEVY_STREAM_SECONDS`, sends one last heartbeat carrying the cursor it reached and returns. The SPA treats a
clean end as an invitation rather than a failure, reconnecting at once from that cursor, so nothing is missed
and nobody sees the seam. Raising the value raises the query count with it — one every two seconds — so a
value much over 90 spends the whole cap on polling and leaves none for signing the request in.

### Signing in, and the origin `BETTER_AUTH_URL` names

Which providers an instance offers is what its environment sets: `createAuth` registers the entries whose
client id and secret are both present, `health.ping` reports the same list publicly, and the sign-in page
draws one button per entry in that order. An instance with none configured says so on the page instead of
offering a button that goes nowhere. GitHub, Google, GitLab and one generic OpenID Connect provider are the
entries, `GITHUB_CLIENT_ID` with `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` with `GOOGLE_CLIENT_SECRET`,
`GITLAB_CLIENT_ID` with `GITLAB_CLIENT_SECRET` and `DEEVY_OIDC_CLIENT_ID` with `DEEVY_OIDC_CLIENT_SECRET` and
`DEEVY_OIDC_ISSUER`; any of them, all of them or none (docs/plans/sign-in.md).

Google is registered with its default scopes and no `hd`, so it does not decide who may join. Who may join is
the allowlist: a Google Workspace is an email domain, and an `email_domain` rule under Settings, Allowlist
admits it in the one place an admin already looks. Configuring the client pair therefore lets anyone with a
Google account sign in — and leaves them signed in, not a Member, until a rule matches them.

GitLab is one entry for both gitlab.com and a self-hosted instance: `GITLAB_ISSUER` is where it is, defaulting
to `https://gitlab.com`, and the authorization, token and `/api/v4` endpoints are all built from it. It is
registered with `read_user`, which is the profile, and `read_api`, which is the only scope GitLab has that
lists a person's groups — so a `gitlab_group` rule costs the sign-in a token that can read the API it can
reach. That token is Better Auth's, stored on the `account` row, read once on the join and never again;
an instance with no `gitlab_group` rule never spends it, because the groups are only asked for when such a
rule exists and no email domain matched. Note what that does and does not buy an operator who would rather
not grant it: the scope is on the registration, so every GitLab sign-in consents to it and stores a token
that could read the API, whether or not a group rule exists. Leaving group rules alone means the token is
never used; it does not mean it is never issued. An operator who wants it never issued has to leave GitLab
unconfigured.

Anything that speaks OpenID Connect is the fourth entry, and one is all there is: a self-hosted instance has
one IdP, and a list of them would put JSON in a secret to serve a case nobody has. `DEEVY_OIDC_ISSUER` is
where the IdP publishes `/.well-known/openid-configuration` — `https://acme.okta.com`,
`https://login.microsoftonline.com/<tenant>/v2.0`, a Keycloak or Authentik realm URL with its path — and the
authorization, token, userinfo and JWKS endpoints are all read out of that document, so the issuer is as
load-bearing as the client pair and an entry missing any of the three is not offered. deevy asks for `openid`,
`profile` and `email` and nothing else, uses PKCE, and requires the discovery document to name an issuer and a
`jwks_uri`: an OIDC sign-in's identity is its `id_token`'s claims, and a token nobody can verify is not an
identity. `DEEVY_OIDC_NAME` is what the button says — "Acme SSO" rather than "Single sign-on" — so an operator
names their own IdP without a deployment of the SPA. Who may join is still the allowlist: an `email_domain`
rule admits the addresses the IdP hands out.

Two things to know about pointing it at an IdP. The discovery document is fetched **once, when the instance
starts**: an IdP that cannot be reached at that moment is skipped with a line in the log and no error, and
the button is not offered until the process (or, on Workers, the isolate) is replaced — and because the fetch
is awaited before the first sign-in of any kind, an issuer pointed at an address that hangs delays the first
GitHub or Google sign-in too, for as long as the runtime's own connect timeout. Point `DEEVY_OIDC_ISSUER` at
something reachable, or leave it unset. And an IdP that sends no `email_verified` claim — Microsoft Entra
sends none — can sign a teammate in, but cannot become the _second_ provider for a Human who already has one
here: that link is refused, for the reason under **One Human is one Member** below.

**Who may join, and who is invited.** A rule admits a category — an email domain, a GitHub organization, a
GitLab group — and it goes on admitting everybody who matches it, this month and next. An invitation admits
one person: an admin creates it in Settings, Workspace with an address and a role, and gets a link back
once, because deevy has no email Channel to send it with and keeps only a hash of the token. The invited
Human clicks the link, signs in with whichever provider the instance offers, and accepting is what makes
them a Member — the address that signs in has to be the address that was invited, so a forwarded link is not
a second seat. An invitation is good for seven days, one address holds one live invitation at a time
(revoke it to send another), and an admin who loses a link revokes the invitation and issues a new one.
Neither is a Gate: nothing waits on a Human's ruling, and neither reaches an inbox — the admin is holding
the link.

The link points where a browser finds deevy, which is `BETTER_AUTH_URL` in the image and on the Worker,
since both serve the SPA themselves. Where the SPA has an origin of its own, that is `DEEVY_WEB_ORIGIN`, and
setting it is what keeps an invitation link, a Gate link and a Slack message pointing at the page rather than
at the API beside it.

**One Human is one Member.** A teammate who signs in with one provider and later with another lands on the
same user row: the second sign-in links onto the address the first one registered, so they keep one handle,
one inbox and one Member rather than becoming two people who share an email.

What decides is the provider, not deevy's configuration of it. **No provider is trusted by name**: a second
sign-in links only when the provider itself says the address is verified. GitHub and Google always do, and
GitLab says so with the `confirmed_at` stamp on its profile, so for those three the rule is invisible. It is
not invisible for an OpenID Connect IdP that omits the claim — Microsoft Entra omits it — where the second
sign-in is refused with `account_not_linked` and the teammate has to keep using the provider they started
with. That is the deliberate direction to fail in: the alternative, trusting whatever an operator configured,
means an IdP with open self-registration can hand somebody an account on a colleague's address and have it
linked onto that colleague's Member, even when the IdP truthfully reports the address as unverified.

The other end of the link is guarded the same way. Better Auth also refuses to link onto a local row that is
itself unverified, so somebody who signed in first with an address a provider would not vouch for does not
collect the real owner's next sign-in; that one fails at the callback with `account_not_linked`, and no
second Human is created on the address. Note what that row's flag is: deevy never writes it, so it holds
whatever the provider that created the row reported. A Human whose first sign-in was unverified therefore
stays on that provider until an operator changes the row. Linking is also same-address only — two addresses are two Humans, and deevy has no
screen that says otherwise.

Whether a provider proved the address is the provider's own answer, and they word it differently. GitHub and
Google say so directly. GitLab does not: its `/api/v4/user` has no `email_verified` at all, only
`confirmed_at`, the moment the address answered GitLab's confirmation mail — so deevy reads that as the proof
it is, and a GitLab account whose address was never confirmed lands unverified. A generic OIDC provider is
taken at the `email_verified` claim of its `id_token`, and an IdP that publishes no such claim — Entra is one
— therefore leaves every Human it signs in unverified: they sign in and become Members as usual, but a second
provider on the same address is refused with `account_not_linked` until that IdP asserts the claim. An
operator behind such an IdP should offer it alone rather than beside a second provider, or configure the IdP
to release `email_verified`.

`BETTER_AUTH_URL` has to be the origin the browser actually visits, character for character. Better Auth
builds the OAuth callback from it and sets the session cookie for it, and `packages/core/src/auth.ts` pins
the token issuer and the RFC 8707 resource identifier to it as well. A value naming a host nobody visits
therefore mints tokens bound to that host and a cookie the browser never sends back — and it cannot be
guessed from the request instead, because then a caller would choose the audience of the tokens deevy signs.

Every provider's callback follows from it, and each ends in the provider's own id:

| Where deevy runs          | `BETTER_AUTH_URL`                       | Authorization callback URL                                           |
| ------------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `wrangler dev --local`    | `http://localhost:8787`                 | `http://localhost:8787/api/auth/callback/<provider>`                 |
| a `workers.dev` subdomain | `https://deevy.<subdomain>.workers.dev` | `https://deevy.<subdomain>.workers.dev/api/auth/callback/<provider>` |
| a custom domain           | `https://deevy.example.com`             | `https://deevy.example.com/api/auth/callback/<provider>`             |
| the Docker image          | `https://deevy.example.com`             | `https://deevy.example.com/api/auth/callback/<provider>`             |

`<provider>` is `github` for the GitHub OAuth App's Authorization callback URL, `google` for the Authorized
redirect URI of the Google OAuth client (an OAuth 2.0 Client ID of type "Web application" in a Google Cloud
project's Credentials, with the consent screen's scopes left at email and profile), `gitlab` for the
Redirect URI of the GitLab application (User settings › Applications, confidential, scopes `read_user` and
`read_api`), and `oidc` for the Redirect URI of the OpenID Connect client — deevy's own name for the provider,
whatever the IdP is, so `DEEVY_OIDC_NAME` changes the button and never the URL.

A GitHub OAuth App holds one callback URL, so a Worker reachable both on its `workers.dev` subdomain and on a
custom domain needs an App for each, or a decision that sign-in happens on one of them; a Google client and a
GitLab application each hold a list, so one of those can carry both. Move between origins by changing `wrangler secret put BETTER_AUTH_URL`
and the callbacks together: either one alone leaves sign-in refused by the provider or the session cookie set
for an origin nobody is on.

## The CLI

`deevy` is deevy from a terminal (`docs/plans/cli.md`). It signs in through the same OAuth server a browser
uses and holds a token for the API resource, so what it may do is exactly what the Human signing in may do —
including nothing a delegated credential may do, which is a Gate ruling
([ADR-0010](./adr/0010-a-delegated-credential-cannot-decide-a-gate.md)).

```bash
npm install -g @deevy/cli               # or npx @deevy/cli
deevy login https://deevy.example.com   # opens a browser; stores a token
deevy whoami                            # says who this terminal is, and how
deevy logout                            # forgets the token
```

| Variable          | Default     | What it does                                                                                                                                                     |
| ----------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEEVY_URL`       | —           | The instance every command talks to, when one is not named as an argument.                                                                                       |
| `DEEVY_API_KEY`   | —           | An Agent's API key. Set it and the CLI acts as that Agent for the run, which is what a script wants; it wins over a signed-in Human, and `deevy whoami` says so. |
| `DEEVY_WEB_URL`   | `DEEVY_URL` | Where the SPA is, when that is not where the API is. Only `deevy gates open` uses it, and a link built on the wrong one opens a 404.                             |
| `XDG_CONFIG_HOME` | `~/.config` | Where the token is kept: `<that>/deevy/<scheme>_<host>.json`, mode 0600.                                                                                         |
| `NO_COLOR`        | —           | Turns colour off. It is off for a pipe either way.                                                                                                               |

One file per instance, so signing into a second deevy does not sign you out of the first. `deevy logout`
forgets the token on this machine; the consent it was issued under stays listed under Settings until a Human
revokes it there, because revoking a consent wants a cookie session and a CLI has none.

Each sign-in registers a new OAuth client, so a Human who signs in repeatedly accumulates rows in that list.

## Agents and MCP

deevy never runs an agent (ADR-0003). It gives each Agent an identity and a key, tells it there is work, and
takes a Run back; something outside deevy does the running.

A Sponsor creates an Agent under Settings, Agents. Creating one makes a Member with `kind = agent` whose
Sponsor is the Human who created it, and mints its first API key, shown **once** in the dialog that created
it — an Agent with no key could reach nothing at all. Later keys are issued on the Agent's own page and are
shown once in the same way. Grant the Agent the Projects it should see: an ungranted Project does not exist
to it, and an Agent starts with none.

The command to connect with is shown beside the key, in the dialog that created the Agent and beside every
key issued afterwards, with that key already in it: a key is readable once, so that is the only moment deevy
can write one into anything. The Agent's page carries the same block standing, where it names the key instead
— `DEEVY_AGENT_KEY` for the clients that read a variable from the environment, a placeholder for those that
do not. Either way there is a tab per coding agent: Claude Code, OpenCode, Cursor CLI, Copilot CLI, and the
shape anything else speaking MCP over streamable HTTP wants.

The MCP endpoint is `POST ${BETTER_AUTH_URL}/mcp`, and the Agent authenticates with its key as a bearer token:

```bash
claude mcp add --transport http deevy "$DEEVY_URL/mcp" --header "Authorization: Bearer $DEEVY_AGENT_KEY"
```

It is stateless, so any instance answers any request and nothing has to stick to one process. An
unauthenticated request answers 401 naming its Protected Resource Metadata, which is how a client knows to
start an OAuth flow rather than simply failing.

An Agent can do less than a Human by construction: it can read and write Issues, Documents, comments, Labels
and Links in the Projects it was granted, and drive its own Runs. It can never administer the Workspace,
manage Members, or approve a Gate, and neither can anything holding a delegated credential — a Gate is decided
by a Human signed in to deevy, in a browser (ADR-0004, ADR-0010). Which operations an Agent may call at all is
default-deny, per operation (ADR-0011).

[agent-loop.md](./agent-loop.md) is a worked example of the runtime on the other side: the MCP configuration a
Claude Code loop needs, the instructions that tell it how to work an Issue, and what the Human does at the
Gate.

## A Human's own MCP client

A Human points their own client at the same endpoint with no header at all, and acts as themselves rather
than as an Agent. The same Claude Code that is an Agent when it carries an Agent's key is that Human when it
carries none: the credential decides the identity, never the software, and nothing a Human drives is ever
registered as an Agent.

```bash
claude mcp add --transport http deevy "$DEEVY_URL/mcp"
claude mcp login deevy
```

deevy is its own OAuth 2.1 authorization server (ADR-0007). The client discovers it from the 401 challenge,
sends the Human to deevy in a browser to sign in and consent, and is issued an access token bound to
`${BETTER_AUTH_URL}/mcp`. `claude mcp add` only records the server; the dance starts from `claude mcp login`,
or from the `/mcp` menu of an interactive session. `--no-browser` prints the authorization URL instead of
opening one, and expects the redirect URL pasted back, so it needs a terminal. The Human sees every client
that consented under Settings, MCP clients, and can revoke one there. Revoking removes the consent and the
refresh token; an access token already issued expires on its own within the hour.

**Walked on 2026-09-06 with Claude Code 2.1.261**, against a local instance. Claude Code identifies itself
by a Client ID Metadata Document, `https://claude.ai/oauth/claude-code-client-metadata`, sends PKCE S256 and
`resource`, and redirects to `http://localhost:<ephemeral port>/callback` while its document registers
`http://localhost/callback` with no port. Better Auth 1.7.2 refused that with `invalid_redirect`: its matcher
granted RFC 8252's loopback port variance to IP literals only, though its CIMD plugin had accepted the name
into the same client row (better-auth#10937). 1.7.3 extends the variance to `localhost`, which is why deevy
pins that line and no earlier one. With it the consent page appears, the tool list loads, a comment posted
from that session is the Human's in the Event log, and its inbox is the Human's.

What that client is offered is decided by the same registry that authorizes it (ADR-0016): the tool set less
the four that write a Run — `runs_start`, `runs_post_activity`, `runs_request_approval`, `runs_finish` are an
Agent's alone, and a Human naming one anyway is refused with "Only an Agent can do that" — plus `runs_answer`,
which is a Human's. `issues_move` and `projects_get` face both. [as-yourself.md](./as-yourself.md) is the
worked example: the `CLAUDE.md` snippet a person puts in the repository they work in, beside the Agent's in
[agent-loop.md](./agent-loop.md).

Two documents make this discoverable, and both are served from the instance origin rather than from under
`/api/auth`, because RFC 8414 and RFC 9728 both build a metadata URL by inserting the well-known segment
right after the host:

- `${BETTER_AUTH_URL}/.well-known/oauth-protected-resource/mcp` — and the root form beside it.
- `${BETTER_AUTH_URL}/.well-known/oauth-authorization-server`, and `/.well-known/openid-configuration`.

`BETTER_AUTH_URL` is what all of it is built from, so **the OAuth server is off when it is unset**. It has to
be, since a resource identifier is an absolute URL and one guessed per request would bind tokens to whatever
host the caller sent. The rest of deevy runs unchanged; only a Human's MCP client is refused.

### Two resources, and why a token only works where it was meant to

This instance issues access tokens for two protected resources (RFC 8707, [ADR-0023](./adr/0023-the-api-is-its-own-protected-resource.md)):

| Resource                 | Reached at        | Held by                                                 |
| ------------------------ | ----------------- | ------------------------------------------------------- |
| `${BETTER_AUTH_URL}/mcp` | `/mcp`            | a Human's MCP client                                    |
| `${BETTER_AUTH_URL}/api` | `/api` and `/rpc` | a Human's CLI, and anything else driving the operations |

A token is checked against the resource it was minted for, in both directions: an MCP client's token is
refused at the API, and an API client's is refused at MCP. That is the point — consenting to an MCP client
grants it the tools deevy projects, not every operation behind them.

A client is linked to the API resource only if it names it when it registers. An MCP client that registers
without asking cannot obtain an API token at all, and one that asks anyway is refused with RFC 8707's
`invalid_target` — so adding the second resource widened nothing for the clients that already existed.

Only the MCP resource publishes RFC 9728 metadata. A client that wants the API resource reads
`/.well-known/oauth-authorization-server` and names the resource in its authorization request; it does not
need a 401 to find its way there, because it was given the instance URL to begin with.

Gate rulings are outside all of this: `gates.approve` and `gates.reject` want a cookie session, so no
delegated credential decides a Gate whatever it was minted for
([ADR-0004](./adr/0004-agents-never-approve-gates.md), [ADR-0010](./adr/0010-a-delegated-credential-cannot-decide-a-gate.md)).

### Client registration, and what is known to be weak

A client identifies itself in one of two ways, both enabled:

- **Client ID Metadata Documents** (CIMD), which MCP 2026-07-28 prefers: the `client_id` is an HTTPS URL, and
  deevy fetches the document at it. `client_id_metadata_document_supported: true` is advertised.
- **Dynamic client registration** at `/api/auth/oauth2/register`, unauthenticated. It is deprecated in the
  2026-07-28 revision and stays on only because the clients that do not speak CIMD cannot be asked to change.
  Anyone who can reach the instance can create a client row; a client is worth nothing until a Human consents
  to it, so the cost of that is rows, not access.

**How a document is fetched, and what is still weak.** Dereferencing a Client ID Metadata Document means
fetching a URL an unknown caller chose, so the transport is the SSRF boundary. Both runtimes refuse every
non-HTTPS scheme, every URL carrying credentials, every host that is not publicly routable by its shape,
every redirect and every response over 128 KB, and bound the request to five seconds. They differ in one
thing, and it is the thing that matters — whether the address checked is the address connected to.

| Target      | Transport                   | How a name is checked                                                                  | Residual risk                                                                                                                                               |
| ----------- | --------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node**    | `apps/server/src/cimd.ts`   | `node:dns` resolves once; every answer must be publicly routable; the first is pinned. | None of this kind. The connection uses the address that passed, with the name kept for the Host header, TLS SNI and certificate validation.                 |
| **Workers** | `packages/core/src/cimd.ts` | A resolver is asked over HTTPS for A and AAAA; any private answer refuses the name.    | A name that answers publicly to the resolver and privately to `fetch` a moment later is not caught. `fetch` resolves the name again and nothing can pin it. |

Node's is wired in as `AuthEnv.fetchClientMetadataResource`, the seam the plugin provides for exactly this.
The Workers pre-resolution asks `https://cloudflare-dns.com/dns-query`; there is no knob for it, and a
deployment that wants a different resolver passes one to `createClientMetadataFetch`.

The Workers gap is a workerd limitation rather than a choice, and M3 measured both ways out before accepting
it. `cf.resolveOverride` only redirects to a host proxied on the Worker's own Cloudflare zone, so it says
nothing about a third party's name. `connect()` from `cloudflare:sockets` can dial a chosen address and still
validate the certificate against the original name, through an undocumented
`startTls({ expectedServerHostname })` — which works in `wrangler dev --local` — but deployed Workers block
outbound TCP to Cloudflare's own IP ranges, and a large share of the internet's CIMD hosts sit behind
Cloudflare. Local workerd blocks neither those ranges nor loopback, so no test on `wrangler dev --local`
could tell a working pin from one that fails only in production. Revisit if Cloudflare documents
`expectedServerHostname` and lifts the IP-range block, or when a Durable Object could hold a socket pool.

Either way the reachable outcome is a blind GET from the instance: nothing of the response is returned to the
caller. Put the instance behind an egress policy if that matters, or pass a stricter transport as
`AuthEnv.fetchClientMetadataResource`.

Scopes ride on the token and are enforced by nothing in v1: a Human's MCP client can do whatever that Human
can, less the one thing below.

**Except a Gate.** `gates.approve` and `gates.reject` require a browser session. A Human's own MCP client
holding a valid token for that same Human is refused, deliberately: an approval is a Human's act in deevy's
UI, and a delegated credential is not that Human (ADR-0004, docs/plans/m2.md).

## Webhooks

deevy tells a URL that something happened, and that is the whole of how an Agent is triggered when it does not
poll (ADR-0003). Every Event is matched against the Workspace's subscriptions as it is appended, and each
match becomes a durable delivery row; the background runner sends them. Nothing is lost if the process
restarts mid-flight, because the row is the record and the Event log is what it renders from.

A subscription is a URL, a secret, an optional list of Event kinds, and an optional Project. Admins manage
them under Settings, Webhooks; a Sponsor sees and manages the subscriptions belonging to the Agents they
sponsor. The URL must be `https`. The kind filter takes exact kinds (`issue.assigned`) or a family
(`run.*`, every kind an Event about a Run carries); no filter means every kind, and no Project means every
Project.

The secret goes in and never comes out — not from the API, not from the Event log, not from `openapi.json` —
so choose it yourself when you create the subscription and keep it where the receiver can read it. The same
holds on the Agent's own page: setting an Agent's webhook URL for the first time asks for a secret too, and
deevy will not invent one, because a secret nobody can read signs nothing. Setting a new one overwrites the
old and appends `webhook.subscribed` with `secretChanged: true`. The URL must be `https`, on either page: a
signature is worth nothing when the body it signs is on the wire in the clear.

Each POST carries three headers:

| Header            | What it is                                                                           |
| ----------------- | ------------------------------------------------------------------------------------ |
| `deevy-signature` | `t=<unix seconds>,v1=<hex>`, described below.                                        |
| `deevy-delivery`  | The delivery's id. Every retry of the same Event carries the same one: dedupe on it. |
| `deevy-event`     | The Event's sequence number, which is also `seq` in the body.                        |

The body is the Event row and nothing else: `seq`, `kind`, `workspaceId`, `projectId`, `subjectType`,
`subjectId`, `actorMemberId`, `payload`, `createdAt`.

A delivery that is refused is attempted eight times in all, waiting ten seconds after the first failure and
doubling from there with a little jitter, capped at six hours. After the eighth, deevy gives up and appends a
`webhook.exhausted` Event.
Settings, Webhooks lists the recent attempts for a subscription with the status and the error each came back
with, and can owe one again from the beginning.

### Verifying `deevy-signature`

The header is `t=<unix seconds>,v1=<hex>`. `v1` is HMAC-SHA256, hex-encoded, over the string
`<the same unix seconds>.<the raw body>`, keyed with the subscription's secret. The timestamp is inside the
signed message rather than beside it, so it cannot be moved forward to keep an old body alive, and a signature
more than five minutes from the receiver's clock is a replay whatever it verifies against.

Verify against the **bytes you received**. Parsing the JSON and serialising it again changes the body and the
signature will not match.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

const toleranceSeconds = 5 * 60;

function verify(secret, header, rawBody, now = new Date()) {
  const parts = Object.fromEntries(
    header
      .split(",")
      .map((part) => part.trim().split("="))
      .filter((pair) => pair.length === 2),
  );
  const seconds = Number(parts.t);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - seconds) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${seconds}.${rawBody}`).digest("hex");
  const given = Buffer.from(parts.v1 ?? "", "utf8");
  const mine = Buffer.from(expected, "utf8");
  return given.length === mine.length && timingSafeEqual(given, mine);
}
```

deevy's own implementation is `packages/core/src/webhooks.ts`, which exports `verifySignature` beside the
signer for exactly this reason. It uses `crypto.subtle` rather than `node:crypto` (ADR-0006); the maths is the
same either way.

## Notification Channels and routing

A Notification reaches a Human through Channels: their in-app inbox always, and a Slack channel when the
Workspace routes it there. Five kinds exist — `mention`, `assignment`, `gate_awaiting`, `run_awaiting_input`,
`run_finished` — and who a Notification concerns is decided from the Event alone, never from where it is
delivered. Turning Slack off changes where a Human hears about something, never whether it concerns them.

An admin adds a Channel under Settings, Channels: a name, usually the Slack channel (`#deevy`), and a Slack
[incoming webhook](https://api.slack.com/messaging/webhooks) URL. There is a Test button that posts to it now,
so a wrong URL is found in the room rather than three days later. The URL is a credential: it is stored in the
Channel's config, and the Event log records only its host.

Routing rules, also under Settings, Channels, say which kinds go to which Channel. A rule with no kind means
every kind and a rule with no Project means every Project, so "everything to `#deevy`" is one rule and
"`gate_awaiting` on the Platform Project to `#platform`" is another. Each Human then narrows their own share
under Settings, Notifications: a matrix of kind against inbox and Slack, where a Member who has never said
otherwise gets everything in both.

A Slack message is a durable delivery row like a webhook, retried on the same schedule machinery and given up
on after six attempts. One message per Channel per Event, not per recipient: a Channel is a room, and three
Humans concerned by one Event are not three messages in it.

Slack messages link back to the Issue, so they are only sent when the instance knows its own URL. **Without
`BETTER_AUTH_URL` the rows are written and wait** rather than going out with a dead link; the first tick after
the instance is given an origin sends them.

## Gates, and how many Humans they ask for

A Gate is a State an Issue cannot leave without a Human's approval, and by default one approval from any
Human of the Workspace opens it. Two settings on each Gate, in the Project's Workflow editor, change that
([ADR-0020](./adr/0020-a-gate-may-want-more-than-one-human-and-may-exclude-the-one-who-asked.md)):

| Setting                                            | Default | What it does                                                                           |
| -------------------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| **Humans who must agree**                          | 1       | The Issue stays in the Gate until that many _distinct_ Humans have approved this visit |
| **Whoever brings an Issue here cannot approve it** | off     | The Human who moved the Issue into the Gate is refused their own approval              |
| **Approvers**                                      | empty   | Names who may rule at all; empty means any Human                                       |

**The defaults leave every Workflow exactly as it was**, including a Workspace of one Human, which is what an
upgrade to this version does to an instance that changes nothing.

What is worth knowing before turning either on:

- **One rejection ends it, whatever the threshold**, and the Human who brought the Issue may still reject it.
  Consensus is for letting work through; one reason to stop is enough.
- **Approvals count for one visit to the Gate.** Entering the State starts a visit and so does every
  rejection — including a rejection in the first State of a Workflow, which has nowhere to send the Issue and
  leaves it where it is. Approvals given before a rejection are spent.
- **Excluding the requester costs a Human from every count.** Which Human it will be is not known until there
  is an Issue, but that one of them will be is, so saving the Workflow refuses a threshold that could not be
  met once they are left out. **A Workspace with one Human cannot exclude the requester at all** — every Gate
  would be a dead end — and a Gate asking two approvals with the exclusion on needs three Humans.
- **Suspending a Member can strand an Issue.** Configuration-time checking cannot prevent it: a Gate wanting
  two approvals in a Workspace of two is fine until one of them is suspended. The Issue says so where the
  approve button would be, naming both numbers, and the fix is an admin's — lower the Gate's threshold in the
  Workflow, or reinstate the Member. deevy does not quietly lower it for you.
- **An Agent still never approves anything** (ADR-0004), whatever these are set to, and neither does a
  Human's delegated credential (ADR-0010). A Gate that names approvers may only name Humans.

A Gate short of its threshold appends a `gate.approval` Event carrying how many approvals are still wanted;
`gate.approved` is appended only when the last one lands and the Issue actually leaves. Webhook subscribers
receive the new kind, and anything switching on kinds ignores it.

## How far an Agent may split work up

An Agent can open sub-issues and hand them to other Agents
([ADR-0022](./adr/0022-a-parent-finishes-and-the-last-child-wakes-it.md)). Left alone, an Agent that decides a
task has forty parts will open forty Issues, each of which opens a Run. Three numbers on the Workspace decide
how far it may go, under **Settings › Workspace**:

| Setting              | Default | What it does                                              |
| -------------------- | ------- | --------------------------------------------------------- |
| **Sub-issues each**  | 20      | How many sub-issues one Issue may have                    |
| **Levels deep**      | 3       | How far a tree of sub-issues may go below its root        |
| **Open in one tree** | 50      | How many sub-issues of one tree may be unfinished at once |

They bind Agents and never Humans: you are not stopped by them, and nor is anyone signing in with a browser.
An Agent that reaches one is refused with a message naming the limit and the number, and the refusal appends a
`delegation.refused` Event, so the Agent's Sponsor can see that the shape of the work was decided by a ceiling
rather than by the Agent. Raise them if your Agents are hitting them for good reasons; the defaults are
deliberately small, because twenty sub-issues is a large decomposition and three deep is a plan rather than a
pyramid.

Two things worth knowing before you raise them. A sub-issue may sit in any Project the Agent was granted, so
these numbers bound a tree that may span Projects — what an Agent can reach across is its grants, and an admin
who does not want an Agent opening work in the API Project simply does not grant it. And every sub-issue
assigned to an Agent opens a Run, so these are also the numbers that bound what a single delegation costs to
run.

## The reference agent runtime

deevy never runs an agent (ADR-0003). `apps/agent` is the thing on the other side: a service that
holds one Agent's API key, asks deevy what that Agent has been assigned, and runs Claude against it through
the Claude Agent SDK. It is not part of deevy and does not have to be run at all — an instance with no
runtime is a Workspace where the Humans do the work.

It reaches deevy over HTTP and MCP like any third party, so it does not care which deployment it is talking
to. Point it at a Docker instance or at a `workers.dev` origin and the only thing that changes is `DEEVY_URL`.

### Setting one up

1. **Create the Agent.** Settings, Agents. The Human who creates it is its Sponsor and is accountable for
   it, and the dialog hands back its first API key — shown once, and what becomes `DEEVY_AGENT_KEY`. Issue
   another from the Agent's own page if you lose it; deevy keeps only a hash.
2. **Grant it the Projects it should work in.** An Agent starts with none, and one it was not granted does
   not exist to it.
3. **Give it somewhere to work**, if it should write code: `DEEVY_AGENT_REPO` and a `DEEVY_AGENT_GIT_TOKEN`
   scoped to that one repository, with permission to push a branch and open a pull request and nothing else.
   Leave both unset and the runtime works Documents, Gates and Runs only.
4. **Run it.** `docker compose --profile agent up -d`, or the image directly. The image carries one
   coding-agent CLI, chosen at build time; `claude-code` is the default and `opencode`, `cursor` and
   `copilot` are the others ([docs/harnesses.md](./harnesses.md)):

```bash
docker build -f apps/agent/Dockerfile --build-arg HARNESS=claude-code -t deevy-agent:claude-code .
```

5. **Optionally, tell it rather than let it ask.** Set the Agent's webhook URL to the runtime's listener and
   choose a secret; give the runtime the same secret as `DEEVY_AGENT_WEBHOOK_SECRET`. A delivery then starts a
   Run when it is assigned instead of at the next poll. Polling stays on either way, so a missed delivery
   costs latency and never a Run.

### What it does with a Run

`runs.list` with no arguments is its queue: for an Agent that means its own Runs, `pending` being work to do.
Its inbox is the other way in, and the two together are the polling fallback ADR-0003 promises an Agent with
no webhook URL. It takes up one Run at a time, gives the session a working directory, and lets the model read
the Issue and its Documents, write the Document the State asks for, narrate through `runs_post_activity`, and
stop at a Gate.

A Run stopped at a Gate is not the runtime's any more. deevy moves it back to `active` the moment a Human
rules and tells the Agent so, and that Notification is what hands it back — so the runtime never polls a Gate
and never asks the same question twice. A rejected Gate comes back with the note, and the next session is
told to read it and revise rather than to ask again.

Whatever the session does, the Run does not rot. A session that crashes, hangs or simply stops gets an error
Activity and a failed Run, because a Run left `active` and silent tells a Human nothing until the sweep calls
it `stale` half an hour later.

### What it produces

A Run that changed files gets a branch named after the attempt, a commit, a push, and a pull request. The
pull request's URL becomes a Link on the Issue carrying the Run's id, which is what makes "this pull request
came from that attempt" a fact rather than a coincidence, and a comment on the Issue names both. Nothing is
ever pushed to the base branch. A Run that changed nothing attaches nothing.

### Its configuration

"Read by" says which process a variable reaches: the runtime itself, or the session of one harness
(`DEEVY_AGENT_HARNESS`). A variable read by a harness is passed into that session's environment and by no
other, and the runtime refuses to start when a harness's required one is missing.

| Variable                                                       | Read by                        | Default                  | Without it                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEEVY_URL`                                                    | the runtime                    | —                        | It will not start, and says so. The deevy origin, with no trailing slash.                                                                                                                                                                                                       |
| `DEEVY_AGENT_KEY`                                              | the runtime                    | —                        | It will not start. The Agent's API key, and the whole of the runtime's identity.                                                                                                                                                                                                |
| `DEEVY_AGENT_HARNESS`                                          | the runtime                    | `claude-code`            | Nothing: which coding-agent CLI works the Runs. The runtime refuses to start on a name it does not know, or a binary it cannot run.                                                                                                                                             |
| `ANTHROPIC_API_KEY`                                            | `claude-code`                  | —                        | With `claude-code`, every session fails at once unless the CLI is signed in some other way. Read by Claude Code, not by the runtime.                                                                                                                                            |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, … | `opencode`                     | —                        | The provider keys OpenCode reads, passed into its session by name (the list is `providerVariables` in its recipe); any other provider's goes through `DEEVY_AGENT_PASS_ENV`. Without one, every Run fails with the provider's own error.                                        |
| `COPILOT_GITHUB_TOKEN`                                         | `copilot`                      | —                        | The runtime refuses to start. A fine-grained token with the Copilot Requests permission and **no repository permission**, and never the same value as `DEEVY_AGENT_GIT_TOKEN`: the session's shell runs under it, and a token that can push is a push the denylist cannot stop. |
| `CURSOR_API_KEY`                                               | `cursor`                       | —                        | The runtime refuses to start. Cursor's API key, from cursor.com; the desktop app's login is not shared with the CLI.                                                                                                                                                            |
| `DEEVY_AGENT_POLL_SECONDS`                                     | the runtime                    | 30                       | Nothing: it asks every thirty seconds, backing off to eight times that while there is nothing to do.                                                                                                                                                                            |
| `DEEVY_AGENT_RUN_TIMEOUT_SECONDS`                              | the runtime                    | 1800                     | Nothing. It matches deevy's own stale window: a session allowed to outlive it would be called stale while working.                                                                                                                                                              |
| `DEEVY_AGENT_MODEL`                                            | every harness                  | `claude-opus-5`          | Nothing.                                                                                                                                                                                                                                                                        |
| `DEEVY_AGENT_EFFORT`                                           | `claude-code`                  | `high`                   | Nothing. `low`, `medium`, `high`, `xhigh` or `max`; anything else is read as `high`.                                                                                                                                                                                            |
| `DEEVY_AGENT_MAX_TURNS`                                        | `claude-code`, `opencode`      | 100                      | Nothing: a backstop on a session that will not stop. The timeout is the real bound.                                                                                                                                                                                             |
| `DEEVY_AGENT_REPO`                                             | the runtime                    | — no repository          | The session gets deevy's tools and an empty directory: no files, no shell, no web. Setting it grants all three.                                                                                                                                                                 |
| `DEEVY_AGENT_GIT_TOKEN`                                        | the runtime                    | —                        | A public repository can be cloned and nothing can be pushed, so no Run delivers anything.                                                                                                                                                                                       |
| `DEEVY_AGENT_BASE_BRANCH`                                      | the runtime                    | `main`                   | Nothing: the branch every Run starts from.                                                                                                                                                                                                                                      |
| `DEEVY_AGENT_GITHUB_API`                                       | the runtime                    | `https://api.github.com` | Nothing, unless the repository is on GitHub Enterprise or the acceptance run's local stub.                                                                                                                                                                                      |
| `DEEVY_AGENT_GITHUB_REPO`                                      | the runtime                    | read from the clone URL  | Nothing, unless the clone URL is not a github.com one: without a slug a Run pushes its branch and opens no pull request.                                                                                                                                                        |
| `DEEVY_AGENT_SESSION_UID`                                      | the runtime                    | 10002                    | Nothing, in the image: the user each session runs as, so it cannot read the supervisor's environment. Zero, or a runtime that is not root, means the session shares the supervisor's user and can read the Agent's key and the git token out of `/proc`.                        |
| `DEEVY_AGENT_SESSION_GID`                                      | the runtime                    | 10002                    | Nothing: the group that goes with it.                                                                                                                                                                                                                                           |
| `DEEVY_AGENT_WORKDIR`                                          | the runtime                    | the system temporary     | Nothing: where per-Run working directories are made.                                                                                                                                                                                                                            |
| `DEEVY_AGENT_PASS_ENV`                                         | the runtime, for every session | —                        | Nothing: a comma-separated list of extra environment variables the session may see, on top of the allowlist. For a proxy, a private registry, or a custom CA.                                                                                                                   |
| `DEEVY_AGENT_WEBHOOK_SECRET`                                   | the runtime                    | — no deliveries          | It polls, and refuses every delivery. Set it to the secret the Agent's webhook URL was given.                                                                                                                                                                                   |
| `DEEVY_AGENT_PORT`                                             | the runtime                    | 8787                     | Nothing: `/healthz` always, and deevy's deliveries when a secret is set.                                                                                                                                                                                                        |

### What is bounded, and what is not

**Issue text is untrusted input.** Descriptions, Documents, comments and other Agents' Activities are written
by anyone with access to the Project, and all of it reaches a session that — with a repository configured —
holds a shell. No prompt makes that safe. What bounds it is structural, and it is worth knowing exactly what
each part does:

- **The session is its own user, and that is the boundary.** The supervisor runs as root in the container so
  it can spawn each session as `session` (uid 10002); the working directory and the session's home are
  handed to that user, and the supervisor's own environment, files and `/proc` entry are outside what a shell
  in the session can read. On one user they are not: a session reads the Agent's key and the git token out of
  `/proc`, whatever the allowlist below hands it, which is what ADR-0019 was written about. Run it with
  `--cap-drop=ALL --cap-add=SETUID --cap-add=SETGID --cap-add=CHOWN --cap-add=DAC_OVERRIDE` — four, each
  measured: two to become the session, `CHOWN` to hand it its working directory, and `DAC_OVERRIDE` to read
  and clean up what it wrote. With only the first two the runtime fails at its first Run. A runtime that is not root — a laptop, or a container
  run with `--user` — keeps its old shape, says so in its first lines, and has no boundary at all: fine for
  trying it out, not a way to run it against a Workspace other people write in.
- **The tool list is the surface.** Tools are granted by name, never by wildcard, so deevy gaining a
  twenty-first tool does not widen what the runtime may do. `settingSources` is empty and `strictMcpConfig`
  is on, so a `.mcp.json` or a `.claude/settings.json` in the cloned repository configures nothing.
- **The session sees only the environment it is given.** Its process gets an allowlist — enough to run a
  process and for git to find its own configuration, plus `ANTHROPIC_*` — and nothing else. That is an
  allowlist rather than a list of secrets to remove, because a denylist can only exclude what somebody thought
  of: the first version removed `DEEVY_AGENT_KEY` and the git token and passed everything else, so a session
  with a shell inherited every other credential the operator happened to have. Name anything it genuinely
  needs in `DEEVY_AGENT_PASS_ENV`. The Agent's own key is the sharpest case — a shell plus that key is every
  operation the Agent may call, over `curl`, including the ones deliberately left out of the tool list — and
  the session never holds it at all: it reaches deevy through a loopback proxy the runtime opens for each
  Run, which adds the key on the way out, offers only the twelve tools the runtime grants, and refuses any
  other tool before deevy hears of it. A refusal is written into the Run's feed as an error Activity. A shell
  that finds the proxy's port gets those twelve tools and nothing else, which is the allowlist and not a hole.
- **The credential is the supervisor's, and the session runs git anyway.** `origin` in the clone is a
  loopback address: the supervisor serves the remote there and adds the token on the way out, so the session
  branches, commits and pushes as it likes while its checkout holds no credential and its `.git/config` has
  nothing to find. **Where an Agent can push is the scope of the token you issue and whatever your forge
  protects, and nothing else.** The runtime does not restrict it: `git push`, `git remote`, `git config` and
  `gh` are not denied, and an Agent can move the base branch, force-push included, with no Gate in the way —
  a Gate governs the State an Issue is in, not a ref (ADR-0019). Give it a token scoped to one repository,
  protect the branches that matter, and read the Run's feed: every ref a Run moved is an Activity naming the
  branch, both commits, and whether history was rewritten.
- **A Gate is the last line.** An Agent can never approve one (ADR-0004), so nothing an agent proposes ships
  without a Human deciding it did.

What is _not_ bounded: a session with a shell can run whatever the repository's own build runs, reach the
network, and spend tokens. Give the runtime a repository you would give a new contractor, and read the pull
requests.

### Harnesses

Which coding-agent CLI works the Runs is `DEEVY_AGENT_HARNESS`, and each image carries one
([docs/harnesses.md](./harnesses.md), ADR-0018). The bounds above hold for every harness: the container,
the environment allowlist, the proxy holding the key and the tool list, the git credential the session
never sees, and the Gate. What differs is how each CLI grants its own tools and what it reads from disk,
and that is what each paragraph below says, in the words its recipe ships (`bounds` in
`apps/agent/src/harness/<name>.ts`).

**Claude Code** is granted its tools by name (`--allowedTools`), refuses anything else rather than asking (`--permission-prompts none`), loads no settings from disk (`--setting-sources ""`) and no MCP server but the runtime's proxy (`--strict-mcp-config`); `.mcp.json` and `.claude/` are removed from the clone before it starts, and `CLAUDE.md` is read as input. A refused tool is a `permission_denied` message in its stream, which the runtime writes into the Run's feed. Not bounded: what `Bash` runs in the repository, the network, and tokens.

**OpenCode** is granted its tools by name in an inline `permission` block where everything else is `deny` and nothing is `ask` (in `run`, an `ask` is auto-rejected and ends the turn), reads no project configuration (`OPENCODE_DISABLE_PROJECT_CONFIG`, with `opencode.json`, `opencode.jsonc` and `.opencode/` removed from the clone as well), loads no plugins (`--pure`), and connects to no MCP server but the runtime's proxy; `AGENTS.md` and `CLAUDE.md` are read as input. A refused tool is an errored `tool_use` in its stream carrying OpenCode's own sentence about the rule, which the runtime writes into the Run's feed as a denial. Not bounded: what `bash` runs in the repository, the network, and tokens; and the provider key is in the session's environment, as every harness's is.

**Cursor CLI** runs under `--force`, which applies edits and runs commands instead of proposing them and allows every tool a deny rule does not name, so the fence is the `permissions.deny` list the runtime writes into the session's own `~/.cursor/cli-config.json`: nothing when there is a repository, since the session runs git and where it may push is the token's scope and the forge's own protections (ADR-0019), and every file, shell and web tool when there is not. Nothing on disk configures the session: the clone's `.cursor/` is removed before it starts (a project `.cursor/cli.json` would otherwise _replace_ the deny list, and a `.cursor/mcp.json` would be trusted by `--approve-mcps`), `--disable-project-configs` refuses it anyway, and the only MCP server is the runtime's proxy, with no header. A refused tool is a `tool_call` completed with a `rejected` result and the CLI's own sentence, "Command is not allowed", which the runtime writes into the Run's feed. Not bounded: what `Shell` runs in the repository, the network, tokens (usage is reported, cost is not), and `DEEVY_AGENT_EFFORT`, which this harness does not read.

**GitHub Copilot CLI** is granted its tools by name (`--allow-tool`) and, in `-p` without `--allow-all-tools`, refuses anything else automatically rather than asking (`--no-ask-user`); the built-in GitHub MCP server is off (`--disable-builtin-mcps`) so the only server it reaches is the runtime's proxy, the session is not exported to GitHub (`--no-remote-export`), and the token is stripped from the shell it runs and redacted from output (`--secret-env-vars`). Nothing on disk configures the session: the working directory is left untrusted, which is what stops Copilot loading a repository's `.mcp.json`, `.github/mcp.json`, hooks or plugins, so no strip list is needed; `.github/copilot-instructions.md` and `AGENTS.md` are read as input. A refused tool is a `tool.execution_complete` with `error.code` `denied` in the JSON stream, which the runtime writes into the Run's feed. Not bounded: what `shell` runs in the repository, the network, and tokens; and Copilot's JSON stream reports premium-request counts and durations, not token or dollar totals, so a Run worked by Copilot carries no usage into its summary.

### What it costs

Nothing here is measured, and these are the knobs that move the bill rather than numbers to plan against.

| Knob                              | Which way                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DEEVY_AGENT_MODEL`               | The largest single lever.                                                                              |
| `DEEVY_AGENT_EFFORT`              | Thinking depth per session. `xhigh` suits code work; `low` suits a runtime that only writes Documents. |
| `DEEVY_AGENT_RUN_TIMEOUT_SECONDS` | The ceiling on one Run. A session stopped at the timeout has still spent what it spent.                |
| `DEEVY_AGENT_REPO`                | A repository means file and shell tools, which means longer sessions.                                  |
| `CURSOR_API_KEY`                  | `cursor`                                                                                               | —   | The runtime refuses to start. Cursor's API key, from cursor.com; the desktop app's login is not shared with the CLI. |
| `DEEVY_AGENT_POLL_SECONDS`        | Costs deevy requests, not tokens. A poll that finds nothing spends nothing.                            |

Runs are triggered by assignment, mention, a workflow rule, or an Agent's schedule. A schedule on an Agent is
the one that can spend money while nobody is watching.

## The volume

Everything is in one SQLite file under `/data`. Migrations are applied at startup, so a new image on an old
volume upgrades itself. Mount a named volume or a host directory; do not mount the file itself, because SQLite
writes `-wal` and `-shm` alongside it.

deevy runs as uid 65532 and `/data` must belong to it. A **named volume created fresh** takes its ownership
from the image and needs nothing. A **host directory** does not: `chown -R 65532:65532` it before the first
start, or deevy will be able to read it and not write it. So will a volume written by a release before
v0.8.0, which ran as root — see [Upgrading](#upgrading).

## The schema, on either runtime

One schema, two appliers, two journals (ADR-0008). Nothing is shared between them, because nothing needs to
be: a D1 database is only ever migrated by wrangler, and a SQLite file only ever by the Node migrator.

| What                | Node                                 | Workers                                       |
| ------------------- | ------------------------------------ | --------------------------------------------- |
| Where the rows live | `DEEVY_DATABASE_PATH`, a SQLite file | the `DB` binding, a D1 database               |
| What is applied     | `packages/db/drizzle/<folder>/`      | `packages/db/migrations/NNNN_<folder>.sql`    |
| Who applies it      | the migrator, at startup             | `wrangler d1 migrations apply deevy`, by hand |
| Record of what ran  | `__drizzle_migrations`               | wrangler's own `d1_migrations`                |
| If it never runs    | the server exits at startup          | every request fails on a missing table        |

`packages/db/migrations` is a build artifact, not a source: `vp run db#generate:d1` writes it from
`packages/db/drizzle`, `vp run db#generate` chains the two, and `vp run db#check:migrations` fails CI on a
stale one exactly as a stale `openapi.json` does. `apps/web/wrangler.jsonc` points the `DB` binding at it
through `migrations_dir`, and `vp run db#check:d1` applies it to an empty local D1 and checks that what
wrangler built is the schema `packages/db/src/schema` describes. None of that needs a Cloudflare account.

The projection is not a copy. drizzle separates statements with `--> statement-breakpoint`; the emitter turns
those into plain statement separation and refuses, naming the file and the line, anything D1 will not honour:
transaction control, `ATTACH`, `DETACH`, `VACUUM`, and every `PRAGMA`. The PRAGMA is the one that matters.
D1 runs a batch inside a transaction, where SQLite ignores `PRAGMA foreign_keys` outright — so the
`PRAGMA foreign_keys=OFF` that drizzle wraps around a table rebuild, and that the Node migrator honours at
the connection, does nothing on D1, the rebuild's `DROP TABLE` cascades the children away, and wrangler
reports success. Better to fail while generating.

`apps/web/wrangler.jsonc` names the database and deliberately gives no `database_id`. Local D1 works from the
name alone, and the first `wrangler deploy` provisions a database of that name and remembers which one it is,
so there is nothing to paste back into the configuration and nothing account-specific in an open-source
repository — step 3 of [Deploying to a free account](#deploying-to-a-free-account).

## Upgrading

```bash
docker pull ghcr.io/WeAreNendo/deevy:v0.7.1
docker stop deevy && docker rm deevy
docker run -d --name deevy ... ghcr.io/WeAreNendo/deevy:v0.7.1   # same -v deevy-data:/data
```

### Coming from a release before v0.8.0

Those images ran as root, so everything on the volume belongs to root; v0.8.0 runs as uid 65532. Give it the
volume once, with the container stopped:

```bash
docker run --rm -v deevy-data:/data alpine chown -R 65532:65532 /data
```

If you forget, deevy says so and stops: it checks that it can write `/data` before it opens the database,
and names that exact command in the error. It does not start and then fail later, which is what it would do
if it only found out at the first write — the migrations are already applied and nothing else writes at
startup, so a root-owned volume would otherwise carry it all the way to `healthy`. The command is
idempotent; run it if you are unsure.

Releases before v0.7.1 were published under `ghcr.io/mattallty/deevy`, deevy's home before it moved to the
WeAreNendo organisation. Those tags stay where they are and nothing newer lands beside them, so an install
still pulling from there is pinned to the last release made before the move until its image path changes.

Take a backup first (below). Migrations only ever move forward: there is no down migration, so restoring a
backup is how you go back.

**From an image built on Better Auth 1.7.0 to 1.7.2**, which is every tag before the pin moved to 1.7.3 on
2026-09-06: migration `0024` drops the `account.issuer` column and its unique index, which 1.7.3 no longer
writes (its release restored the 1.6 account schema). The Node migrator applies it at startup like any other.
On Workers, run `wrangler d1 migrations apply deevy --remote` **before** deploying the new Worker: while the
`NOT NULL` column is still there, 1.7.3 refuses every new sign-up and every account link, and existing
sessions carry on as if nothing were wrong.

## Backup and restore

`sqlite3 .backup` takes a consistent copy of a live database, which copying the file does not. The runtime
image is distroless and has no `sqlite3` binary — no shell either — so run it from a small sidecar against
the same volume:

```bash
docker run --rm -v deevy-data:/data -v "$PWD:/out" alpine \
  sh -c 'apk add --no-cache sqlite >/dev/null && sqlite3 /data/deevy.sqlite ".backup /out/deevy-$(date +%F).sqlite"'
```

Restoring is the reverse, with the container stopped so nothing is mid-write:

```bash
docker stop deevy
docker run --rm -v deevy-data:/data -v "$PWD:/in" alpine \
  sh -c 'rm -f /data/deevy.sqlite-wal /data/deevy.sqlite-shm && cp /in/deevy-2026-09-03.sqlite /data/deevy.sqlite \
         && chown 65532:65532 /data/deevy.sqlite'
docker start deevy
```

Deleting the `-wal` and `-shm` files matters: leaving a stale write-ahead log next to a restored database
gives SQLite two disagreeing versions of the truth.

The `chown` matters for the same reason the one in [Upgrading](#upgrading) does: the sidecar writes as root
and deevy runs as uid 65532. Without it deevy refuses to start and names the command, which is better than
the alternative but still a restore that does not come back up.

## Health

`/healthz` answers `{"ok":true}` as soon as the server is listening and the migrations have run, which makes
it a usable readiness probe. The image asks it of itself every 30 seconds, so `docker ps` reports `healthy`
with nothing configured; `docker inspect -f '{{json .State.Health}}' deevy` says what the last few answers
were. It follows `DEEVY_PORT`, so moving the port keeps it working.

If it answers at all the server can write its database: that is checked before the listener binds, so a
volume deevy cannot write is a container that exited rather than a healthy one that cannot save anything.
`/api/docs` serves the API reference.
