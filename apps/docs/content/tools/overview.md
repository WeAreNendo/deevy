---
title: Connecting your tools
description: Connect GitHub, Linear, GitLab, Notion or Slack to deevy as a Socket, bind a Project to what is in it, and see what deevy says back.
sidebar:
  order: 1
---

deevy works in the tools your team already uses. You connect each one once, as a **Socket**: one tool,
under one identity of deevy's own there, holding the credential deevy acts with. A Socket listens and
announces: it takes what the tool delivers, and it says on a record when a Gate is waiting and how it was
ruled. Everything else an Agent does in a tool, it does itself, with its own access there.

A Socket on its own does nothing. You then bind a **Project** to something inside it, such as a repository
or a Linear team, and that is where deevy takes records from and hands them to Agents.

## Which tools

| Tool                     | What deevy uses it for                                     | What you set up there                                    |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------------- |
| [GitHub](/tools/github/) | A repository's issues as records                           | A GitHub App, which deevy writes for you                 |
| [Linear](/tools/linear/) | Issues in a team as records                                | An OAuth application of your own                         |
| [GitLab](/tools/gitlab/) | A project's issues as records                              | An access token for the account deevy acts as, a webhook |
| [Notion](/tools/notion/) | A database's rows as records                               | An internal connection, and a webhook subscription       |
| [Slack](/tools/slack/)   | Gates in a channel or a direct message, ruled with buttons | An app made from deevy's manifest                        |

GitHub, Linear, GitLab and Notion hold records, so a Project can be bound to them. Slack holds none: it is
where deevy asks a Human to rule, and you route Notifications to it as a Channel.

## Connect one

Connecting a tool is an admin's job, because it is where a credential enters deevy.

1. Go to **Settings › Sockets**.
2. Under **Connect a tool**, choose **Connect GitHub**, **Connect Linear**, **Connect GitLab**,
   **Connect Notion** or **Connect Slack**.
3. Follow the dialog. Each tool's page in this section walks through it step by step.

Before deevy keeps a credential, it uses it to ask the tool who deevy is there. A credential that cannot
answer is refused rather than stored, with the tool's own words for why. One that works is sealed, and
deevy never shows it again.

Some tools need you to visit them in the middle, and deevy starts the Socket first so it can show you the
addresses to paste there. A Socket you started and did not finish stays in the list as **Not connected
yet**; open it and disconnect it, then start again.

## Bind a Project

1. Go to **Settings › Projects** and choose **Bind a Project**.
2. Choose the **Tool**, then the **Container**: a repository, a team or a database, as the tool itself
   lists them. One container is one Project. A tool that cannot list its containers has you type the
   one you mean, the way its deliveries name it.
3. Give the Project a **Name**, and choose **Bind it**.

A new Project starts empty. deevy takes a record the first time the tool delivers something about it, such
as its being opened, edited, labelled or commented on, so a record nobody touches after you bind it stays
out of deevy until somebody does.

A Project stays bound to the container it was made from. To work another container, bind it as a
Project of its own.

Each Project's settings, under **Settings › Projects**, say the rest:

- **Default Agent**: who gets an open record that no label and no mention named. Choosing an Agent here
  also lets it see the Project.
- **Routing label**: the prefix of the label that hands a record to an Agent, `agent:` unless you change
  it. A record labelled `agent:planner` goes to the Agent whose handle is `planner`.
- **Route by mention**: whether a comment that mentions an Agent hands it the record, on unless you turn it
  off; off, a mention still notifies whoever it names and starts no work.

## How a record reaches an Agent

deevy hands an open record to an Agent when:

- it carries the routing label for that Agent, such as `agent:planner`, and the Agent has been granted the
  Project;
- a comment on it mentions the account deevy acts as in that tool and then the Agent's handle, such as
  `@deevy planner, try again`, which starts a Run for that Agent, unless the Project has **Route by
  mention** turned off;
- in Linear, somebody assigns the issue to deevy, or in Notion, adds deevy's connection to the row's people
  property, and the Project has a default Agent;
- nothing else named anybody, and the Project has a **Default Agent**.

A closed record is handed to nobody.

## What deevy reads

From each container a Project is bound to, deevy takes the records the tool delivers: their title, body,
state, labels and the tool's own assignees, as the tool last said them. It reads each comment the tool
delivers for a mention of an Agent or a Ruling. The conversation on a record stays the tool's: an Agent that
wants it reads it there.

deevy never authors a record of its own, never moves one between states and never closes one. That happens
in the tool, and deevy follows.

## What deevy writes back

deevy writes on a record about its Gates and nothing else, for every Project, with no setting to change it:

