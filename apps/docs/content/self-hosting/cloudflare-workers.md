---
title: Deploy to Cloudflare Workers
description: Build deevy as a Cloudflare Worker with a D1 database, deploy it to your own account, and sign in as its admin.
sidebar:
  order: 3
---

On Cloudflare, deevy is one Worker that serves the web app and the API, one D1 database that holds the
Workspace, and a Cron Trigger that runs its background work every minute. A free account is enough to
start.

You build the Worker from the source and deploy it yourself with `wrangler`, Cloudflare's command line.
Nothing deploys it for you.

## What you need

- A Cloudflare account.
- A checkout of [deevy's source](https://github.com/WeAreNendo/deevy) at the release you want to run.
- [Vite+](https://viteplus.dev), which deevy builds with: `curl -fsSL https://vite.plus | bash`, then open
  a new shell. It brings the Node version deevy needs.

```bash
git clone https://github.com/WeAreNendo/deevy.git
cd deevy
git checkout v0.11.2   # the release you want
vp install
```

The checkout carries its own `wrangler`. The commands below that start with `wrangler` run from
`apps/web`, so it finds deevy's configuration; run them as `vp exec wrangler …`, or with a `wrangler` of
your own.

## Deploy it

1. **Build the Worker and check it.** From the repository's root:

   ```bash
   vp run web#build:workers
   vp run web#check:workers
   ```

   The check is a dry run of the deploy. It ends with `--dry-run: exiting now.` and lists the bindings it
   found, among them `env.DB (deevy)`, a D1 database. A failure here is a deploy that would have failed.

   Always build before you deploy: a deploy uploads whatever the last build produced.

2. **Sign in to Cloudflare**, from `apps/web`:

   ```bash
   wrangler login
   wrangler whoami   # the account everything below lands in
   ```

3. **Deploy once.** This creates the database and tells you the Worker's address:

   ```bash
   wrangler deploy
   ```

   On the first deploy, `wrangler` finds a D1 database named `deevy` that doesn't exist yet and creates it
   before uploading. There is no `wrangler d1 create` step and no database id to copy anywhere: the next
   deploy finds the same database. It then prints the Worker's URL, `https://deevy.<subdomain>.workers.dev`,
   and the Cron Trigger it registered.

   `https://deevy.<subdomain>.workers.dev/healthz` now answers with the version, and the web app loads.
   Signing in doesn't work yet.

4. **Build the database's schema.** The database is empty until you apply the migrations:

   ```bash
   wrangler d1 migrations apply deevy --remote
   wrangler d1 migrations list deevy --remote   # says there is nothing left to apply
   ```

   The first command lists every migration, asks you to confirm, and reports each one applied. Applying
   twice changes nothing.

5. **Register a sign-in provider** with the Worker's address. For GitHub, that is an OAuth App with
   `https://deevy.<subdomain>.workers.dev` as its homepage and
   `https://deevy.<subdomain>.workers.dev/api/auth/callback/github` as its callback. See
   [Sign-in providers](/self-hosting/sign-in-providers/) for the others.

6. **Put in the configuration.** Each command prompts for its value:

   ```bash
   wrangler secret put BETTER_AUTH_URL        # https://deevy.<subdomain>.workers.dev
   wrangler secret put BETTER_AUTH_SECRET     # openssl rand -base64 32
   wrangler secret put DEEVY_SECRET           # openssl rand -base64 32 again: a different value
   wrangler secret put DEEVY_ADMIN_EMAIL      # you@example.com
   wrangler secret put GITHUB_CLIENT_ID
   wrangler secret put GITHUB_CLIENT_SECRET
   ```

   A secret takes effect by itself within a few seconds; you don't deploy again for it.
   `wrangler secret list` shows the names you set, never the values, so keep your own copy of the two
   secrets with your backups.

7. **Sign in** at the Worker's address with the account whose email is `DEEVY_ADMIN_EMAIL`. That first
   sign-in creates the Workspace and makes you its admin; **Settings › Members** lists you as its only
   Member.

To let your team in, add a rule or an invitation under **Settings › General**. See
[Who may join](/self-hosting/sign-in-providers/#who-may-join).

## Settings that aren't secret

Everything can be a secret, and a secret and a plain variable reach deevy the same way. If you'd rather
keep settings that aren't credentials where a reviewer can read them, add a `vars` block to
`apps/web/wrangler.jsonc`:

```jsonc
"vars": { "DEEVY_WORKSPACE_NAME": "Acme", "DEEVY_SIGN_IN_ORDER": "github,google" },
```

A `vars` block is part of what the build reads, so after changing it, build and check again from the
repository's root, then `wrangler deploy` from `apps/web`. If your copy of the source is public, keep
`DEEVY_ADMIN_EMAIL` a secret: it is somebody's address.

[Configure deevy](/self-hosting/configuration/) goes through the settings in order, and
[Environment variables](/reference/environment/) lists them all.

## Your own domain

To serve deevy at your own domain rather than `workers.dev`, add a custom domain to the Worker in
Cloudflare. Then change `BETTER_AUTH_URL` and every sign-in provider's callback to the new address, together:
either one alone leaves sign-in refused by the provider, or signed in on an address nobody visits.

A GitHub OAuth App holds one callback URL, so pick one address to sign in on. A Google client and a GitLab
application take a list.

To serve it under a path of a domain, such as `example.com/deevy`, see
[Behind a proxy or under a path](/self-hosting/under-a-path/).

## Optional additions

### Deliver webhooks at once, with a Queue

Without a Queue, a webhook deevy owes goes out at the next Cron pass, within a minute. With one, it goes out
as soon as it is owed. Queues are a paid Cloudflare feature, which is why deevy's configuration leaves it
out. To add one, put this in `apps/web/wrangler.jsonc`:

```jsonc
"queues": {
  "producers": [{ "binding": "JOBS", "queue": "deevy-jobs" }],
  "consumers": [{ "queue": "deevy-jobs", "max_batch_size": 10, "max_retries": 10 }],
},
```

Create the queue with `wrangler queues create deevy-jobs`, then build, check and deploy. Keep
`max_retries` at eight or more, so the Queue doesn't give up on a delivery before deevy would.

### Send email through Cloudflare

Cloudflare Email Service is one of the senders deevy can use, and only on Workers. See
[Sending email](/self-hosting/email/#cloudflare-email-service).

## What a free account gives you

- **Background work runs once a minute**, Cloudflare's finest schedule, in small passes. A backlog clears
  twenty rows a minute rather than all at once.
- **The live view reconnects every minute.** D1 limits how many queries one request may make, so an open
  page's stream of updates ends after `DEEVY_STREAM_SECONDS` and picks up where it left off. Nobody sees
  the seam.
- **D1 limits the rows written per day.** A busy Workspace reaches the free plan's limit long before
  anything else. Cloudflare's D1 limits page has the current numbers.
- **No Queues**, so webhooks wait for the next Cron pass, as above.

## Next

- [Configure deevy](/self-hosting/configuration/)
- [Upgrading](/self-hosting/upgrading/): migrations first, then the deploy.
- [Backup and restore](/self-hosting/backup-and-restore/#on-cloudflare-workers), with D1 Time Travel.
