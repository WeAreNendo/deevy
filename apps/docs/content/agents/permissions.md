---
title: What an Agent may do
description: What an Agent can do in deevy, what it is refused by default, why it can never rule on a Gate, and why a key is only ever an Agent's.
sidebar:
  order: 4
---

An Agent can do less than a Human, by design, and the same rules hold whichever way it reaches deevy: MCP,
the API or the CLI. Everything here is enforced by deevy itself, not by the Agent's instructions.

## Closed unless opened

Every operation in deevy is closed to Agents unless it was opened to them on purpose. One added to deevy
later starts closed. An Agent that tries anything else is refused with "An Agent cannot do that", and over
MCP it is never even offered the tool.

Administering is never opened to an Agent at all: that is built into deevy, not a setting.

## What an Agent may do

In the Projects it was granted, an Agent may:

- read the records deevy took from the tracker, with their sub-issues, Checkpoints and Links;
- point a record at a pull request, a commit, a branch or any URL;
- drive its own Runs: start one, post Activities to it, and finish it;
- ask at a Checkpoint, with a Proposal, and read what was ruled;
- read its own inbox, and mark it read.

A Project it was not granted does not exist to it: asking for one answers "No such Project", not a refusal.

Reading a record's conversation, commenting on it, labelling it and opening a record or a
[sub-issue](/agents/delegation/) are not deevy's to allow: an Agent does them in the tool, with its own
access there, which you give it and you scope.

Some of these belong to a Run, which is an Agent's attempt: starting one, posting Activities, asking at a
Gate and finishing it. Only an Agent may do those, and a Human
who tries is told "Only an Agent can do that". A Human is present for their own work and has no Run.

## What an Agent can never do

- **Rule on a Gate.** An Agent can ask at a Checkpoint; it can never approve or reject, its own Gate or any
  other.
- **Administer the Workspace**: Members, invitations, who may join, Sockets, Projects and their settings,
  webhooks and the Workspace's own settings.
- **Manage Agents**, its own included: no new Agents, no keys, no grants.
- **Try a failed Run again.** That is its Sponsor's or an admin's call.

A suspended Agent is refused everything, and is given no new work.

## A Gate is a Human's, in deevy

Approving and rejecting a Gate needs a Human signed in to deevy in a browser, and is done nowhere else. An
Agent's key is refused with "An Agent cannot do that". The party that proposes never has a route to approve.

Nothing written in a tool rules either: a comment that starts `/approve` on the record is only a comment,
whoever wrote it, and the message deevy posts in a chat channel has no buttons, only a link to the Gate. So
an Agent that can write in your tracker, with the access you gave it, can't rule there. See
[How a Gate asks](/gates/how-a-gate-asks/).

## A key is an Agent's

An API key always stands for an Agent. deevy issues keys only to Agents, and takes one only as an Agent's:
there is no key, token or MCP client that acts as a Human. A Human works in deevy's own pages, in the
tracker and in the chat channel, signed in as themselves. So nothing that runs while a Human is away can
rule as them or act in their name.

## Untrusted input

A record's body, its comments, the pages it links and other Agents' Activities are written by anybody who
can write in your tools, and all of it reaches the Agent that works the record. Treat it as untrusted: no
instruction to the Agent makes it safe.

What deevy bounds is what an Agent may do in deevy: the rules on this page, whatever the text says. What the
Agent may do outside deevy is up to what runs it:

- **Its reach on your code and your tools is the access you gave it.** deevy holds none: scope the deploy
  key, token, App or MCP server you give the Agent to the repositories and the records it works, and
  protect the branches that matter.
- **A shell runs what the repository runs.** A coding agent with a shell can run the repository's own build,
  reach the network and spend tokens.
- **A Gate is the last line.** Nothing an Agent proposes ships without a Human deciding it should, so put
  Checkpoints where a Human should look, and read the pull requests.

deevy runs no Agent, so what bounds a coding agent is whatever you run it in. Keep the Agent's key in the
MCP client's configuration rather than in the model's context, run the coding agent where its shell can do
no harm, and give it git access no wider than the repositories it works.

## Who answers for an Agent

Every Agent has a Sponsor, the Human accountable for it. Everything an Agent does is recorded as the
Agent's own, with its Sponsor one step away. Only its Sponsor or an admin can change what it may see and
hold. See [Adding an Agent](/agents/overview/#its-sponsor).
