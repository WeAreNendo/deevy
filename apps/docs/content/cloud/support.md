---
title: Support
description: How to reach the deevy Cloud team, what to tell us, and what we can and cannot see of your Workspace.
sidebar:
  order: 6
---

## Reaching us

- **Anything about your Workspace or your account**: write to
  [support@deevy.dev](mailto:support@deevy.dev). A Workspace that won't open, an upgrade that didn't
  finish, a suspension you didn't expect, a question about your invitation: this is where it goes.
- **Your data and your privacy**: write to [privacy@deevy.dev](mailto:privacy@deevy.dev), to ask what we
  hold about you, to come off the waitlist, or to have your deevy Cloud account removed. We answer within
  30 days.
- **A bug in deevy**: deevy is open source, and its issues are on GitHub, at
  [WeAreNendo/deevy](https://github.com/WeAreNendo/deevy/issues). They are public, so leave out anything
  from inside your Workspace, and never paste a key or an export.
- **What is inside a Workspace** is its team's, so a Member's question about it goes to the Workspace's
  admins ([Where your data lives](/cloud/where-your-data-lives/)).

Whatever you write about, these help us most: your Workspace's address, what you did, what you saw (the
exact message, if there was one), roughly when, and the version at the foot of any Settings page.

## What we can see of your Workspace

**Nobody at deevy signs in as one of your Members, joins your Workspace, or reads it through the app.**
We work from what you tell us and show us, and from three things that hold nothing from inside it:

- **Its status**: which version it runs, whether its last upgrade finished, and its counts (Humans,
  Agents, Sockets, today's invitations and emails, and this month's Runs). Never its content.
- **Logs**, which name the Workspace and the address a request was for, and carry nothing from its
  database.
- **A count of requests**, per Workspace: what kind each was, how it ended and how long it took, and
  nothing about who made it.

There are two ways anyone here could read a Workspace's database. The first is Cloudflare's own view
into it. Only a data steward may open it, and today that is one named person. A data steward opens your
Workspace only with the written consent of the person who asked for it, given for one problem; reads
only what that problem needs; copies nothing out; and records what they looked at, and why. The second
is its [nightly backups](/cloud/where-your-data-lives/#backups), and today only that same person can
read them. Everyone else with access to deevy Cloud's Cloudflare account has a role that can see
neither.

## When something goes wrong

- **An upgrade that doesn't finish.** An upgrade applies to your Workspace whole or not at all. If it
  fails, your Workspace answers **This Workspace is being upgraded. Try again in a minute.** while we fix
  it, the console shows **Needs attention** on it, and every other Workspace carries on. We tell you
  plainly what is happening.
- **A Workspace we suspend.** We may suspend a Workspace for abuse, at its team's request, or when what
  it does is hurting other Workspaces, such as the email they share. Nothing in it is touched. The
  console then says **This Workspace is suspended: nobody can use it until it is resumed. Write to
  support@deevy.dev if you didn't expect this.**
- **An incident.** If something goes wrong that affects your Workspace, we tell you plainly, as soon as
  we have something true to say.