- a comment when an Agent asks at a Gate, with its Proposal, its links and how to rule: reply `/approve` or
  `/reject <why>`, or open it in deevy;
- a comment for each approval, such as "Approved: 1 of 2, still waiting", and one for the decision,
  approved or rejected;
- a reply when a comment in the tool ruled nothing, saying why.

Nothing is written about a Run starting, working or finishing, and deevy sets no label.

## What an Agent does in the tool

Everything else in a tool is the Agent's business, done with its own access to that tool: a token, an app
or the tool's own MCP server that you give it. With that access it reads a record's conversation, comments,
opens a record or a sub-issue, labels one and reads a page, and what it writes there is its own account's,
not deevy's. It tells deevy about the pull request it opened by attaching it to its Run as a Link.

Code is never deevy's either: an Agent pushes and opens its pull request with access you give it. A pull
request that says `Closes <the record's URL>` closes a GitHub or GitLab issue when it merges; a Linear or
Notion record closes only if something in that tool acts on it, such as Linear's own GitHub integration.

## What each tool lets deevy do

deevy asks each tool for what it needs and nothing more.

| Tool   | What deevy is given                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub | Issues: read and write. Metadata: read. Only on the repositories you install the App on.                                             |
| Linear | Read and write, as the application itself. Installing it as an agent adds being assigned and being mentioned.                        |
| GitLab | Whatever the account behind the token may do, with the `api` scope. Give it **Reporter** on the projects it works, and nothing more. |
| Notion | Read content; read and insert comments; user information with email addresses. Only on the pages and databases you share with it.    |
| Slack  | `chat:write`, `im:write` and `commands`. Nothing about people.                                                                       |

## A Socket's page

Choose a Socket under **Settings › Sockets** to see how it is doing:

- **How it is doing** says when it last spoke. **Ask who deevy is there** checks that the credential
  still works. **Pause** stops deevy acting on what the tool says while keeping everything; **Resume**
  starts it again.
- **Where it delivers** is the address the tool sends what happens to. It is not a secret.
- **What it signs with** says whether deevy holds the secret the tool signs its deliveries with, and
  changes it. Where the tool makes the secret, or you change it there, paste the new one into **New
  secret from** the tool and choose **Use the new secret**. For GitHub and GitLab, **Mint a webhook
  secret** makes one instead and shows it once, for you to paste into the tool. Either way deevy keeps
  accepting the old one for a day, so you can change the two in either order. Slack and Linear make their
  own, so deevy mints none for them, and a Notion Socket has no such section: Notion signs with the token
  under **Verifying the webhook**.
- **What it has said lately** lists each delivery and what deevy made of it.
- **Disconnect** is at the bottom.

GitHub, Linear and Notion Sockets have a section of their own as well, described on their pages.

## When the tool cannot reach deevy

A tool tells deevy what happened by posting to the Socket's address, and that is the only way deevy hears
of it: deevy never asks a tool what changed. While a tool cannot reach deevy, nothing it does arrives: no
new or changed record, no comment, no `/approve`, no click on a button in Slack. Once it can, deevy hears
what the tool delivers from then on, and what it missed stays missed. Where the tool can send a delivery
again, such as **Redeliver** on a GitHub App's recent deliveries, that is how you replay one.

:::note[deevy Cloud]
Your Workspace's tools deliver to `https://app.deevy.dev/<address>/hooks/…`, which every tool can reach.
The dialogs and each Socket's page show the full address, so there is nothing to work out.
:::

:::note[Self-hosted]
A Socket's address is built from your deevy's public URL, its `BETTER_AUTH_URL`, and the tool has to be
able to reach it over HTTPS. A deevy on a laptop needs a tunnel with a hostname that stays the same, such
as a named Cloudflare Tunnel. When the address changes, point each tool's webhook at the new one: a GitHub
Socket's page does it for you with **Point GitHub at this address**. Sockets' credentials are sealed with
`DEEVY_SECRET`, so a deevy without it can connect no tool. See [Configuration](/self-hosting/configuration/).
:::

## Disconnect a tool

On the Socket's page, choose **Disconnect**, then **Disconnect it**. deevy drops the credential and stops
taking the tool's deliveries. The Issues it projected and the Runs on them stay readable, and the Projects
bound to it have nothing more to work.

Disconnecting changes nothing in the tool itself. Remove the App, application, token or connection there
too if you no longer want it to exist.

## Next

- [How a Gate asks](/gates/how-a-gate-asks/), and [ruling from your tools](/gates/ruling-from-your-tools/).
- [Add an Agent](/agents/overview/) to work what your Projects hold.
