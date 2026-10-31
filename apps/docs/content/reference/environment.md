---
title: Environment variables
description: Every variable a self-hosted deevy reads, on the Docker image and on a Cloudflare Worker, with its default and what it does.
sidebar:
  order: 1
---

A self-hosted deevy is configured with these variables. Each name means the same thing on the Docker image
and on a Worker; where one only applies to one of them, it says so.

- **On the Docker image**, they are the container's environment. They are read when the server starts.
- **On a Worker**, put credentials in with `wrangler secret put NAME`, which takes effect within seconds.
  Anything else may be a secret too, or a `vars` entry in `apps/web/wrangler.jsonc`, which takes effect
  with the next build and deploy.

[Configure deevy](/self-hosting/configuration/) takes the essential ones in the order you set them.

## Core

| Variable               | Default              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_URL`      | The request's origin | Where your team opens deevy, exactly as the browser sees it, such as `https://deevy.example.com`. A path in it is where deevy lives. Sign-in callbacks, the session cookie, links and the address MCP clients sign in against all follow from it. Unset, deevy follows the address each request came to, which is wrong behind a proxy that changes the host; MCP clients and the CLI can't sign in, and Slack deliveries wait.        |
| `BETTER_AUTH_SECRET`   | None                 | **Credential.** Signs sessions and the links deevy sends, and seals sign-in providers' tokens. Generate it with `openssl rand -base64 32`. Unset, deevy doesn't run: the Docker image exits at start, and a Worker answers its API and `/healthz` with an error that names it. Changing it signs everybody out, and MCP clients and the CLI get no new tokens until you delete the OAuth signing keys it sealed (`DELETE FROM jwks;`). |
| `DEEVY_SECRET`         | None                 | **Credential.** Seals the credentials of the tools you connect, a sender key saved under **Settings › Email**, and invitation links until they are emailed. At least 32 characters, and a different value from `BETTER_AUTH_SECRET`. Unset, deevy can't connect a tool that holds a credential, and doesn't email invitations. Losing it means connecting every tool again.                                                            |
| `DEEVY_ADMIN_EMAIL`    | None                 | The address that becomes the Workspace's admin. Its first verified sign-in creates the Workspace. Unset, no Workspace is created and nobody can join.                                                                                                                                                                                                                                                                                  |
| `DEEVY_WORKSPACE_NAME` | `deevy`              | The name the Workspace starts with. An admin can rename it under **Settings › General**.                                                                                                                                                                                                                                                                                                                                               |
| `DEEVY_WEB_ORIGIN`     | None                 | Only when the web app is served from an origin of its own. deevy then accepts that origin's calls and builds the links it hands a Human on it. Both the image and the Worker serve the web app themselves, so they don't need it.                                                                                                                                                                                                      |

## Sign-in providers

A provider is offered when both its client ID and secret are set; your own identity provider also needs
its issuer, and is offered only if deevy could read its discovery document as it started. Every callback is `${BETTER_AUTH_URL}/api/auth/callback/<provider>`. The client secrets are
credentials. See [Sign-in providers](/self-hosting/sign-in-providers/).

