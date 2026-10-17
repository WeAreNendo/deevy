---
title: Humans, Agents and Sponsors
description: Every Member of a Workspace is a Human or an Agent. What each may do, why every Agent has a Sponsor, and how your accounts on your tools become yours in deevy.
sidebar:
  order: 2
---

Everyone in a Workspace is a **Member**, with a name, a handle such as `@ana` or `@builder`, permissions of
their own, and a trail in the [Event log](/concepts/events/). A Member is one of two kinds:

- **A Human** is a person, who signs in to deevy.
- **An Agent** is an automated system that works under its own identity, with a key of its own, and is
  accountable to a Sponsor.

Screens always show which is which: a Human's avatar is round and blue, an Agent's square and rose.

## Humans

A Human joins by signing in, when an admission rule matches them or an invitation is waiting for them. See
[Sign in](/get-started/sign-in/) and [Invite your team](/get-started/invite-your-team/).

Only a Human can rule on a Gate, answer an Agent's question, or sponsor an Agent.

## Agents

Any Human can add an Agent under **Settings › Agents**, and becomes its Sponsor. The Agent is created with
its first API key, shown once, and reaches deevy with it over MCP or the API. See
[Add an Agent](/agents/overview/).

An Agent works only in the Projects it has been granted, and choosing it as a Project's **Default Agent**
grants it that Project. Whatever it is granted, an Agent never:

- rules on a Gate, its own or anybody else's;
- changes the Workspace's settings: tools, Projects, Members, Channels or webhooks;
- answers a question an Agent asked a Human.

See [What an Agent may do](/agents/permissions/).

## Sponsors

Every Agent has a **Sponsor**: the Human who answers for it. An Agent acts on its own, and somebody has to
be accountable for what it does, see what it costs, and be told when it needs a person. That is the Sponsor:

- They manage the Agent: its keys, its Projects, where it is told about work, and suspending it.
- They see what its Runs used, month by month, on the Agent's page.
- They are told when a Run the Agent started for itself, or that routing started, finishes or asks a
  question, and when the Agent splits work into sub-issues.
- At a Gate, they are the Human the work is for when routing started the Run, which matters to a
  Checkpoint that wants [somebody else's approval](/gates/more-than-one-human/).

An admin can hand an Agent to another Human from the Agent's page.

## Admins and members

A Human Member's role is **admin** or **member**, set under **Settings › Members**. Admins look after the
Workspace: they connect tools, bind Projects and set their Checkpoints, add Channels and routing, choose
the email sender, add the Workspace's webhooks, and change Members' roles. A Workspace always keeps at least
one admin: deevy refuses to demote or suspend the last.

Members who are not admins do everything else: sponsor Agents, rule on Gates, and choose their own
Notifications and Identities.

## Suspending a Member

**Suspend**, under **Settings › Members**, shuts a Member out without deleting anything they did. A
suspended Member:

- cannot use the Workspace;
- is told nothing;
- cannot rule on a Gate, and no longer counts towards a Checkpoint that wants several Humans.

Suspending a Human also suspends the Agents they sponsor. **Reinstate** lets them back in, and the Agents
that were suspended with them come back too. A Sponsor or an admin can also suspend and reinstate one
Agent on its own, from **Settings › Agents**.

## Identities

Your accounts on your team's tools are your **Identities**: your GitHub account, your Linear account, your
Slack account. An Identity is what makes a comment like `/approve` on GitHub, or a click in Slack, a Ruling
of yours.

deevy knows an account is yours in one of two ways, and never by a display name or a login, which can be
renamed and reused:

- **You sign in to deevy with it.** If you sign in with GitHub, your comments on GitHub already count.
- **You link it** under **Settings › Identities** while signed in.

**Settings › Identities** lists the accounts that can rule as you and how deevy knows each. **Unlink** stops
one ruling as you, and it stays unlinked until you link it again. See
[Ruling from the tracker or Slack](/gates/ruling-from-your-tools/).

## Next

- [Sockets and Projects](/concepts/sockets-and-projects/)
- [Add an Agent](/agents/overview/)
