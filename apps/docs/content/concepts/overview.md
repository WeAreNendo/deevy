---
title: How deevy works
description: The work stays in your tracker. deevy hands it to your Agents, records what they do, and stops them where a Human has to decide.
sidebar:
  order: 1
---

Your team's work stays where it is today: in GitHub, Linear, GitLab or Notion. deevy connects to those
tools, hands the records you choose to Agents, keeps a record of everything each Agent does, and stops an
Agent at a Gate whenever a Human has to decide. Nobody has to move to a new tracker, and nobody has to
open deevy to follow along: what deevy does shows up as comments on the record itself.

## The pieces

**A Workspace** is your team's deevy: its Members, the tools it is connected to, its Projects and its
settings, kept in a database of its own.

:::note[deevy Cloud]
Your Workspace lives at `https://app.deevy.dev/<address>`, beside other teams' Workspaces, each in a
database of its own.
:::

:::note[Self-hosted]
A deevy you host serves one Workspace, at whatever URL you give it.
:::

**Members** are Humans and Agents. An Agent works under its own name and its own key, and always has a
Sponsor: the Human who answers for it. See [Humans, Agents and Sponsors](/concepts/humans-and-agents/).

**Sockets** connect the Workspace to your tools. Each is one tool under one identity of deevy's own there:
a GitHub App, a Linear application, a GitLab account, a Notion connection, a Slack app.

**Projects** bind part of a tool, such as a repository or a Linear team. A Project says where its records
come from, where its code is, which Agent takes a record nobody named, and how much deevy writes back. See
[Sockets and Projects](/concepts/sockets-and-projects/).

**Issues** are deevy's view of the records in those places. deevy never writes one: its title, body and
state are whatever the tracker last said. See [Issues](/concepts/issues/).

**Runs** are an Agent's attempts at an Issue: one Agent, one Issue, everything it posted along the way, and
how long it worked and waited. See [Runs and Checkpoints](/concepts/runs/).

**Gates** are where a Run stops for a Human. At a Checkpoint, such as `plan` or `ship`, the Agent asks with a
Proposal saying what it intends; Humans approve or reject it; the Run carries on. An Agent can ask, but it
can never approve. See [Gates and Rulings](/concepts/gates-and-rulings/).

**Events** record every change, in order. A record's history, the Inbox, Slack messages, emails, webhooks
and the comments deevy writes on your tracker are all read from them. See
[The Event log](/concepts/events/).

## One record, start to finish

1. Somebody labels an issue `agent:builder` on GitHub. (Or assigns it to deevy in Linear, or nobody names
   anyone and the Project's default Agent takes it.)
2. deevy sees the record arrive, routes it to the Agent `builder`, and a Run starts.
3. The Agent works, and reaches the `plan` Checkpoint. It stops and asks at a Gate, with a Proposal saying
   what it means to do.
4. deevy comments on the issue that it is waiting, and tells the Humans who may rule: on **Needs me**, in
   the **Inbox**, and in Slack or by email if your team uses them.
5. A Human approves: in deevy, with `/approve` in a comment on the issue, or with a button in Slack.
6. The Run carries on. The Agent opens a pull request that closes the issue when it merges, and finishes.

Each of those moments is recorded as an Event, so the record's page in deevy, the issue on GitHub and the
Agent's own inbox all tell the same story.

## Next

- [Humans, Agents and Sponsors](/concepts/humans-and-agents/)
- [Gates and Rulings](/concepts/gates-and-rulings/)
- [Connect your tools](/tools/overview/)
