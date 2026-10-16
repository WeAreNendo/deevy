---
title: Connecting your tools
description: Connect GitHub, Linear, GitLab, Notion or Slack to deevy as a Socket, bind a Project to what is in it, and choose what deevy says back.
sidebar:
  order: 1
---

deevy works in the tools your team already uses. You connect each one once, as a **Socket**: one tool,
under one identity of deevy's own there, holding the credential deevy acts with. Every Agent works through
it, so a comment, a label or a pull request an Agent makes is written by the Socket's identity and signed
with the Agent and the Run it came from.

A Socket on its own does nothing. You then bind a **Project** to something inside it, such as a repository
or a Linear team, and that is where deevy takes records from and hands them to Agents.

## Which tools

| Tool                     | What deevy uses it for                                       | What you set up there                                    |
| ------------------------ | ------------------------------------------------------------ | -------------------------------------------------------- |
| [GitHub](/tools/github/) | Issues as records, and a repository for the code             | A GitHub App, which deevy writes for you                 |
| [Linear](/tools/linear/) | Issues in a team as records                                  | An OAuth application of your own                         |
| [GitLab](/tools/gitlab/) | Issues as records, and the project's repository for the code | An access token for the account deevy acts as, a webhook |
| [Notion](/tools/notion/) | A database's rows as records, and pages as documents         | An internal connection, and a webhook subscription       |
| [Slack](/tools/slack/)   | Gates in a channel or a direct message, ruled with buttons   | An app made from deevy's manifest                        |

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
   lists them. One container is one Project.
3. For GitHub and GitLab, leave **Its code is here too, so its Agents push to it** ticked if the code
   lives in the same repository as the issues. The base branch is the repository's default.
4. Give the Project a **Name**, and choose **Bind it**.

A Project stays bound to the container it was made from. To work another container, bind it as a
Project of its own.

Each Project's settings, under **Settings › Projects**, say the rest:

- **Default Agent**: who gets an open record that no label and no mention named. Choosing an Agent here
  also lets it see the Project.
- **Routing label**: the prefix of the label that hands a record to an Agent, `agent:` unless you change
  it. A record labelled `agent:planner` goes to the Agent whose handle is `planner`.
- **Mirror**: how much deevy writes back where the work lives, below.
- **Repository** and **Base branch**: where the Project's code is, and what each Run branches from. A
  Project with its repository set to **Nowhere** is one whose Agents read, plan and comment, and push
  nothing.
- **Documents**: a Notion Socket whose pages the Project's Agents may read when a record links one.

## How a record reaches an Agent

deevy hands an open record to an Agent when:

- it carries the routing label for that Agent, such as `agent:planner`, and the Agent has been granted the
  Project;
- a comment on it mentions the account deevy acts as in that tool and then the Agent's handle, such as
  `@deevy planner, try again`, which starts a Run for that Agent;
- in Linear, somebody assigns the issue to deevy, and the Project has a default Agent;
- nothing else named anybody, and the Project has a **Default Agent**.

A closed record is handed to nobody.

## What deevy reads

From each container a Project is bound to, deevy reads the records: their title, body, state, labels and
the tool's own assignees, as the tool last said them. It reads a record's comments when an Agent or a Human
asks for them, so the conversation is always the tool's. For a Notion Socket chosen as a Project's
**Documents**, it reads the pages an Agent asks for.

deevy never authors a record of its own, never moves one between states and never closes one. That happens
in the tool, and deevy follows.

## What deevy writes back

What deevy says on a record depends on the Project's **Mirror**:

| Mirror                | What deevy writes on the record                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nothing**           | Nothing.                                                                                                                                                         |
| **Gates and rulings** | A comment when an Agent asks at a Gate, with its Proposal and how to rule; one for each Ruling; the `deevy:awaiting-approval` label while it waits. The default. |
| **Runs as well**      | All of that, and a comment when a Run starts, finishes or fails, and when an Agent opens a pull request, where the tracker is not where the code is.             |

Whatever the Mirror says, an Agent can also, through the Socket:

- comment on a record it was given;
- open a sub-issue under it, carrying the routing label for the Agent it is meant for;
- push a branch and have deevy open a pull request or merge request, on GitHub and GitLab, saying
  `Closes <the record's URL>` so that merging it closes the record.

## What each tool lets deevy do

deevy asks each tool for what it needs and nothing more.

| Tool   | What deevy is given                                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub | Issues: read and write. Contents: read and write. Pull requests: read and write. Metadata: read. Only on the repositories you install the App on.    |
| Linear | Read and write, as the application itself. Installing it as an agent adds being assigned and being mentioned.                                        |
| GitLab | Whatever the account behind the token may do, with the `api` scope. Give it **Developer** on the projects it works, and nothing more.                |
| Notion | Read, update and insert content; read and insert comments; user information with email addresses. Only on the pages and databases you share with it. |
| Slack  | `chat:write`, `im:write` and `commands`. Nothing about people.                                                                                       |

## A Socket's page

Choose a Socket under **Settings › Sockets** to see how it is doing:

- **How it is doing** says when it last spoke. **Ask who deevy is there** checks that the credential
  still works. **Pause** stops deevy acting on what the tool says while keeping everything; **Resume**
  starts it again.
- **Where it delivers** is the address the tool sends what happens to. It is not a secret.
- **What it signs with** says whether deevy holds the secret the tool signs its deliveries with. **Mint a
  webhook secret** makes a new one and shows it once, for you to paste into the tool.
- **What it has said lately** lists each delivery and what deevy made of it.
- **Disconnect** is at the bottom.

GitHub, Linear and Notion Sockets have a section of their own as well, described on their pages.

## When the tool cannot reach deevy

A tool tells deevy what happened by posting to the Socket's address. If a Socket has said nothing for half
an hour, deevy goes and asks it what changed in each Project bound to it, so records still arrive, change and
close, and still reach Agents, only later. What asking cannot bring is what only a delivery carries: a new
comment, and so a `/approve` written in one, and a click on a button in Slack.

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
