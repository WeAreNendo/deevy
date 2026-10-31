---
title: Glossary
description: The words deevy uses on screen, in the API and in these docs, and what each one means.
sidebar:
  order: 3
---

deevy uses a small set of words, and always in the same sense: on screen, in the API, in the CLI and in these
pages. Each is capitalised, so you can tell a Gate from a gate.

### Activity

One entry an Agent posts to its Run while working: a thought, an action, a question for a Human, a response,
or an error. Together they are the Run's feed. See [Runs and Checkpoints](/concepts/runs/#activity).

### Agent

A Member that is an automated system acting under its own identity, accountable to a Sponsor. An Agent never
rules on a Gate and never changes a Workspace's settings. See
[Humans, Agents and Sponsors](/concepts/humans-and-agents/#agents).

### Assignee

The Member deevy routed an Issue to: by a label, by a mention, or by a Project's Default Agent. The
tracker's own assignee is a fact deevy shows, not this. See
[Sockets and Projects](/concepts/sockets-and-projects/#routing-records-to-agents).

### Channel

Where Notifications are delivered: the Inbox in deevy, a Slack room through its incoming webhook, a room in
a Slack app or a direct message from it, or a team email address somebody there confirmed. A Human's own
email is not a Channel, just as their Slack direct messages are not: it is one of their own settings. See
[Channels and routing](/notifications/channels/).

### Checkpoint

A named point in a Project's policy, `plan`, `ship` or any name, with how many different Humans must
approve, whether the one the work is for may count, and who may rule. A name the policy does not list gets
the default: one approval, from anybody. See [Gates and Rulings](/concepts/gates-and-rulings/#checkpoint).

### Event

A record of one change in a Workspace that is never altered: what changed, which Member did it, and when. A
change that arrived from a Socket names the account on the tool that made it, and no Member. See
[The Event log](/concepts/events/).

### Gate

A Run's request to pass a Checkpoint: the Agent's Proposal, its links, and the Rulings on it. A Run at a Gate
waits and never goes quiet. A rejection ends the Gate; asking again is a new Gate, one visit later. An
approved Gate stands for its record: a later Run asking the same Proposal at the same Checkpoint is answered
with it, while its approvals still meet the Checkpoint. See
[Gates and Rulings](/concepts/gates-and-rulings/#gate).

### Human

A Member who is a person. See [Humans, Agents and Sponsors](/concepts/humans-and-agents/#humans).

### Id

What names one thing deevy keeps, in a shape that says what it is: a short prefix, an underscore, and twelve
characters. `iss_k3xr8v2m9qpw` is an Issue, `mem_…` a Member, `run_…` a Run, `proj_…` a Project, `sock_…` a
Socket, `gate_…` a Gate, `chk_…` a Checkpoint, `mid_…` an Identity. An Issue's **key**, such as
`acme/deevy#42` or `ENG-12`, is the tracker's handle for it, and its **URL** is where it really lives;
neither is its id. An Event's **seq** is a number: its place in the log. See
[Issues](/concepts/issues/#keys-urls-and-ids).

### Identity

A Human's account on a Socket's tool, linked to their Member so that a Ruling made there is theirs. Linked by
signing in to deevy with the same provider, or by a link the Human completes while signed in; never by a
display name. See [Humans, Agents and Sponsors](/concepts/humans-and-agents/#identities).

### Issue

The unit of work: deevy's view of a record in a tracker Socket, with its URL, its key as the tracker writes
it, and its title, body and state as the tracker last said them. Never written in deevy. It is what Members
are routed to, what they discuss where it lives, and what Runs work on. See [Issues](/concepts/issues/).

### Member

A participant in a Workspace with an identity, permissions and a trail of their own. Every Member is either a
Human or an Agent. See [Humans, Agents and Sponsors](/concepts/humans-and-agents/).

### Notification

A message to a Human, worked out from Events: a mention, a Gate awaiting them, a Run awaiting their answer,
an assignment. See [Needs me and the Inbox](/notifications/inbox/).

### Project

A scope of work bound to Sockets: where its Issues live, optionally where its documents are read from, which Agents may work it, its Default Agent and routing label, its Checkpoints, and how much
deevy writes back. See [Sockets and Projects](/concepts/sockets-and-projects/#projects).

### Proposal

The markdown an Agent attaches to a Gate: what it intends to do, or what it has done. It never changes on its
Gate; a changed Proposal supersedes the Gate. See
[Gates and Rulings](/concepts/gates-and-rulings/#proposal).

### Ruling

A Human's decision on a Gate, with a note, made in deevy, on the tracker or in Slack, and recorded with where
it came from. An Agent never rules, and neither does any credential deevy issued. See
[Gates and Rulings](/concepts/gates-and-rulings/#ruling) and
[Ruling from the tracker or Slack](/gates/ruling-from-your-tools/).

### Run

One attempt by one Agent on one Issue, with a status, a summary, timestamps, the evidence it attached, and
the Member whose action started it. See [Runs and Checkpoints](/concepts/runs/).

### Sender

The service a Workspace sends email through: Resend, Postmark, SendGrid, Mailgun, Amazon SES, an SMTP server
or Cloudflare Email Service. There is one at a time, from the deployment's configuration or from
**Settings › Email**. See [Email](/notifications/email/#the-sender).

### Socket

One connected tool under one identity of deevy's own there: a GitHub App, a Linear application, a GitLab
account, a Notion connection, a Slack app. A Socket has capabilities, such as holding records, holding code,
holding documents or chat, and holds the credential deevy uses to act there. See
[Sockets and Projects](/concepts/sockets-and-projects/#sockets).

### Sponsor

The Human accountable for an Agent. See [Humans, Agents and Sponsors](/concepts/humans-and-agents/#sponsors).

### Sub-issue

A record opened under another in the tracker, which is its parent: a piece of a larger piece of work, with
its own Runs and its own Gates. It may live in a different Project. deevy keeps the tree even where the
tracker cannot link it. See [Issues](/concepts/issues/#sub-issues).

### Working time and waiting time

How long a Run was active, and how long it waited on a Human at a Gate or for an answer. With the time before
it started, they make up the whole of a Run's life, and deevy works them out rather than being told. See
[Runs and Checkpoints](/concepts/runs/#time).

### Workspace

The top-level boundary that holds Members, Sockets, Projects and settings, in a database of its own. A
self-hosted deevy serves one Workspace; deevy Cloud serves many, each in its own database. See
[How deevy works](/concepts/overview/).
