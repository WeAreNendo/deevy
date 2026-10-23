---
title: Configure deevy
description: The settings a self-hosted deevy needs, in the order you set them, and how to set them on the Docker image and on a Worker.
sidebar:
  order: 4
---

deevy is configured with environment variables. The names are the same on the Docker image and on a
Worker, and so is what they do. This page takes the ones you need in the order you need them;
[Environment variables](/reference/environment/) lists every one.

## How you set them

**On the Docker image**, set them in the container's environment: an `--env-file` for `docker run`, or
`env_file` or `environment` in Compose. The server reads them when it starts, so a change takes effect when
the container is recreated, for example with `docker compose up -d`.

**On a Worker**, set a credential with `wrangler secret put NAME`, which takes effect within a few seconds
with no deploy. Anything else can be a secret too, or a `vars` entry in `apps/web/wrangler.jsonc`, which
takes effect with the next build and deploy. See
[Settings that aren't secret](/self-hosting/cloudflare-workers/#settings-that-arent-secret).

## Its address

`BETTER_AUTH_URL` is where your team opens deevy, such as `https://deevy.example.com`. It has to be the
address the browser actually visits, character for character, including `https://`.

Everything follows from it: each sign-in provider's callback, the cookie that keeps you signed in, the
links deevy puts in Slack messages and emails, the address each tool delivers to, and the address MCP
clients and the CLI sign in against. Left unset, deevy follows the address each request came to, which is
wrong as soon as a proxy in front of it changes the host, and it signs no tokens for MCP clients or the
CLI at all, because then a caller could choose whom they are for.

To serve deevy under a path, put the path in it: `https://example.com/deevy`. See
[Behind a proxy or under a path](/self-hosting/under-a-path/).

:::caution[Changing it later]
A new address means new callbacks with every sign-in provider, and pointing your tools, Agents, CLI and
MCP clients at it. The list in
[Point everything at the new address](/self-hosting/from-deevy-cloud/#point-everything-at-the-new-address)
is the same one.
:::

## Its two secrets

Generate each with `openssl rand -base64 32`, once, and keep them with your backups. They must be
different values.

- **`BETTER_AUTH_SECRET`** signs sessions and the links deevy sends, such as an email's unsubscribe link,
  and seals the sign-in providers' tokens and the keys deevy signs MCP clients' and the CLI's tokens
  with. Without it, deevy doesn't run: the Docker image exits at start, and a Worker answers its API and
  `/healthz` with an error that names it. Changing it signs everybody out, and those clients get no new
  tokens until you delete the old keys (`DELETE FROM jwks;`); each then signs in again.
- **`DEEVY_SECRET`** seals what deevy holds for the tools you connect, a key saved under **Settings ›
  Email**, and an invitation's link until it is emailed. It must be at least 32 characters. Without it,
  deevy refuses to connect a tool that needs a credential, and doesn't email invitations.

They are separate so that you can sign everybody out without losing your tools' credentials. Losing `DEEVY_SECRET`
does lose something: every tool has to be connected again.

## Its admin

`DEEVY_ADMIN_EMAIL` is the address of the person who becomes the Workspace's admin. Their first sign-in
creates the Workspace; until somebody signs in with it, there is no Workspace and nobody can join. The
address only counts when the sign-in provider has verified it; see
[Which addresses count](/self-hosting/sign-in-providers/#which-addresses-count).

`DEEVY_WORKSPACE_NAME` is the name the Workspace starts with, `deevy` if you don't set it. An admin can
rename it later under **Settings › General**.

## A way to sign in

Set the client ID and secret of at least one sign-in provider, such as `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET`. deevy offers a provider when both halves are set, and the sign-in page draws one
button for each. With none, the sign-in page says so instead of offering a button that goes nowhere.

[Sign-in providers](/self-hosting/sign-in-providers/) covers registering each one, the order they appear
in, and who may join.

## Email, if you want it

Without a sender, deevy emails nobody, and the inbox and Slack work as before. To send email, set
`DEEVY_EMAIL_SENDER`, `DEEVY_EMAIL_FROM` and that sender's own variables, or let an admin choose one under
**Settings › Email**. See [Sending email](/self-hosting/email/).

## Anything else

The rest have defaults that suit most teams:

| If you want to…                                          | Set                            |
| -------------------------------------------------------- | ------------------------------ |
| Connect a GitHub Enterprise Server instead of github.com | `DEEVY_GITHUB_API`             |
| Change how long a quiet tool waits before deevy asks it  | `DEEVY_SOCKET_CATCHUP_MINUTES` |
| Change how long a silent Run takes to count as stale     | `DEEVY_RUN_STALE_MINUTES`      |
| Change how often an undecided Gate reminds its approvers | `DEEVY_GATE_REMINDER_HOURS`    |
| Change the order of the sign-in buttons                  | `DEEVY_SIGN_IN_ORDER`          |
| Share sign-in apps with other deevys                     | `DEEVY_SIGN_IN_RELAY_*`        |
| Serve the web app from an address of its own             | `DEEVY_WEB_ORIGIN`             |

What the Workspace lets in, who is invited, which Projects and Agents it has, and where Notifications go
are not configuration: an admin sets them in **Settings**.

## What never goes in production

The variables that start with `DEEVY_DEV_STUB_` replace sign-in, a tool or email with stand-ins for trying
deevy on a laptop. The Docker image refuses to start with the sign-in, tool and email stand-ins on. A
Worker can't tell it is in production, so leave them unset there; `GET /api/health/ping` reports
`devSignIn` and `devSockets` as `false` when they are off.
