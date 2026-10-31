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
close.

The Sponsor of the Agent the parent is routed to hears once, when they are all finished, even when that
Agent cannot pick the work back up.

## How far an Agent may split work

deevy opens no record, so it does not count an Agent's sub-issues or how deep a tree goes: what an Agent can
open is what its own access to your tracker lets it. To bound it, bound that access, and grant an Agent only
the Projects it should work. Bear in mind that every sub-issue routed to an Agent opens a Run.

The numbers under **Settings › General**, in **How far an Agent may split work**, do not bound anything.
