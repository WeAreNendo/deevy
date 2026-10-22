---
title: Run the Docker image
description: Start deevy from its published image with one volume, configure it with an environment file, and sign in as its admin.
sidebar:
  order: 2
---

The image holds all of deevy: the server, the web app and the database migrations, answering on one port.
Your data lives in one volume.

## The image

The image is `ghcr.io/wearenendo/deevy`, published for `linux/amd64` and `linux/arm64` with every release.
It is public, so pulling it needs no account and no `docker login`.

| Tag                 | What it is                                                                    |
| ------------------- | ----------------------------------------------------------------------------- |
| `latest`            | The newest release. A pre-release never moves it.                             |
| `0.11.2`, `v0.11.2` | That release, with or without the `v`.                                        |
| `0.12.0-rc.1`       | A pre-release, such as this one, publishes under its own version's tags only. |

Use `latest` to try deevy out, and pin a version once your team relies on it, so that an upgrade happens
when you choose. See [Upgrading](/self-hosting/upgrading/).

A few things about the image that shape how you run it:

- **It has no shell.** It is built on a distroless Node base and carries nothing else: no shell, no package
  manager, no `curl`. There is no `docker exec … sh`. Anything that needs a shell, such as a backup, runs
  in a small container of its own beside the same volume.
- **It doesn't stay root.** It starts as root only long enough to make `/data` its own, then runs as an
  unprivileged user for good. See [The volume](#the-volume).
- **It checks its own health.** `docker ps` shows `healthy` once it answers, with nothing configured.
- **It speaks plain HTTP on port 3000.** Put a reverse proxy that terminates TLS in front of it, and read
  [Behind a proxy or under a path](/self-hosting/under-a-path/) for what the proxy must pass through.

To build the same image from a checkout of [the source](https://github.com/WeAreNendo/deevy), run this from
the repository's root, as the release does:

```bash
docker build -f apps/server/Dockerfile -t deevy:local .
```

## Before you start

1. **Choose its address**, the URL your team will open, such as `https://deevy.example.com`. This is
   `BETTER_AUTH_URL`, and it has to be exactly what the browser visits.
2. **Register a sign-in provider** with that address in its callback URL. GitHub is the quickest: an OAuth
   App with the callback `https://deevy.example.com/api/auth/callback/github`. See
   [Sign-in providers](/self-hosting/sign-in-providers/) for it and the others.
3. **Generate two secrets**, once:

   ```bash
   openssl rand -base64 32   # for BETTER_AUTH_SECRET
   openssl rand -base64 32   # for DEEVY_SECRET, a different value
   ```

## Start it

Put the configuration in a file, `deevy.env`, and keep it out of version control:

```bash
BETTER_AUTH_URL=https://deevy.example.com
BETTER_AUTH_SECRET=<the first value>
DEEVY_SECRET=<the second value>
DEEVY_ADMIN_EMAIL=you@example.com
DEEVY_WORKSPACE_NAME=Acme
GITHUB_CLIENT_ID=<from your OAuth App>
GITHUB_CLIENT_SECRET=<from your OAuth App>
```

Then start deevy with it:

```bash
docker run -d --name deevy --restart unless-stopped \
  -p 3000:3000 \
  -v deevy-data:/data \
  --env-file deevy.env \
  ghcr.io/wearenendo/deevy:latest
```

:::caution[Generate the secrets once]
Don't write `$(openssl rand -base64 32)` into the `docker run` command itself. Each new container would
get new secrets, which signs everybody out and leaves every connected tool's credentials unreadable.
:::

Check that it is up:

```bash
curl http://localhost:3000/healthz
# {"ok":true,"version":"0.11.2"}
```

### With Docker Compose

The same deployment as a `compose.yaml`, beside `deevy.env`:

```yaml
services:
  deevy:
    image: ghcr.io/wearenendo/deevy:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - deevy-data:/data
    env_file: deevy.env

volumes:
  deevy-data:
```

Start it with `docker compose up -d`. Leave out a `healthcheck`: the image carries its own, and one in
Compose would replace it. Another service that needs deevy running can wait for it with
`depends_on: { deevy: { condition: service_healthy } }`.

## The volume

Everything deevy keeps is one SQLite file, `/data/deevy.sqlite`, with the `-wal` and `-shm` files SQLite
writes beside it. Mount a named volume or a host directory at `/data`. Never mount the database file on its
own, because SQLite needs to write next to it.

Neither needs anything done to it first. deevy starts as root, makes `/data` its own, and gives up root
before it loads anything else. It then runs as:

- **The owner of `/data`**, when that isn't root. A host directory you made, such as `/srv/deevy`, stays
  yours, and deevy writes its files as you. A named volume created fresh, like `deevy-data` above, belongs
  to uid 65532.
- **uid 65532**, when `/data` belongs to root, as a host directory Docker created for you does. deevy gives
  the directory to that user first.

Either way, a database somebody else wrote there, such as one you restored from a backup, is given to the
same user when deevy starts. Nothing else in `/data` is changed.

### Without ever being root

To keep deevy from starting as root at all, tell Docker which user to run it as:

```bash
docker run -d --name deevy --user 65532:65532 ...
```

In Compose that's `user: "65532:65532"`, and on Kubernetes `runAsUser: 65532`, with `fsGroup: 65532` so the
volume is writable. deevy then changes nothing, so `/data` has to be writable by that user already. A named
volume created fresh is. If it isn't, deevy exits before it opens the database, and its log names the
command that fixes it.

The volume and the two secrets belong together: a copy of the database without `DEEVY_SECRET` can't open
the credentials of the tools you connected. See [Backup and restore](/self-hosting/backup-and-restore/).

## Sign in as the admin

1. Open your address, `https://deevy.example.com`.
2. Sign in with the provider you configured, using the account whose email is `DEEVY_ADMIN_EMAIL`. It has
   to be an address the provider has verified; see
   [Which addresses count](/self-hosting/sign-in-providers/#which-addresses-count).

That first sign-in creates the Workspace and makes you its admin. **Settings › Members** lists you as its
only Member, and **Settings › Event log** starts with the Workspace being created.

To let your team in, add a rule or an invitation under **Settings › General**. See
[Who may join](/self-hosting/sign-in-providers/#who-may-join).

## Next

- [Configure deevy](/self-hosting/configuration/): every setting, in the order you need them.
- [Connect a tool](/tools/overview/), then [add an Agent](/agents/overview/). The reference runtime that
  runs an Agent is an image of its own; see [The reference runtime](/agents/reference-runtime/).
- [Backup and restore](/self-hosting/backup-and-restore/), before the Workspace holds anything you'd miss.
