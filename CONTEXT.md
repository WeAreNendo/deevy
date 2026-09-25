# deevy

Project management where humans and agents collaborate as peers on the same work, in the tools the team
already uses. This glossary defines the terms used across the product, the API, and the code.

The Sockets plan (`docs/plans/sockets.md`, ADR-0024) redefined several of these on 2026-09-19. Until its
first slice lands, the code still carries the retired words listed at the end; a new line of code uses the
words here.

## Language

### Actors

**Member**:
A participant in deevy with its own identity, permissions, and audit trail. Every Member is either a Human or an Agent.
_Avoid_: user, account, actor, participant

**Human**:
A Member who is a person.
_Avoid_: user, person

**Agent**:
A Member that is an automated system acting under its own identity, accountable to a Sponsor.
_Avoid_: bot, AI user, assistant, integration

**Sponsor**:
The Human accountable for an Agent.
_Avoid_: owner, creator

**Identity**:
A Human's account on a Socket, linked to their Member so that a Ruling made there is theirs. Linked by
signing in to deevy with the same provider, or by a link the Human completes while signed in; never by a
display name.
_Avoid_: alias, external user, linked account

### Structure

**Workspace**:
The top-level boundary that holds Members, Sockets, Projects, and settings. A self-hosted instance serves one Workspace.
_Avoid_: organization, tenant, account, instance

**Socket**:
One connected external tool under one identity: a GitHub App, a Linear app, a GitLab application, a Notion
connection, a Slack app. A Socket has capabilities — tracker, forge, docs, chat — and holds the credential
deevy uses to act there.
_Avoid_: integration, connector, plugin, provider (for the row; the provider is the kind of tool)

**Project**:
A scope of work bound to Sockets: where its Issues live, where its code lives, optionally where its
documents are read from, which Agents may work it, its default Agent and routing rule, its Checkpoints, and
how much deevy mirrors back.
_Avoid_: board, space, repo, team, binding

### Work

**Issue**:
The unit of work: a projection of a record in a tracker Socket — its URL, its key as the tracker writes it,
its title, body and state as the tracker last said them. Never authored in deevy. What Members are routed
to, discuss where it lives, and run against.
_Avoid_: ticket, card, task, story, work item, item

**Assignee**:
The Member deevy routed an Issue to, by label, by mention, or by a Project's default. The tracker's own
assignee is a fact deevy mirrors, not this.
_Avoid_: owner, delegate

**Sub-issue**:
A record opened under another in the tracker, which is its parent. A piece of a larger piece of work with
its own Runs and its own Gates; it may live in a different Project. deevy keeps the tree even where the
tracker cannot link it.
_Avoid_: subtask, child ticket, epic

**Run**:
One attempt by one Agent on one Issue, with a status, a summary, timestamps, attached evidence, and the Member that triggered it.
_Avoid_: session, job, execution, attempt

**Activity**:
One entry an Agent posts to its Run while working: a thought, an action, an elicitation, a response, or an error.
_Avoid_: log line, step, message

### Rulings

**Checkpoint**:
A named point in a Project's policy — `plan`, `ship`, or any name — with how many distinct Humans must
approve, whether the one who asked may count, and who may rule. A name the policy does not list gets the
default: one approval, from anybody.
_Avoid_: stage, step, state, phase

**Gate**:
A Run's request to pass a Checkpoint: the Agent's Proposal, its links, and the Rulings on it. A Run at a
Gate waits and never goes stale. A rejection ends the Gate; asking again is a new Gate, one visit later. An
approved Gate stands for its record: a later Run asking the same Proposal at the same Checkpoint is answered
with it, while its approvals still meet the Checkpoint.
_Avoid_: approval step, review stage, hold

**Proposal**:
The markdown an Agent attaches to a Gate: what it intends to do, or what it has done. Immutable on its
Gate; a changed Proposal supersedes the Gate.
_Avoid_: document, plan, spec, artifact

**Ruling**:
A Human's decision on a Gate, with a note, made in deevy, on the tracker, or in Slack, and recorded with
where it came from. An Agent never rules; a credential deevy issued never rules.
_Avoid_: approval (as the noun for the record), vote, verdict

### Attention

**Notification**:
A message to a Human derived from Events: a mention, a Gate awaiting them, a Run awaiting input, an assignment.
_Avoid_: alert, ping, message

**Channel**:
Where Notifications are delivered: the in-app inbox, a Slack channel through its webhook, a Slack app's
channel or a direct message, later an email address.
_Avoid_: destination, provider, integration

### Record

**Event**:
An immutable record of one change in a Workspace: what changed, which Member did it, and when. A change
that arrived from a Socket names the external actor in its payload and no Member.
_Avoid_: activity, log entry, audit record

**Id**:
What names one row, in a shape that says what it is: a short prefix, an underscore, twelve characters —
`iss_k3xr8v2m9qpw` is an Issue, `mem_…` a Member, `run_…` a Run, `proj_…` a Project, `sock_…` a Socket,
`gate_…` a Gate, `chk_…` a Checkpoint, `mid_…` an Identity (the map is in
`docs/adr/0015-ids-are-prefixed-nanoids.md`). An Issue's **key**, `acme/deevy#42` or `ENG-12`, is the
tracker's handle for it and its **URL** is canonical; neither is its id. An Event's **seq** is a number,
its place in the record.
_Avoid_: uuid, guid, primary key (in prose)

### Retired

Words v1 used that the Sockets milestone removed. Old documents — the plans and ADRs written before it —
use them; code and new writing do not.

- **Document** — the intent, spec and plan texts a State materialised. What an Agent proposes is a
  Proposal on a Gate; where a team keeps plans is theirs.
- **State** and **Workflow** — a Project's ordered steps. A Project has Checkpoints; an Issue's state is
  the tracker's.
- **Label** — a Workspace classification. A tracker label is a fact deevy mirrors and a routing input.
- **Team** — a named group of Members. Mention Members; a tracker's teams are its containers.
- **Key** as `DEV-42` — deevy's own numbering. An Issue's key is the tracker's.