| Variable                   | Default              | What it does                                                                                                                                                                                |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_CLIENT_ID`         | None                 | A GitHub OAuth App's client ID. Callback ends in `github`.                                                                                                                                  |
| `GITHUB_CLIENT_SECRET`     | None                 | **Credential.** Its client secret.                                                                                                                                                          |
| `GOOGLE_CLIENT_ID`         | None                 | A Google OAuth client's ID. Callback ends in `google`.                                                                                                                                      |
| `GOOGLE_CLIENT_SECRET`     | None                 | **Credential.** Its client secret.                                                                                                                                                          |
| `MICROSOFT_CLIENT_ID`      | None                 | A Microsoft Entra ID application's client ID. Callback ends in `microsoft`.                                                                                                                 |
| `MICROSOFT_CLIENT_SECRET`  | None                 | **Credential.** Its client secret.                                                                                                                                                          |
| `MICROSOFT_TENANT_ID`      | `common`             | Whose accounts Microsoft sign-in takes: `common` for work, school and personal accounts, `organizations` for work and school only, or one directory's ID for that directory only.           |
| `GITLAB_CLIENT_ID`         | None                 | A GitLab application's ID. Callback ends in `gitlab`.                                                                                                                                       |
| `GITLAB_CLIENT_SECRET`     | None                 | **Credential.** Its secret.                                                                                                                                                                 |
| `GITLAB_ISSUER`            | `https://gitlab.com` | Where your GitLab is, for a self-managed one, such as `https://gitlab.example.com`.                                                                                                         |
| `LINEAR_CLIENT_ID`         | None                 | A Linear OAuth application's client ID. Callback ends in `linear`. A Linear sign-in joins by invitation only.                                                                               |
| `LINEAR_CLIENT_SECRET`     | None                 | **Credential.** Its client secret.                                                                                                                                                          |
| `SLACK_CLIENT_ID`          | None                 | A Slack app's client ID, for Sign in with Slack. Callback ends in `slack`.                                                                                                                  |
| `SLACK_CLIENT_SECRET`      | None                 | **Credential.** Its client secret.                                                                                                                                                          |
| `ATLASSIAN_CLIENT_ID`      | None                 | An Atlassian app's client ID. Callback ends in `atlassian`. An Atlassian sign-in joins by invitation only.                                                                                  |
| `ATLASSIAN_CLIENT_SECRET`  | None                 | **Credential.** Its secret.                                                                                                                                                                 |
| `DEEVY_OIDC_ISSUER`        | None                 | Your OpenID Connect provider's issuer, where it publishes `/.well-known/openid-configuration`. Read once, when deevy starts. Callback ends in `oidc`.                                       |
| `DEEVY_OIDC_CLIENT_ID`     | None                 | The client ID deevy has with your identity provider.                                                                                                                                        |
| `DEEVY_OIDC_CLIENT_SECRET` | None                 | **Credential.** Its client secret.                                                                                                                                                          |
| `DEEVY_OIDC_NAME`          | `Single sign-on`     | What its button says after **Continue with**, such as `Acme SSO`.                                                                                                                           |
| `DEEVY_SIGN_IN_ORDER`      | None                 | Provider ids to offer first, comma-separated, such as `oidc,github`. The rest follow in the usual order: `github`, `google`, `microsoft`, `gitlab`, `linear`, `slack`, `atlassian`, `oidc`. |

## Signing in through a relay

