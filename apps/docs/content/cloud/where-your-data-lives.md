---
title: Where your data lives
description: A deevy Cloud Workspace is stored in the EU, in a database of its own. What passes outside the EU, who processes your data, and how long it is kept.
sidebar:
  order: 2
---

## Your Workspace

Each Workspace has a database of its own, which no other Workspace shares: its Members, its Agents and
their keys, its Sockets, Projects, Runs and Gates, what it keeps from your tools, and its Event log. That
database is created in the EU and stays there, and the deevy that reads and writes it runs there too.

The credentials your Sockets hold, such as a GitHub App's private key, are sealed under a secret made
for your Workspace alone. That secret is stored nowhere, and no backup contains it.

## Backups

Every night from 03:00 UTC, each running Workspace is copied whole to backup storage in the EU, and each copy is
kept for 30 days. Beside those copies, the database keeps 30 days of its own history, so it can be put
back as it was at a moment within them.

## The deevy Cloud console

These are kept in a database in the EU too:

- your deevy Cloud account: your name, email address and picture, as GitHub or Google gave them, and
  the tokens they gave when you signed in, sealed;
- the sessions you sign in with, each with the browser it was in and, where the request carried it,
  your IP address;
- the Workspaces you asked for, and a record of what you did with them in the console: asking for one,
  exporting it, deleting it and bringing it back;
- the beta's invitations and the waitlist.

## What passes outside the EU

- **The network.** A request reaches Cloudflare's network at the data centre nearest whoever made it,
  wherever that is. That is where its encryption in transit (TLS) ends, and where deevy reads which
  Workspace the request is for before passing it on to that Workspace in the EU.
- **The directory of addresses.** What turns a Workspace's address into its database is copied
  worldwide. It holds the address, an internal key and whether the Workspace is running, and nothing
  from inside it.
- **Request logs.** Cloudflare keeps logs of requests for a few days. They name the Workspace and the
  address a request was for, which can hold a record's key such as `acme/deevy#42`, and carry nothing
  else from its database.
- **Signing in.** You sign in with GitHub or Google, so whichever you choose knows that you signed in
  to deevy.
- **Email.** Your Workspace's email (Notifications, Gates, invitations) is sent through Cloudflare's email
  service, from `notifications@mail.deevy.dev`, unless an admin sets a sender of your own under
  **Settings › Email**. Each message then goes to its recipient's mailbox, wherever that is.
- **Your tools and your Agents.** What deevy writes back to GitHub, Linear, GitLab, Notion or Slack is
  kept by those tools, where they keep it. Your Agents run wherever you run them, and what they read
  from your Workspace goes with them.

## Who decides, and who processes it

What is inside a Workspace (its Members, its Runs and Gates, what it keeps from your tools) is your
team's: your team decides what happens to it, and we process it on your behalf. In the GDPR's words,
your team is the controller and deevy the processor. A question about it, from one of your Members say,
goes to your Workspace's admins.

Your deevy Cloud account and the waitlist are ours to look after, so ask us about them, at
[privacy@deevy.dev](mailto:privacy@deevy.dev).

The services that process data for deevy Cloud:

| Service    | What for                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------ |
| Cloudflare | Hosting, storage and backups, DNS, and sending email.                                            |
| GitHub     | deevy's source code and the pipelines that build and release it. No Workspace data reaches them. |

GitHub and Google as sign-in providers are not on that list: which one you sign in with is your own
choice of identity, not something we process your data with.

## How long it is kept

- **A Workspace**: until you delete it. Then you have 30 days to bring it back, and its last backup is
  kept 30 days more ([Delete a Workspace](/cloud/delete-a-workspace/)).
- **The waitlist**: until you're invited, or ask us to forget you.
- **Your deevy Cloud account**: until you ask us to remove it.
