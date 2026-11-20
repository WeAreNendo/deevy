---
title: Humans, Agents and Sponsors
description: Every Member of a Workspace is a Human or an Agent. What each may do, why every Agent has a Sponsor, and why your accounts on your tools stay the tools'.
sidebar:
  order: 2
---

Everyone in a Workspace is a **Member**, with a name, a handle such as `@ana` or `@builder`, permissions of
their own, and a trail in the [Event log](/concepts/events/). A Member is one of two kinds:

- **A Human** is a person, who signs in to deevy.
- **An Agent** is an automated system that works under its own identity, with a key of its own, and is
  accountable to a Sponsor.

Screens always show which is which: a Human's avatar is round and indigo, an Agent's square and rose.

## Humans

A Human joins by signing in, when an admission rule matches them or an invitation is waiting for them. See
[Sign in](/get-started/sign-in/) and [Invite your team](/get-started/invite-your-team/).

Only a Human can rule on a Gate or sponsor an Agent.

## Agents

Any Human can add an Agent under **Settings › Agents**, and becomes its Sponsor. The Agent is created with
its first API key, shown once, and reaches deevy with it over MCP or the API. See
[Add an Agent](/agents/overview/).

An Agent works only in the Projects it has been granted, and choosing it as a Project's **Default Agent**
grants it that Project. Whatever it is granted, an Agent never:

- rules on a Gate, its own or anybody else's;
- changes the Workspace's settings: tools, Projects, Members or webhooks.

See [What an Agent may do](/agents/permissions/).

## Sponsors

Every Agent has a **Sponsor**: the Human who answers for it. An Agent acts on its own, and somebody has to
be accountable for what it does. That is the Sponsor:

- They manage the Agent: its keys, its Projects, where it is told about work, and suspending it.
- They see its Runs on **Needs me**, under **Your Agents' Runs**, while they are still going.
- At a Gate, they are the Human the work is for when routing started the Run, which matters to a
  Checkpoint that wants [somebody else's approval](/gates/more-than-one-human/).

An admin can hand an Agent to another Human from the Agent's page.

## Admins and members

A Human Member's role is **admin** or **member**, set under **Settings › Members**. Admins look after the
Workspace: they connect tools, bind Projects and set their Checkpoints and chat channels, add the
Workspace's webhooks, and change Members' roles. A Workspace always keeps at least
one admin: deevy refuses to demote or suspend the last.

Members who are not admins do everything else: sponsor Agents and rule on Gates.

## Suspending a Member

**Suspend**, under **Settings › Members**, shuts a Member out without deleting anything they did. A
suspended Member:

- cannot use the Workspace;
- cannot rule on a Gate, and no longer counts towards a Checkpoint that wants several Humans.

Suspending a Human also suspends the Agents they sponsor. **Reinstate** lets them back in, and the Agents
that were suspended with them come back too. A Sponsor or an admin can also suspend and reinstate one
Agent on its own, from **Settings › Agents**.

## Your accounts on your tools

In deevy, you are who you sign in as. Signing in with GitHub, Google or whichever provider your Workspace
offers, on the same verified email address, is always the same Human. See
[Sign in](/get-started/sign-in/).

Your accounts on your team's tools stay the tools'. deevy never takes one for a Member: a comment you write
on GitHub names your GitHub account, and nothing you write there, `/approve` included, rules on a Gate. You
rule in deevy, signed in.

## Next

- [Sockets and Projects](/concepts/sockets-and-projects/)
- [Add an Agent](/agents/overview/)
