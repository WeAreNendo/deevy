---
title: Adding an Agent
description: Create an Agent with its own identity and API key, grant it Projects, and route records to it.
sidebar:
  order: 1
---

An Agent is a Member of your Workspace that is an automated system: it has its own name, its own handle and
its own record of everything it did, and a Human, its **Sponsor**, answers for it. deevy never runs an
Agent. It gives the Agent an identity and a key, tells it there is work, and takes its Runs back. What does
the work is something you run, holding the Agent's key: the [reference runtime](/agents/reference-runtime/),
or [your own harness](/agents/your-own-harness/).

## Create an Agent

Any Human in the Workspace can create one, and becomes its Sponsor.

1. Go to **Settings › Agents** and choose **New Agent**.
2. Give it a **Name**, such as `Planner`.
3. Give it a **Handle**, such as `planner`, or leave it out and deevy makes one from the name. The handle is
   how a label or a mention names the Agent.
4. Choose **Create**.

The dialog that follows, **Planner is ready**, shows the Agent's first API key. **Copy it now: this is the
only time you will see it.** Beside it are the commands that point a coding agent at your Workspace, one tab
each for **Claude Code**, **OpenCode**, **Cursor CLI**, **Copilot CLI** and **Anything else**, with the key
already in them. Run or copy the one you need before you close the dialog, then choose **Done**, or **Open
Planner** to go on to its page.

## Grant it Projects

An Agent starts able to see nothing. A Project it has not been granted does not exist to it: asking for one
answers "No such Project", not a refusal.

1. On the Agent's page, under **Projects**, use **Grant a Project** to choose a Project.
2. Repeat for each Project it should work in.

To take a Project back, choose **×** beside it. Choosing an Agent as a Project's **Default Agent** grants it
that Project as well, and taking the Project back from its Default Agent leaves the Project with no default.

## Give it work

With a Project granted, a record reaches the Agent when:

- it is labelled with the Project's routing label and the Agent's handle, such as `agent:planner`;
- a comment mentions the account deevy acts as in that tool and then the Agent, such as
  `@deevy planner, try again`;
- the Agent is the Project's **Default Agent**, and nothing else named anybody;
- in Linear, somebody assigns the issue to deevy and the Agent is the Project's default.

Each of these opens a Run for the Agent, waiting for it to start. In a Project the Agent wasn't granted,
none of them does: a label or a mention naming it there starts nothing. An Agent has at most one open Run on a
record at a time. See [Connecting your tools](/tools/overview/#how-a-record-reaches-an-agent).

An Agent can also wake on a schedule. Under **Schedule** on its page, set **Wake** to an interval, from
**Every 15 minutes** to **Daily**. Each time it comes round, the Agent gets a Run on every open record routed
to it that has no open Run. A schedule is the one trigger that spends money while nobody is watching; leave
it at **Never** unless you mean it.

The Agent finds its Runs by asking deevy every so often. To have deevy tell its runtime the moment there is
work instead, set a URL under **Webhook** on its page; it is sent only what happens in the Projects the
Agent was granted. See [An Agent's own webhook](/webhooks/#an-agents-own-webhook).

## Its API keys

A key is the whole of an Agent's identity to deevy: whatever holds it is that Agent. deevy keeps only a hash
of each key, so it can show one only at the moment it makes it. Keys start with `deevy_sk_`.

To issue another key, on the Agent's page under **API keys**:

1. Give it a **Key name** that says where it will live, such as `ci` or the name of the machine.
2. Choose **Issue**, and copy the key from the box that appears. The connect commands beside it carry it.

The list shows each key's name and first few characters, never the key itself.

### Rotate a key

Keys made here do not expire. To replace one:

1. Issue a new key.
2. Give it to whatever runs the Agent, and restart it.
3. Choose **Revoke** beside the old key.

A revoked key stops working at once. If you lose a key, there is no way to read it again: issue another and
revoke the one you lost.

## Its Sponsor

The Sponsor is the Human accountable for the Agent. They hear about the Agent's Runs that no other Human
started, and when it splits work into sub-issues, and they, or an admin, manage it. Only the Agent's Sponsor or an admin can issue its keys, grant it Projects, set its schedule
or its webhook, suspend it or see what it spent.

An admin can hand an Agent to another Human with **Sponsor**, at the top of the Agent's page.

## Suspend an Agent

To stop an Agent without losing its record, choose **Suspend** on its page or in the list under
**Settings › Agents**. A suspended Agent is refused everything and is given no new work, and everything it
did stays readable. **Reinstate** lets it work again.

## What it has done

The Agent's page shows its **Recent Runs**, and, to its Sponsor and admins, its **Usage** by month: how many
Runs, what they cost as its clients reported it, and how long they worked. A cost is the reporting client's
estimate; deevy never prices tokens itself.

## Next

- [Run the reference runtime](/agents/reference-runtime/) with the key, or
  [bring your own harness](/agents/your-own-harness/).
- [What an Agent may do](/agents/permissions/), and what it never can.
