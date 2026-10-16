---
title: Sub-issues and delegation
description: How an Agent splits a record into sub-issues for other Agents, how it picks the work back up when the last one closes, and the limits that bound it.
sidebar:
  order: 5
---

Not every record is one change. An Agent can split one into sub-issues, records in your own tracker under
the one it is working, and hand each to an Agent. It then finishes its Run rather than waiting, and deevy
wakes it again when the last sub-issue is done.

## How an Agent splits work

An Agent opens a sub-issue with `issues_create`, naming the record it came from as its `parent`, and the
Agent that should do it as `assignAgent`. deevy writes the sub-issue in the tracker, with the Project's
routing label for that Agent, such as `agent:builder`, so your team sees the parts where it sees everything
else, and the labelled Agent gets a Run on it.

How the tracker shows the parent depends on the tool:

| Tool   | The sub-issue is                                                            |
| ------ | --------------------------------------------------------------------------- |
| GitHub | One of GitHub's own sub-issues of the parent.                               |
| Linear | One of Linear's own sub-issues of the parent.                               |
| GitLab | A new issue related to the parent, since GitLab has no parent for an issue. |
| Notion | A new row, with its parent set where the database has a parent relation.    |

Each sub-issue also says which record it is part of, with a link, and deevy keeps the tree itself wherever
the tracker cannot.

A sub-issue goes in the parent's Project unless the Agent names another one it was granted. That is how a
part belonging to another codebase gets said: a tree may span Projects, but only those the Agent can see.

## When the last sub-issue closes

When every sub-issue of a record is closed, in whichever Projects and tools they live, deevy opens a new Run
on the parent for the Agent that opened them. The Run says it started when its sub-issues finished, and the
Agent picks the work back up from what the sub-issues and its earlier summary say.

deevy wakes nobody when:

- the parent is already closed;
- the sub-issues were opened by more than one Agent, or none of them by an Agent;
- the Agent that opened them is suspended, or no longer granted the parent's Project;
- the Agent already has an open Run on the parent.

A sub-issue of a sub-issue works the same way, one level at a time: each parent wakes when its own sub-issues
close.

The Agent's Sponsor hears about it twice: once when the Agent splits the work, in one Notification however
many sub-issues it opened, and once when they are all finished.

## How far an Agent may split work

Left alone, an Agent that decides a record has forty parts would open forty more, each with a Run. Three
numbers on the Workspace say how far it may go. An admin sets them under **Settings › General**, in **How far
an Agent may split work**:

| Setting              | Default | What it limits                                             |
| -------------------- | ------- | ---------------------------------------------------------- |
| **Sub-issues each**  | 20      | How many sub-issues one record may have.                   |
| **Levels deep**      | 3       | How far a tree of sub-issues may go below its root.        |
| **Open in one tree** | 50      | How many sub-issues of one tree may be unfinished at once. |

They bind Agents and never Humans: you can open as many sub-issues as you like, by hand or from your own MCP
client.

An Agent that reaches one is refused with a sentence naming the limit and the number, such as "Sub-issues may
go 3 deep in this Workspace, and ENG-12 is already at the bottom. Work this one rather than splitting it
again." The refusal is recorded in the Workspace's Event log, so its Sponsor can see that a ceiling, not the
Agent, decided the shape of the work.

### Before you raise them

The defaults are small on purpose: twenty sub-issues is a large split, and three levels is a plan rather
than a pyramid. Raise them if your Agents reach them for good reasons, and bear in mind two things:

- **A tree can span Projects.** What an Agent can reach across is its grants, so an Agent that should not
  open work in a Project is simply not granted it.
- **Every sub-issue for an Agent opens a Run.** These numbers also bound what one split can cost to run.
