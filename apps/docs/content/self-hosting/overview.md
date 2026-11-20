---
title: Hosting deevy yourself
description: Run deevy on a machine of your own, as a Docker image with one volume, and serve your team's Workspace at your own address.
sidebar:
  order: 1
---

deevy is open source, and the deevy you can host is the same one deevy Cloud runs. You choose where it
lives and which sign-in providers it offers.

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

## How it runs

deevy is one Docker image, `ghcr.io/wearenendo/deevy`, published with every release. Run it wherever you
already run containers, on your own machines or network.

- **One container** serves the web app and the API on one port.
- **One volume** holds the data: a single SQLite file.
- **Background work**, such as the comments deevy writes in your tools and the Gates it posts in chat,
  runs on a timer inside the container, every 60 seconds by default.
- **Upgrading** is starting the new image, which migrates its database itself.
- **A backup** is a copy of the database file, taken from beside it.

## What you need

- **An address.** A domain or subdomain such as `deevy.example.com`, served over HTTPS, or a path on one
  you already have, such as `example.com/deevy`.
- **A way to sign in.** At least one OAuth app you register with GitHub, Google or Microsoft, or a client
  with your own OpenID Connect identity provider. See
  [Sign-in providers](/self-hosting/sign-in-providers/).
- **Two secrets** you generate once and keep as safely as the data: one signs sign-ins, the other seals
  the credentials of the tools you connect. See [Configure deevy](/self-hosting/configuration/).

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
- [Configure deevy](/self-hosting/configuration/)
