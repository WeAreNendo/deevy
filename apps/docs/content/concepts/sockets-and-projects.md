---
title: Sockets and Projects
description: A Socket connects your Workspace to one tool under deevy's own identity there; a Project binds part of it, and decides which Agent a record goes to.
sidebar:
  order: 3
---

deevy reaches your tools through **Sockets**, and takes work from them through **Projects**. You connect a
tool once, then bind as many Projects to what is in it as you like.

## Sockets

A Socket is one tool, connected under one identity of deevy's own there, holding the credential deevy acts
with:

| Tool   | The Socket is              | What deevy uses it for                               |
| ------ | -------------------------- | ---------------------------------------------------- |
| GitHub | a GitHub App               | issues as records                                    |
| Linear | a Linear OAuth application | issues as records                                    |
| GitLab | a GitLab account           | issues as records                                    |
| Notion | a Notion connection        | a database's rows as records, and pages as documents |
| Slack  | a Slack app                | Gates in a channel or a direct message, with buttons |

An Agent's comments and labels go through the Socket: they are written by deevy's identity in that tool,
and signed with the Agent and the Run they came from, so your team can tell which Agent did what without
opening deevy. Its code and its pull requests are its own, with access you give it.

An admin connects a tool under **Settings › Sockets**, with **Connect GitHub**, **Connect Linear** and the
others. Each tool's page walks you through it: start at [Connecting your tools](/tools/overview/).

### How a tool tells deevy what happened

Each Socket has an address of its own, shown on its page under **Where it delivers**, which the tool posts to
when something changes. A Socket that has said nothing for half an hour is also asked what changed, so
records still arrive if a delivery goes missing. Two things only ever arrive by delivery: comments, and so a
`/approve` in one, and clicks on Slack's buttons.

:::note[deevy Cloud]
Your Workspace's address is public, so every tool can reach it. There is nothing to set up.
:::

:::note[Self-hosted]
The tools have to reach your deevy over public HTTPS. A deevy on a laptop needs a tunnel; without one it
still sees records arrive and change, a little late, but hears no comments and no Slack clicks. See
[Connecting your tools](/tools/overview/).
:::

## Projects

A Project binds one container in a tool: a GitHub repository, a Linear team, a GitLab project, a Notion data
source. It holds no work of its own. It says:

- where its records come from, which never changes once it is bound;
- where its documents are, for an Agent to read;
- which Agent takes a record that nobody named, and which label routes one to an Agent;
- its Checkpoints, and how many Humans each one asks for;
- how much deevy writes back on the record.

An admin binds one under **Settings › Projects** with **Bind a Project**: choose the **Tool**, then the
**Container** it offers, then a **Name**. A Project holds nothing about code: an Agent reaches its
repository with access you give it. The Project's **Binding** section then holds the rest, and its **Checkpoints** section its policy.

To take records from another repository or team, bind it as a Project of its own.

## Routing records to Agents

When a record arrives or changes, deevy decides which Agent it goes to, in this order:

1. **A routing label.** A label made of the Project's **Routing label** and an Agent's handle, `agent:builder`
   by default, sends the record to that Agent, if it has been granted the Project.
2. **Handed to deevy in the tool itself.** Assigning an issue to deevy in Linear, or adding deevy's
   connection to a Notion row's people, hands the record to the Project's **Default Agent**.
3. **The Default Agent.** An open record that nobody has named goes to the Project's **Default Agent**, if
   it has one.

A record that already went to an Agent keeps it until a label names another, and a closed record goes to
nobody. The Agent a record went to is its assignee in deevy; the tool's own assignee is shown beside it, but
is not what puts an Agent to work.

Mentioning an Agent through deevy's own account in a comment, such as `@deevy builder, try again` where deevy
is called `deevy` in that tool, starts a Run for that Agent too, if it has been granted the Project.

Whichever way it is named, an Agent has at most one Run open on a record at a time, so a record labelled
twice, or mentioned while the Agent is already working, starts nothing new.

## Next

- [Issues](/concepts/issues/)
- [Connecting your tools](/tools/overview/)
- [What an Agent may do](/agents/permissions/)
