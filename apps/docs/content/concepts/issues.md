---
title: Issues
description: An Issue is deevy's view of a record in your tracker. deevy never writes one; it reads it, routes it, and says back what its Agents did.
sidebar:
  order: 4
---

An **Issue** is deevy's view of one record in a tracker: a GitHub issue, a Linear issue, a GitLab issue, a
row in a Notion database. It carries the record's URL, its key as the tracker writes it, and its title, body
and state as the tracker last said them.

deevy keeps no tracker of its own. You never create, edit or close an Issue in deevy: you do that where the
record lives, and deevy follows. The conversation about a record stays there too.

## Where you see them

**Work** lists every record deevy has taken from your tools, with its key, title, state, the Agent it was
routed to, and whether a Gate is waiting on it. Search it by a key or a word of the title, and filter it by
**Open** or **Closed**, by Project, and by who it is **Routed to**. A record's key always links back to
where it lives.

A record's own page shows what the record says, then what deevy added beside it: its Runs, its Gates, the
links its Agents attached, and everything that happened to it. **Read the conversation on GitHub** (or
wherever it lives) takes you to the discussion. Nothing on the page is editable, by design.

## Open and closed

Whether a record is closed is the tracker's to say. deevy reads each tool's own idea of it: a closed issue
on GitHub or GitLab, a completed or canceled one in Linear, a Notion status in its **Complete** group. A
closed record is routed to nobody, and closing the last of a record's sub-issues wakes the Agent that
opened them.

## What deevy writes back

A Project's **Mirror** setting, under **Settings › Projects**, decides how much deevy says on the record
itself:

| Mirror                | What deevy writes on the record                                                                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nothing**           | Nothing.                                                                                                                                                                                                                                  |
| **Gates and rulings** | The default. A comment when a Gate asks, with the Proposal and how to rule; one for each approval and for the decision; a reply when a comment ruled nothing. While a Gate waits, the record carries the label `deevy:awaiting-approval`. |
| **Runs as well**      | All of that, and a comment when a Run starts and when it finishes or fails, with its summary. Where the tracker cannot see the code, as in Linear and Notion, a comment when an Agent opens a pull request.                               |

Every comment comes from deevy's own identity in the tool. One that reports a Gate or a Run ends with the
Agent and the Run it came from, like `— builder · run_k3xr8v2m9qpw · via deevy`; one an Agent writes itself
ends with its handle, like `— builder · via deevy`; and the reply to a comment that ruled nothing ends
`— deevy`. A pull request or merge request an Agent opens says `Closes` and the issue's URL, so merging it
closes a GitHub or GitLab issue. A record in Linear or Notion closes only if something in that tool acts on
it, such as Linear's own GitHub integration.

## Sub-issues

An Agent can split a record into **sub-issues**: new records, opened in your tracker, under the one it is
working on. They are the tracker's own sub-issues where it has them (GitHub's and Linear's, Notion's
sub-items). GitLab has no parent for an issue, so there a sub-issue is related to the record it came from.
deevy keeps the tree either way.

A sub-issue is a record like any other, with its own Runs and Gates, and it may sit in a different Project.
When every sub-issue of a record is closed, the Agent that opened them gets a new Run on the parent to pick
the work back up. How far an Agent may split work is a Workspace setting: see
[How far an Agent may split work](/agents/delegation/).

## Keys, URLs and ids

A record's **key** is the tracker's handle for it, such as `acme/deevy#42` on GitHub or `ENG-12` in Linear,
and its **URL** is where it lives. deevy also gives everything it keeps an id of its own, which says what it
names: `iss_k3xr8v2m9qpw` is an Issue, `run_…` a Run, `gate_…` a Gate, `mem_…` a Member.

The API and the CLI take a record's key, its URL or its id wherever they ask which record you mean. From a
terminal, `deevy gates open acme/deevy#42` opens the Gate waiting on that record.

## Next

- [Runs and Checkpoints](/concepts/runs/)
- [Connecting your tools](/tools/overview/)
