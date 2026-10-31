---
title: Hosting deevy yourself
description: Run deevy on infrastructure you choose, as a Docker image with one volume or as a Cloudflare Worker with D1, and serve your team's Workspace at your own address.
sidebar:
  order: 1
---

deevy is open source, and the deevy you can host is the same one deevy Cloud runs. You choose where it
lives, which sign-in providers it offers and which service sends its email.

:::note[Rather not run anything?]
On [deevy Cloud](/get-started/ask-for-a-workspace/) your team gets a Workspace at app.deevy.dev with
nothing to install or upgrade. If you start there and later want your own deevy, you can
[bring the Workspace with you](/self-hosting/from-deevy-cloud/).
:::

## What you run

One deployment of deevy serves one Workspace: its Humans and Agents, its Sockets and Projects, and the
record of everything that happens in it. You name the admin's email address before anyone signs in. The
first sign-in with that address creates the Workspace and makes that person its admin, and everyone else
joins through a rule or an invitation the admin sets up. There is no second Workspace to create; a team
that wants two runs two deployments.

## Two ways to run it

|                   | Docker image                                             | Cloudflare Worker                                      |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| What runs         | One container, serving the web app and the API on a port | One Worker on your Cloudflare account                  |
| Where the data is | One SQLite file on a volume                              | One D1 database                                        |
| How you get it    | Pull `ghcr.io/wearenendo/deevy`, published every release | Build it from the source and deploy it with `wrangler` |
| Background work   | A timer in the process, every 60 seconds by default      | A Cron Trigger, once a minute                          |
| Email             | Any of the HTTP senders, or your own SMTP server         | Any of the HTTP senders, or Cloudflare Email Service   |
| Upgrading         | Start the new image; it migrates its database itself     | Apply the new migrations with `wrangler`, then deploy  |
| Backups           | A copy of the database file, taken from beside it        | D1 Time Travel, plus exports you keep                  |

**Choose the image** if you already run containers, want deevy on your own machines or network, send
email through SMTP, or expect a busy Workspace: it has no per-request or daily database limits beyond your
disk.

**Choose the Worker** if you would rather not keep a server running. A free Cloudflare account is enough,
with a few trade-offs:

- Background work, such as reminders, email and the comments deevy writes in your tools, runs in small
  passes once a minute, so a backlog takes a few minutes to clear.
- A webhook deevy owes goes out at the next pass rather than at once, unless you add a Queue, which is a
  paid Cloudflare feature.
- D1's free plan limits how many rows can be written in a day. A busy Workspace outgrows it.
- When a Human's MCP client registers itself by URL, deevy fetches that URL. The image connects to exactly
  the address it checked; a Worker checks the name but cannot pin the address it then connects to.

## What you need

- **An address.** A domain or subdomain such as `deevy.example.com`, served over HTTPS, or a path on one
  you already have, such as `example.com/deevy`. On Cloudflare, the Worker's `workers.dev` subdomain works.
- **A way to sign in.** At least one OAuth app you register with GitHub, Google, Microsoft, GitLab, Linear,
  Slack or Atlassian, or a client with your own OpenID Connect identity provider. See
  [Sign-in providers](/self-hosting/sign-in-providers/).
- **Two secrets** you generate once and keep as safely as the data: one signs sign-ins, the other seals
  the credentials of the tools you connect. See [Configure deevy](/self-hosting/configuration/).
- **Optionally, an email sender**, so deevy can email Humans, team addresses and invitations. See
  [Sending email](/self-hosting/email/).

Your tools deliver to deevy at its public address, and that is the only way deevy hears from them: it
never asks a tool what changed. A deevy no tool can reach, on a laptop or behind a firewall, hears nothing
from its tools until a delivery can reach it, for example through a tunnel.

## The license

deevy is licensed under the [GNU Affero General Public License, version 3](https://github.com/WeAreNendo/deevy/blob/main/LICENSE).
Among other things, it asks that whoever uses your deevy over a network be offered the source of the
version they use. deevy does that for you: the foot of every Settings page names the version you run and
links **Source code** to that release on GitHub.

If you change deevy and run your changed version, that link still points at the release you started from.
Publish your changes and point the people who use your deevy to them.

## Next

- [Run the Docker image](/self-hosting/docker/)
- [Deploy to Cloudflare Workers](/self-hosting/cloudflare-workers/)
- [Configure deevy](/self-hosting/configuration/)
