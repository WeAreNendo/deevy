---
title: Health and monitoring
description: Check that a self-hosted deevy is up and which version it runs, read its logs, and see what it is configured to offer.
sidebar:
  order: 10
---

## Is it up?

`/healthz` answers with the version deevy runs:

```bash
curl https://deevy.example.com/healthz
# {"ok":true,"version":"0.11.2"}
```

It needs no session, and under a path it answers at the root of the host as well as under the path.

**On the Docker image**, it answers once the server is listening and its migrations have run, and only
when deevy can write its database: that is checked before the server starts listening. So it makes a good
readiness probe, and a volume deevy can't write shows up as a container that exited rather than a
healthy one that can't save anything.

**On a Worker**, it answers as soon as the Worker is deployed, whether or not the migrations have been
applied. After a deploy, `wrangler d1 migrations list deevy --remote` says whether any are still owed.

## The image's own health check

The image asks `/healthz` of itself every 30 seconds, so `docker ps` shows `healthy` with nothing
configured, and Compose's `depends_on` with `condition: service_healthy` works. To see its last few
answers:

```bash
docker inspect -f '{{json .State.Health}}' deevy
```

It follows `DEEVY_PORT`, so moving the port keeps it working.

## What it offers

`GET /api/health/ping` is public too, and says more about how this deevy is set up:

- `version`, as above.
- `providers`, the sign-in providers it offers, in the order the sign-in page shows them. A provider you
  meant to configure that is missing here is missing one of its values.
- `devSignIn` and `devSockets`, which are `false` unless a development stand-in is on. Both should be
  `false` in production.

## Logs

**On the Docker image**, deevy logs to standard output and standard error, so `docker logs deevy` has it
all. What to look for:

- `deevy listening on …` once it has started.
- Why it refused to start, when it does: a `/data` it can't write, with the command that fixes it; an
  email sender set up halfway, naming what is missing; a development stand-in under production.
- A warning when its database carries migrations from a newer release, after
  [going back one release](/self-hosting/upgrading/#going-back-one-release).
- A line when your own identity provider couldn't be reached at startup.

**On a Worker**, deevy's configuration turns on Cloudflare's Workers Logs, so its logs are on the Worker's
page in Cloudflare's dashboard, and `wrangler tail` follows them live from `apps/web`. `wrangler tail`
doesn't reliably show the Cron Trigger's runs, so a quiet tail doesn't mean the schedule has stopped.

## Inside deevy

An admin sees the rest in Settings:

- **Settings › Event log** is the Workspace's whole record, newest first. A webhook or an email deevy gave
  up on is recorded there.
- **Settings › Email** says which sender is in use, what is wrong with it if anything, and sends a test
  email.

The API reference for this deevy is at `/api/docs`.