For several deevys sharing one set of sign-in apps. See
[Several deevys, one set of apps](/self-hosting/sign-in-providers/#several-deevys-one-set-of-apps).

| Variable                     | Default | What it does                                                                                                                                                                                                        |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEEVY_SIGN_IN_RELAY_SECRET` | None    | **Credential.** The secret the relay and every deevy behind it share. Without it, a deevy neither is a relay nor signs in through one.                                                                              |
| `DEEVY_SIGN_IN_RELAY_URL`    | None    | On a deevy that signs in through a relay: the relay's address, which is the relay deevy's `BETTER_AUTH_URL` followed by `/relay`. Every relayed app's callback is `${DEEVY_SIGN_IN_RELAY_URL}/callback/<provider>`. |
| `DEEVY_SIGN_IN_RELAY_ALLOW`  | None    | On the relay: the addresses it may send a sign-in back to, as comma-separated URL prefixes with at least a `/` after the host, such as `https://team-a.example.com/`.                                               |

## Email

Without `DEEVY_EMAIL_SENDER`, deevy sends no email, and an admin may still choose a sender under
**Settings › Email**. See [Sending email](/self-hosting/email/).

| Variable                    | Default    | What it does                                                                                                                                                                                                                          |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEEVY_EMAIL_SENDER`        | None       | `resend`, `postmark`, `sendgrid`, `mailgun`, `ses`, `smtp` (Docker only) or `cloudflare` (Workers only). Set up halfway, it stops the Docker image at startup; a Worker stays up and says what is missing under **Settings › Email**. |
| `DEEVY_EMAIL_FROM`          | None       | Required with a sender: the address deevy sends as, such as `deevy <deevy@example.com>`, on a domain the sender has verified.                                                                                                         |
| `RESEND_API_KEY`            | None       | **Credential.** For `resend`.                                                                                                                                                                                                         |
| `POSTMARK_SERVER_TOKEN`     | None       | **Credential.** For `postmark`.                                                                                                                                                                                                       |
| `POSTMARK_MESSAGE_STREAM`   | `outbound` | For `postmark`: the message stream to send on.                                                                                                                                                                                        |
| `SENDGRID_API_KEY`          | None       | **Credential.** For `sendgrid`: a key with Mail Send.                                                                                                                                                                                 |
| `MAILGUN_API_KEY`           | None       | **Credential.** For `mailgun`.                                                                                                                                                                                                        |
| `MAILGUN_DOMAIN`            | None       | For `mailgun`: the sending domain, such as `mg.example.com`.                                                                                                                                                                          |
| `MAILGUN_REGION`            | `us`       | For `mailgun`: `eu` for a domain in Mailgun's EU region.                                                                                                                                                                              |
| `AWS_SES_REGION`            | None       | For `ses`: the region your sending identities are verified in.                                                                                                                                                                        |
| `AWS_SES_ACCESS_KEY_ID`     | None       | **Credential.** For `ses`: an IAM key that may `ses:SendEmail` and nothing else.                                                                                                                                                      |
| `AWS_SES_SECRET_ACCESS_KEY` | None       | **Credential.** For `ses`: that key's secret.                                                                                                                                                                                         |
| `SMTP_URL`                  | None       | **Credential.** For `smtp`, Docker only: `smtps://user:password@host:465`, or `smtp://user:password@host:587`, which upgrades with STARTTLS.                                                                                          |

## Tools

| Variable           | Default                  | What it does                                                                                                                                                      |
| ------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEEVY_GITHUB_API` | `https://api.github.com` | The GitHub API a GitHub Socket talks to when it names none of its own. For a GitHub Enterprise Server, its API root, such as `https://github.example.com/api/v3`. |

## Timing

| Variable                       | Default | What it does                                                                                                                                                                                                                |
| ------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEEVY_RUN_STALE_MINUTES`      | `30`    | How long a Run may be silent before it counts as stale. Its next Activity undoes it.                                                                                                                                        |
| `DEEVY_GATE_REMINDER_HOURS`    | `4`     | How often a Gate nobody has ruled on asks its approvers again.                                                                                                                                                              |
| `DEEVY_SWEEP_INTERVAL_SECONDS` | `60`    | Docker only: how often background work runs, such as reminders, email, webhooks and the comments deevy writes in your tools. On a Worker, the Cron Trigger in `apps/web/wrangler.jsonc` runs it every minute.               |
| `DEEVY_STREAM_SECONDS`         | `60`    | Workers only: how long an open page's stream of updates lasts before it reconnects. The stream asks D1 every two seconds, against a limit on queries per request, so a value much over 90 leaves it none for anything else. |

## The Docker image

The image sets the first three itself; you rarely need to change them.

| Variable               | Default                                  | What it does                                                                                                             |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `DEEVY_PORT`           | `3000`                                   | The port the server listens on, and the image's health check asks. Without it the server reads `PORT`, then uses `3000`. |
| `DEEVY_DATABASE_PATH`  | `/data/deevy.sqlite` in the image        | The SQLite database file. Outside the image, `./data/deevy.sqlite`.                                                      |
| `DEEVY_WEB_DIST`       | `/app/web` in the image                  | Where the built web app is. Unset, the server answers the API and serves no pages.                                       |
| `DEEVY_MIGRATIONS_DIR` | The migrations shipped beside the server | Where the server reads its migrations from. Leave it unset.                                                              |
| `NODE_ENV`             | `production` in the image                | Under `production`, the server refuses to start with a development stand-in on.                                          |

## The Worker's bindings

These are bindings in `apps/web/wrangler.jsonc` rather than variables.

| Binding  | What it is                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB`     | The D1 database, named `deevy`. The first `wrangler deploy` creates it.                                                                              |
| `ASSETS` | The built web app.                                                                                                                                   |
| `JOBS`   | Optional: a Queue, so a webhook goes out the moment it is owed rather than at the next Cron pass. Queues are a paid feature, so deevy leaves it out. |
| `EMAIL`  | Optional: the `send_email` binding for `DEEVY_EMAIL_SENDER=cloudflare`. Commented out until you want it.                                             |

## Development only

These replace a real service with a stand-in, for trying deevy on a laptop with no OAuth app, no tool and
no email account. **Never set them in production.** The Docker image refuses to start with the sign-in, tool
or email stand-in on; a Worker can't tell it is in production, so leave them unset there.

| Variable                    | Default      | What it does                                                                                                                                 |
| --------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEEVY_DEV_STUB_OAUTH`      | None         | Docker only. `1` makes every sign-in provider a stand-in that signs in whatever address it is given.                                         |
| `DEEVY_DEV_STUB_SOCKETS`    | None         | `1` adds a stand-in tool, a tracker inside deevy itself, that a Socket can connect to with no app and no tunnel.                             |
| `DEEVY_DEV_STUB_CONTAINERS` | `acme/deevy` | What that stand-in tool holds: container names, comma-separated. Read only with `DEEVY_DEV_STUB_SOCKETS`.                                    |
| `DEEVY_DEV_STUB_EMAIL`      | None         | `1` sends email to a stand-in instead of a sender, when no sender is set; on the Docker image, what it was asked to send is at `/dev/email`. |

`GET /api/health/ping` reports `devSignIn` and `devSockets`; both are `false` when the stand-ins are off.
