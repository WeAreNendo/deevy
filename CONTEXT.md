# deevy

Project management where humans and agents collaborate as peers on the same work. This glossary defines the
terms used across the product, the API, and the code.

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

### Structure

**Workspace**:
The top-level boundary that holds Members, Projects, and settings. A self-hosted instance serves one Workspace.
_Avoid_: organization, tenant, account, instance

**Project**:
A stream of work inside a Workspace with its own Issues and workflow.
_Avoid_: board, space, repo

**Team**:
A named group of Members that owns Projects and can be mentioned. Not a permission boundary.
_Avoid_: group, squad

### Work

**Issue**:
The unit of work. What Members are assigned to, discuss, and move through states.
_Avoid_: ticket, card, task, story, work item

**Assignee**:
The Member, Human or Agent, responsible for moving an Issue forward. An Issue has at most one.
_Avoid_: owner, delegate

**Sub-issue**:
An Issue opened under another, which is its parent. A piece of a larger piece of work, with its own State, its
own Gates and its own Assignee; it may live in a different Project from its parent.
_Avoid_: subtask, child ticket, epic

**Label**:
A classification on an Issue, either plain (`backend`) or scoped (`epic:Checkout rewrite`). An Issue carries at most one Label per scope. Defined at Workspace level.
_Avoid_: tag, epic, category

**Document**:
A named, versioned markdown text on an Issue, such as its intent, spec, or plan, with a template supplied by the workflow State.
_Avoid_: artifact, page, attachment, file

**Gate**:
A workflow state an Issue cannot leave without a Human's approval. It may ask for more than one, and may
refuse the approval of the Human who brought the Issue to it.
_Avoid_: approval step, checkpoint, review stage

**Run**:
One attempt by one Agent on one Issue, with a status, a summary, timestamps, attached evidence, and the Member that triggered it.
_Avoid_: session, job, execution, attempt

**Activity**:
One entry an Agent posts to its Run while working: a thought, an action, an elicitation, a response, or an error.
_Avoid_: log line, step, message

### Workflow

**State**:
A step in a Project's workflow that an Issue is in at any moment.
_Avoid_: status, column, stage

**Workflow**:
The ordered set of States, Gates, and triggers that a Project's Issues move through.
_Avoid_: process, pipeline, board

### Attention

**Notification**:
A message to a Human derived from Events: a mention, a Gate awaiting them, a Run awaiting input, an assignment.
_Avoid_: alert, ping, message

**Channel**:
Where Notifications are delivered: the in-app inbox, a Slack channel through its webhook, later an email address.
_Avoid_: destination, provider, integration

### Record

**Event**:
An immutable record of one change in a Workspace: what changed, which Member did it, and when.
_Avoid_: activity, log entry, audit record

**Id**:
What names one row, in a shape that says what it is: a short prefix, an underscore, twelve characters —
`iss_k3xr8v2m9qpw` is an Issue, `mem_…` a Member, `run_…` a Run, `proj_…` a Project (the map is in
`docs/adr/0015-ids-are-prefixed-nanoids.md`). An Issue's **key**, `DEV-42`, is its public handle and not its id;
an Event's **seq** is a number, its place in the record.
_Avoid_: uuid, guid, primary key (in prose)
