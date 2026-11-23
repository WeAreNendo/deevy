---
title: Issues
description: An Issue is deevy's view of a record in your tracker. deevy never writes one; it takes it as the tracker delivers it, routes it, and says on it when a Gate is waiting.
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
closed record is routed to nobody, and closing the last of a record's sub-issues wakes the Agent the record
is routed to.

## What deevy writes back

deevy writes on the record about its Gates and nothing else, for every Project, with no setting to change
it:

- a comment when a Gate asks, with the Proposal, its links and how to rule;
- a comment for each approval, and one for the decision;
- a reply when a comment ruled nothing, saying why.

Nothing is written about a Run starting, working or finishing, and deevy sets no label.

Every comment comes from deevy's own identity in the tool. One about a Gate ends with the Agent and the
Run it came from, like `— builder · run_k3xr8v2m9qpw · via deevy`, and the reply to a comment that ruled
nothing ends `— deevy`. Anything else an Agent says on the record, it says in the tool with its own
access, as its own account.

A pull request or merge request an Agent opens says `Closes` and the issue's URL, so merging it closes a
GitHub or GitLab issue. A record in Linear or Notion closes only if something in that tool acts on it, such
as Linear's own GitHub integration.

## Sub-issues

An Agent can split a record into **sub-issues**: new records it opens in your tracker itself, under the one
it is working on, as the tracker's own sub-issues (GitHub's and Linear's, Notion's sub-items). deevy takes
them like any other record and links each to its parent by the tracker's own parent field. GitLab has no
parent for an issue, so there an issue an Agent opens is a record of its own, with no parent in deevy.

A sub-issue is a record like any other, routed by its own label, with its own Runs and Gates, and it may sit
in a different Project. When every sub-issue of a record is closed, the Agent the record is routed to gets a
new Run on it to pick the work back up. See [Sub-issues and delegation](/agents/delegation/).

## Keys, URLs and ids

A record's **key** is the tracker's handle for it, such as `acme/deevy#42` on GitHub or `ENG-12` in Linear,
and its **URL** is where it lives. deevy also gives everything it keeps an id of its own, which says what it
names: `iss_k3xr8v2m9qpw` is an Issue, `run_…` a Run, `gate_…` a Gate, `mem_…` a Member.

The API and the CLI take a record's key, its URL or its id wherever they ask which record you mean. From a
terminal, `deevy gates open acme/deevy#42` opens the Gate waiting on that record.

## Next

- [Runs and Checkpoints](/concepts/runs/)
- [Connecting your tools](/tools/overview/)
