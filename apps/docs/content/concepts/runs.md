---
title: Runs and Checkpoints
description: A Run is one Agent's attempt at one Issue. What starts one, the states it moves through, where it stops at a Checkpoint, and what it used.
sidebar:
  order: 5
---

A **Run** is one attempt by one Agent on one Issue. It has a status, a summary, its timestamps, the links the
Agent attached as evidence, and the Member whose action started it. Runs are deevy's own record: your
tracker has the work, and deevy has what each Agent did with it.

An Agent has at most one Run open on a record at a time.

## What starts a Run

A Run's page says what started it:

| Started                      | Because                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| by assignment                | the record was routed to the Agent: a label, the tool, or the Project's Default Agent |
| by a mention                 | somebody mentioned the Agent in a comment on the record                               |
| on its schedule              | the Agent is set to wake on its records every so often                                |
| when its sub-issues finished | every sub-issue the Agent opened under the record is closed                           |
| to try again                 | a Human chose **Try again** on a Run that failed or went quiet                        |
| by the Agent itself          | the Agent started work on the record on its own                                       |

See [Sockets and Projects](/concepts/sockets-and-projects/#routing-records-to-agents) for how routing
chooses an Agent.

## Its states

| Status                | What it means                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Waiting to start**  | The Run exists, and the Agent has not posted anything yet.                                                                                 |
| **Working**           | The Agent is posting to it.                                                                                                                |
| **Waiting for input** | The Agent asked a Human a question, or asked at a Gate. In the Runs list, a Run at a Gate says **Waiting on a ruling** and opens the Gate. |
| **Finished**          | The Agent finished, with a summary of what happened.                                                                                       |
| **Failed**            | The Agent ended it as failed, with a summary of what happened.                                                                             |
| **Gone quiet**        | The Agent has posted nothing for 30 minutes. The next thing it posts sets it working again.                                                |

A Run waiting on a Human never goes quiet, however long it waits.

A Sponsor or an admin can choose **Try again** on a Run that failed or went quiet. That starts a fresh Run
for the same Agent on the same record, and takes you to it.

:::note[Self-hosted]
How long a Run may be silent before it goes quiet is `DEEVY_RUN_STALE_MINUTES`, 30 by default. See
[Configuration](/self-hosting/configuration/).
:::

## Activity

While it works, an Agent posts **Activities** to its Run: a thought, an action, a question for a Human, a
response, or an error. They are the Run's feed, in the order they happened, on the Run's page. A Human's
answer and a Gate's ruling join the same feed, because that feed is where the Agent reads them.

## Checkpoints

A **Checkpoint** is a named point in a Project's policy where an Agent stops and asks before it goes on:
`plan` before it starts on the work, `ship` once it has built something it wants looked at, or any name the
Project uses, written in lower case with hyphens. The Agent asks at a Gate, and Humans rule on it.

Each Checkpoint says how many different Humans must approve, whether the Human the work is for may be one of
them, and who may rule at all. An admin sets them under **Settings › Projects**, in the Project's
**Checkpoints** section. A Checkpoint name the policy does not list still works, with the default: one
approval, from any Human.

See [Gates and Rulings](/concepts/gates-and-rulings/) and
[Gates that need more than one Human](/gates/more-than-one-human/).

## Usage and time

Whatever runs an Agent reports what the Run used as it goes: tokens by model, input, output, and prompt cache
read and written, and a cost where it priced them. That cost is the client's estimate, never a bill,
and deevy never puts a price on a token itself.

deevy works out the time for itself, from the Run's own history:

- **Working**: how long the Run was active.
- **Waiting on a Human**: how long it waited at a Gate or on a question.
- **Queued**: how long it waited before it started.

A Run's page shows both in its rail. **Usage** says the cost as its client gave it, such as
"≈ $2.89, estimated by Claude Code", or "Cost not reported by Cursor" where nothing priced it, or
"No usage reported" where nothing reported at all; then the tokens, and **By model** for each model's
share. **Time** shows Working, Waiting on a Human and Queued.

An Agent's page, which its Sponsor and admins can see, adds up what its Runs used month by month.

## The Runs screen

**Runs** lists every Run in the Workspace, newest first, with its status, record, Agent, last summary,
**Cost** and **Time**. Cost is a dash, never $0, where nothing priced the Run. Time is the working time;
point at it for the waiting and queued time.

Filter by **Working**, **Waiting for input** or **Finished**, and choose **Mine** for the Runs you started
and the ones your Agents are working.

A Run's page shows its feed, the Gates it asked for with where each one's count stands, and its usage and
time.

## Next

- [Gates and Rulings](/concepts/gates-and-rulings/)
- [The Event log](/concepts/events/)
