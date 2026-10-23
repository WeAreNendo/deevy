---
title: Gates that need more than one Human
description: Ask for two or more approvals at a Checkpoint, keep the Human the work is for from approving it themselves, and name who may rule.
sidebar:
  order: 2
---

By default a Gate wants one approval, from any Human. For work that deserves a second pair of eyes, a
Project's Checkpoints can ask for more: several approvals, none of them from the Human the work is for, from
the Humans you name.

## Set a Checkpoint's policy

You need to be an admin.

1. Open **Settings › Projects** and choose the Project.
2. In **Checkpoints**, choose **Add a Checkpoint**, or change one already there.
3. Give it the **Name** your Agents ask at, such as `plan` or `ship`: lower case, with hyphens.
4. Set **Approvals**: how many different Humans must approve.
5. Tick **Not the Human the work is for** to keep that Human from approving it. They can still reject it.
6. Under **Who may rule**, tick the Humans who may. Ticking nobody means every active Human.
7. Choose **Save policy**.

The list is saved as a whole: a Checkpoint you remove from it and save is gone, and its name falls back to
the default. A Checkpoint an Agent asks at that is not on the list wants one approval, from any Human.

| Setting                           | Default      | What it does                                                                         |
| --------------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| **Approvals**                     | 1            | The Gate stays open until that many different Humans approve.                        |
| **Not the Human the work is for** | off          | The Human the Run is for is not asked, and cannot approve it. They can still reject. |
| **Who may rule**                  | nobody named | Only the Humans named may rule. Nobody named means any Human.                        |

## Who the work is for

The Human the work is for is whoever started the Run, where that was a Human. Where routing or the Agent
started it, it is the Agent's Sponsor: the Human accountable for what the Agent is about to do.

At a Checkpoint with **Not the Human the work is for** ticked, that Human cannot be one of the approvals, but
they are not shut out: they can still reject, on the Gate's page, on the record or in Slack. Agreeing to the
work takes somebody else; stopping it does not.

## How the count works

- **Each Human counts once.** Two approvals means two different Humans. You cannot rule twice on one Gate.
- **One rejection ends the Gate**, however many approvals it wants, and it can come from anybody who may
  rule, the Human the work is for included. Asking again is a new Gate, and the approvals on the old one
  are spent.
- **The count is in plain sight**: `1 of 2` on the Gate, on **Needs me**, on the Run's page, and in the
  comment on the record ("Approved: 1 of 2, still waiting").
- **A changed Proposal starts again.** If the Agent changes what it is asking, approvals given to the old
  Proposal do not carry over.
- **An approval stands for its record.** A later Run on the same record that asks with the same Proposal at
  the same Checkpoint goes past without asking anybody, as long as the earlier Gate had as many approvals
  as the Checkpoint asks for now. Raise **Approvals** and it asks again. Who gave them is not checked
  again, so a change to **Who may rule** applies to new Proposals, not to one already approved.

## Who is asked

A Gate asks the Humans who could approve it: the ones named under **Who may rule**, or every active Human
where nobody is named, leaving out the Human the work is for where the Checkpoint excludes them. Each of them
gets it on **Needs me**, in the Inbox, and wherever else they hear about Gates. The Human the work is for is
not asked, since the Gate is not waiting on them, but can still open it and reject it.

## Before you turn these on

**Saving refuses a policy nobody could meet.** If a Checkpoint wants more approvals than there are Humans who
could give one, **Save policy** says so: "The ship Checkpoint wants 2 approvals and only 1 Humans could give
one". Leaving out the Human the work is for costs one Human from every count, so:

- a Workspace with one Human cannot use **Not the Human the work is for** at all;
- two approvals with it on needs three Humans.

**Suspending a Member can leave a Gate short.** Suspended Members cannot rule and are not counted. A Gate
that wants two approvals in a Workspace of two Humans is fine until one of them is suspended; then it waits.
The Gate says so above **Approve**, to everybody who opens it, with both numbers: "This Gate still wants 2
approvals and only 1 Human can still give one." The Humans it counts are the active ones who may rule there,
less the Human the work is for where the Checkpoint leaves them out, less anybody who has already approved.

deevy never lowers the count for you. An admin either reinstates the Member, or lowers the Checkpoint's
**Approvals**. Approvals already given still count, so approving a short Gate is not wasted. Where nobody has
approved and nobody is left who could, no number helps, and the Gate only says that an admin can reinstate a
suspended Member.

## Lowering Approvals on a waiting Gate

When you lower a Checkpoint's **Approvals** and choose **Save policy**, every open Gate at that Checkpoint
on that Project that already has as many approvals as it now wants passes there and then, as if the
threshold had been that low when its last approval came in. The Run goes back to working and the Agent is
told; the Gate's history, the Run's feed and the comment on the record say it passed because you lowered
**Approvals**, not that you approved it. A Gate with fewer approvals than the new number stays open until
it has them. Removing a Checkpoint from the list counts as lowering it to the default, one.

Only the number does this. Unticking **Not the Human the work is for** lets that Human approve from then on,
but never counts an approval they were refused before: it was never recorded.

**Agents still never rule**, whatever these are set to, and **Who may rule** can only name Humans.

## Next

- [How a Gate asks](/gates/how-a-gate-asks/)
- [Ruling from the tracker or Slack](/gates/ruling-from-your-tools/)
