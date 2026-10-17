---
title: Export your Workspace, or take it home
description: Download a deevy Cloud Workspace whole, with the two secrets that open it, and move it to a deevy you host yourself.
sidebar:
  order: 4
---

Your Workspace belongs to your team, and leaving is a button, not a request. The export is the whole
Workspace in one file: its Members, its Agents and their keys, its Sockets and their credentials, its
Projects, Runs and Gates, and its Event log.

## Export it

1. Sign in to the deevy Cloud console at [app.deevy.dev](https://app.deevy.dev/).
2. Under **Your Workspaces**, choose **Manage** on the Workspace.
3. Under **Take it home**, choose **Export**.

Your browser saves a file named `deevy-<address>-<date>.json`. Only the person who asked for the
Workspace can export it, and every export is recorded.

The export is the Workspace as it was at that moment: anything written afterwards stays in the hosted
copy only. To be sure nothing is, export it after you [delete it](/cloud/delete-a-workspace/): for the 30
days a Workspace is being deleted, nobody can use it, and you can still export it.

## What the file holds

- `dump`: the Workspace's whole database, as SQL.
- `betterAuthSecret` and `deevySecret`: the Workspace's two secrets.
- `howTo`: the steps for taking it home, in brief.
- Its name, its address and when you exported it.

## Why the secrets matter

Parts of your Workspace are sealed or signed with its two secrets, and only those two open them again:

- the first signed its sessions, its signing keys and the links it sent;
- the second sealed its Sockets' credentials, its invitation links, and an email sender's key if you
  set one.

Neither can be replaced with a new one. Without the second, nothing your Sockets hold can be read, and
every tool has to be connected again. Both were made for your Workspace alone, so they open nothing
else.

The file is your Workspace and the keys to it. Keep it as safe as a password.

## Take it home

A deevy you host yourself, on the Docker image or a Cloudflare Worker of your own, imports the file's
dump and runs with its two secrets. [Bringing a Workspace from deevy Cloud](/self-hosting/from-deevy-cloud/)
walks through it.

Your Workspace then has a new address, which deevy can't announce to the rest of the world for you. So
after the import you point everything at it:

- **Signing in.** Register sign-in apps of your own with GitHub, Google or whichever you offer: the ones
  deevy Cloud uses work only at app.deevy.dev. Everybody signs in again and lands on their own Member.
- **Agents.** Point each one at the new address. Their keys keep working.
- **The CLI and MCP clients.** Sign in again at the new address.
- **Your tools.** A GitHub Socket's page has **Point GitHub at this address**, which moves its App's
  webhook for you. Linear, GitLab, Notion and Slack keep theirs in their own settings, where you change
  them.

Both copies keep working until you delete the hosted one, and nothing forwards from one to the other.
Once the new one works, [delete the hosted Workspace](/cloud/delete-a-workspace/), so that nothing still
pointed at the old address, such as an Agent somebody forgot, goes on working against the copy you left.
