---
title: What an Agent may do
description: What an Agent can do in deevy, what it is refused by default, why it can never rule on a Gate, and what a credential a Human delegates may not do either.
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

- read records, their conversation in the tracker, and the Project's documents;
- comment on a record, in the tracker it lives in;
- open a record in the tracker, such as a sub-issue of the one it is working, within the Workspace's
  [limits on splitting work](/agents/delegation/);
- point a record at a pull request, a commit, a branch or any URL;
- drive its own Runs: start one, post Activities to it, get its repository, report what it spent, and finish
  it;
- ask at a Checkpoint, with a Proposal, and read what was ruled;
- open the pull request for its Run's branch;
- read its own inbox, and mark it read.

A Project it was not granted does not exist to it: asking for one answers "No such Project", not a refusal.

Some of these belong to a Run, which is an Agent's attempt: starting one, posting Activities, asking at a
Gate, opening its pull request, reporting usage and finishing it. Only an Agent may do those, and a Human
who tries is told "Only an Agent can do that". A Human is present for their own work and has no Run.

## What an Agent can never do

- **Rule on a Gate.** An Agent can ask at a Checkpoint; it can never approve or reject, its own Gate or any
  other.
- **Administer the Workspace**: Members, invitations, who may join, Sockets, Projects and their settings,
  Channels, email, webhooks and the Workspace's own settings.
- **Manage Agents**, its own included: no new Agents, no keys, no grants, no schedules.
- **Answer a question it was asked.** When an Agent asks something in a Run, a Human answers.
- **Try a failed Run again.** That is its Sponsor's or an admin's call.

A suspended Agent is refused everything, and is given no new work.

## A Gate is a Human's, in deevy

Approving and rejecting a Gate in deevy needs a Human signed in to deevy in a browser. An Agent's key is
refused, and so is any credential a Human delegated, which is told "Only a Human signed in to deevy can do
that". The party that proposes never has a route to approve.

A Human can also rule from a tool, by commenting `/approve` in the tracker or clicking **Approve** in Slack.
That counts only when the tool vouches for which Human it was, through their own account there. A comment by
a bot, deevy's own included, rules nothing. See [Ruling from your tools](/gates/ruling-from-your-tools/).

## What a delegated credential may not do

A Human can let software act as them: their own [MCP client](/mcp-and-cli/your-own-mcp-client/), such as
Claude Code on their laptop, or the [CLI](/mcp-and-cli/cli/) after `deevy login`. What it does is theirs, in
their name, and it can do what they can, except what only a Human present in deevy may do:

- rule on a Gate;
- list or revoke the MCP clients they consented to;
- set up the Workspace's email;
- link an account under **Settings › Identities**.

Those happen in deevy's own pages, in a browser. Nothing a Human drives this way is ever an Agent: the
credential decides who is acting, not the software.

## Untrusted input

A record's body, its comments, the pages it links and other Agents' Activities are written by anybody who
can write in your tools, and all of it reaches the Agent that works the record. Treat it as untrusted: no
instruction to the Agent makes it safe.

What deevy bounds is what an Agent may do in deevy: the rules on this page, whatever the text says. What the
Agent may do outside deevy is up to what runs it:

- **Its reach on your code is its credential's.** With a forge Socket, a Run's credential reaches what the
  Socket reaches. Install the GitHub App only on the repositories it works, give a GitLab account
  **Developer** on its projects and no more, and protect the branches that matter.
- **A shell runs what the repository runs.** A coding agent with a shell can run the repository's own build,
  reach the network and spend tokens.
- **A Gate is the last line.** Nothing an Agent proposes ships without a Human deciding it should, so put
  Checkpoints where a Human should look, and read the pull requests.

deevy runs no Agent, so what bounds a coding agent is whatever you run it in. Keep the Agent's key in the
MCP client's configuration rather than in the model's context, run the coding agent where its shell can do
no harm, and give it git access no wider than the repositories it works.

## Who answers for an Agent

Every Agent has a Sponsor, the Human accountable for it. Everything an Agent does is recorded as the
Agent's own, with its Sponsor one step away, and its Sponsor hears when it splits work up. Only its Sponsor
or an admin can change what it may see and hold. See [Adding an Agent](/agents/overview/#its-sponsor).
