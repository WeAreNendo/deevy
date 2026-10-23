---
title: How a Gate asks
description: Where a Gate waiting on you shows up, what its page tells you, how to approve or reject it, and what happens to the Run afterwards.
sidebar:
  order: 1
---

When an Agent reaches a Checkpoint, it stops and asks at a Gate, with a Proposal saying what it intends to do
or what it has done. The Run waits until the Humans who may rule have decided. This page is about answering.

## Where it reaches you

A Gate you may approve shows up in several places at once. Answer it in whichever you are already in:

- **Needs me**, deevy's home page, under **Gates awaiting you**: a card per Gate with its Checkpoint, the
  first line of the Proposal, the record's key, the Agent, how long it has waited, and how many approvals it
  has, such as `0 of 1`.
- **Inbox**, as a Notification that the Agent "wants your ruling at plan". On a wide screen, choosing it opens
  the Gate beside the list, ready to rule.
- **Your tracker**, as a comment on the record with the Proposal and how to rule from there, if the Project
  mirrors Gates. See [Ruling from the tracker or Slack](/gates/ruling-from-your-tools/).
- **Slack**, in a room your admin routed Gates to, or as a direct message once your Slack account is linked
  under **Settings › Identities**. Signing in to deevy with Slack doesn't link it on its own: it is linked
  the first time you click **Approve** or **Reject** in a room, or when you type `/deevy link` in Slack.
- **Email**, at the address your sign-in confirmed. See [Email](/notifications/email/).

The Agent can also hand you the Gate's own link. From a terminal, `deevy gates open acme/deevy#42` opens the
Gate waiting on that record in your browser.

If a Gate is still waiting four hours later, its Notification comes back unread in the Inbox of everyone it
is still waiting on, which leaves out whoever has already ruled, and again every four hours until the Gate
is decided. A Run waiting on a plain question is reminded the same way.

:::note[Self-hosted]
The reminder interval is `DEEVY_GATE_REMINDER_HOURS`, 4 by default. See
[Configuration](/self-hosting/configuration/).
:::

## What the Gate's page shows

The Gate's page answers four things at a glance: what is proposed, on which record, where the count stands,
and whether you may rule.

- **The heading** is the record's title, with its key linking to the record where it lives, and which Agent
  asked at which Checkpoint. A Gate asked a second time on the same Run says which visit it is.
- **The Proposal**, in full, as the Agent wrote it.
- **Evidence**: the links the Agent attached, such as a pull request or a design.
- **The ruling card**: **Waiting on a ruling**, the count (`1 of 2`), a **Note**, and **Approve** and
  **Reject**.
- **Gate decisions**: every Ruling so far, who made it, what it was, and where: "in deevy", "in Slack",
  "via GitHub".
- **The Run that stopped here**: its status and the last few things it did.

## Approve or reject

1. Read the Proposal, and open the evidence if you need to.
2. Write a **Note** if you have something to say. It is optional, but on a rejection it is what the Agent
   reads to know what to change.
3. Choose **Approve** or **Reject**.

From the keyboard, `⇧A` or `⇧R` chooses and puts you in the Note, and `⌘↵` (`Ctrl+Enter`) commits. Nothing
commits on a single key.

Ruling in deevy needs you signed in to deevy in your browser. Your MCP client, the CLI and an Agent's key
cannot approve or reject anything.

### When you cannot rule

Where you may not rule on a Gate still waiting, the card says why in place of the keyboard hints, and
**Approve** and **Reject** are greyed out. The reasons are the server's own, so they are exactly what would
refuse you:

- you have already ruled on this Gate;
- the Checkpoint names who may rule, and you are not one of them.

Once a Gate is decided the buttons are gone, and the card says **This Gate was approved**, **rejected** or
**superseded**.

### When you can only reject

Where the Checkpoint wants somebody other than the Human the work is for, and that is you, only **Approve**
is greyed out. The card says the Checkpoint wants somebody other than the Human this Run is for to approve
it, and that you may still reject it. **Reject** works as it does for anybody, with `⇧R` and your Note, and
ends the Gate. The Gate is not waiting on you, so it is not on your **Needs me** or in your Inbox, but you can
open it from the Run, the record or its link.

See [Gates that need more than one Human](/gates/more-than-one-human/).

### When the Gate is short

If the Humans left who could approve are fewer than the approvals the Gate still wants, usually because
somebody was suspended after the Checkpoint was set, the card says so above **Approve**, with both numbers:
"This Gate still wants 2 approvals and only 1 Human can still give one." Your approval still counts if you
give it. An admin can lower **Approvals** on the Checkpoint, which passes the Gate at once if it already
has that many, or reinstate a suspended Member, and the card says which of those can still help.

## What happens to the Run

- **An approval short of the count** adds one to it. The Gate stays open, the Run keeps waiting, and where
  the Project mirrors Gates, a comment on the record says how many it has.
- **The approval that meets the count** approves the Gate. Your Ruling and your note join the Run's feed,
  the Run goes back to working, and the Agent is told.
- **A rejection** ends the Gate at once, whatever the count. Your Ruling and your note join the Run's feed,
  and the Agent is told. The Run is not over: the Agent can change course and ask again, which is a new Gate,
  one visit later.
- **An admin lowering Approvals** to what the Gate already has approves it, the Run goes back to working,
  and the Agent is told the threshold was lowered. See
  [Lowering Approvals on a waiting Gate](/gates/more-than-one-human/#lowering-approvals-on-a-waiting-gate).

If the Agent changes its Proposal while the Gate is open, the Gate is superseded and the new Proposal asks
afresh. Approvals on the old one do not carry over.

## Next

- [Gates that need more than one Human](/gates/more-than-one-human/)
- [Ruling from the tracker or Slack](/gates/ruling-from-your-tools/)
