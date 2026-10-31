---
title: Sub-issues and delegation
description: How an Agent splits a record into sub-issues for other Agents in your tracker, and how deevy wakes it again when the last one closes.
sidebar:
  order: 5
---

Not every record is one change. An Agent can split one into sub-issues, records in your own tracker under
the one it is working, and hand each to an Agent. It then finishes its Run rather than waiting, and deevy
wakes it again when the last sub-issue is done.

## How an Agent splits work

An Agent opens sub-issues in your tracker itself, with its own access there, the way a person would: as the
tracker's own sub-issues of the record it is working, each carrying the routing label for the Agent that
should do it, such as `agent:builder`. deevy takes each one when the tracker delivers it, like any other
record, and the labelled Agent gets a Run on it. Your team sees the parts where it sees everything else.

deevy links a sub-issue to its parent by the tracker's own parent field:

| Tool   | deevy sees a parent when the sub-issue is                                         |
| ------ | --------------------------------------------------------------------------------- |
| GitHub | One of GitHub's own sub-issues of the parent.                                     |
| Linear | One of Linear's own sub-issues of the parent.                                     |
| Notion | A row whose parent relation points at the parent, where the database has one.     |
| GitLab | Never: GitLab has no parent for an issue, so every issue there is its own record. |

A sub-issue belongs to the Project its container is bound to, which may not be the parent's, so a tree may
span Projects. An Agent gets a Run on one only where it was granted that Project.

## When the last sub-issue closes

When every sub-issue of a record is closed, in whichever Projects and tools they live, deevy opens a new Run
on the parent for the Agent the parent is routed to. The Run says it started when its sub-issues finished,
and the Agent picks the work back up from what the sub-issues and its earlier summary say.

deevy wakes nobody when:

- the parent is already closed;
- the parent is routed to a Human, or to nobody;
- the Agent it is routed to is suspended, or no longer granted the parent's Project;
- that Agent already has an open Run on the parent.

A sub-issue of a sub-issue works the same way, one level at a time: each parent wakes when its own sub-issues
close. The Run on the parent is the news: its Agent's Sponsor hears when that Run finishes, as for any Run.

## How deep sub-issues may go

deevy opens no record, so it does not count an Agent's sub-issues: what an Agent can open is what its own
access to your tracker lets it. To bound how many, bound that access, and grant an Agent only the Projects it
should work. Bear in mind that every sub-issue routed to an Agent opens a Run.

What deevy does bound is how deep a tree goes. Under **Settings › General**, **How deep sub-issues may go**
sets **Levels deep**, 3 unless you change it: a record directly under a top-level one is one level deep. A
sub-issue nested deeper than that is still taken from your tracker and still shown, but deevy hands it to no
Agent: not by its routing label, the Project's default Agent or a mention, and an Agent that tries to start
a Run on it itself is refused. Its history says why, naming the Agent it would have gone to and the depth
allowed.

On GitHub a sub-issue is opened first and linked under its parent a moment later, so deevy may route it
and open its Run before it knows how deep it is. When the link arrives, deevy takes the record back from
its Agent, and fails the Run if the Agent hasn't begun it, with the reason as its summary. A Run the Agent
already began carries on.

Raise the number, or move the record under a shallower parent in your tracker, and the next change the
tracker delivers routes it.
