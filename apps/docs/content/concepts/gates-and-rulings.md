---
title: Gates and Rulings
description: A Gate is a Run asking to pass a Checkpoint, with a Proposal saying what it intends. Humans rule on it; an Agent never can.
sidebar:
  order: 6
---

Some decisions are a Human's to make: whether a plan is the right one, whether work is ready to ship. deevy
holds those at **Gates**. An Agent reaches a Checkpoint, stops, and asks; Humans rule; only then does the
Run go on.

## Checkpoint

A **Checkpoint** is a named point in a Project's policy, such as `plan` or `ship`. For each one, the policy
says:

- how many different Humans must approve;
- whether the Human the work is for may be one of them;
- who may rule at all.

A name the policy does not list gets the default: one approval, from any Human. See
[Gates that need more than one Human](/gates/more-than-one-human/).

## Gate

A **Gate** is a Run's request to pass a Checkpoint: the Agent's Proposal, the links it attached, and the
Rulings on it so far. While it is open:

- the Run waits, as long as it takes, and never goes quiet;
- the Humans who may rule are told, and reminded while nobody has decided;
- the record in your tracker says it is waiting, if the Project mirrors Gates.

A rejection ends the Gate. If the Agent asks again, that is a new Gate, one visit later, and any approvals
on the old one are spent.

An approval stands for its record. When a later Run on the same record asks with the same Proposal at the
same Checkpoint, deevy answers it with the Gate already approved and the Run goes on without asking anybody,
as long as those approvals still meet the Checkpoint as it is set now. The Run's feed names the Gate it
went past on.

## Proposal

A **Proposal** is what the Agent attaches to a Gate, in markdown: what it intends to do, or what it has
done. It is what you rule on. A Proposal never changes on its Gate: if the Agent changes it, the old Gate is
superseded and a new one asks the question afresh.

## Ruling

A **Ruling** is a Human's decision on a Gate, approve or reject, with a note if they want to add one. You
can make it in three places, and each is the same Ruling, under the same Checkpoint's rules:

- **in deevy**, on the Gate's own page;
- **on the tracker**, by commenting `/approve` or `/reject` with your reason on the record;
- **in Slack**, with the **Approve** and **Reject** buttons on the Gate's message.

Every Ruling is recorded with where it came from, and the Gate shows it: "in deevy", "in Slack",
"via GitHub". See [How a Gate asks](/gates/how-a-gate-asks/) and
[Ruling from the tracker or Slack](/gates/ruling-from-your-tools/).

## Who can never rule

**An Agent never rules on a Gate**, its own or any other, whatever it has been granted. Neither does any
credential deevy issued: an Agent's API key, a token your own MCP client holds, or the CLI signed in as you.
A Ruling in deevy needs you there in a browser, signed in as yourself; a Ruling from a tool needs that tool's
account to be one of your Identities.

That is the point of a Gate: the Agent does the work and asks, and a Human answers for letting it through.

## Next

- [How a Gate asks](/gates/how-a-gate-asks/)
- [The Event log](/concepts/events/)
