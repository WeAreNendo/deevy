# An approval stands for its record

Amends [ADR-0024](./0024-an-issue-is-a-projection-of-a-record-in-a-socket.md), which made a Gate a Run's
request to pass a Checkpoint, and leaves [ADR-0020](./0020-a-gate-may-want-more-than-one-human-and-may-exclude-the-one-who-asked.md)'s arithmetic
and [ADR-0025](./0025-the-forge-may-vouch-for-the-human-who-rules.md)'s doors untouched.

A Gate belongs to a Run. A Run is one attempt, and attempts fail for reasons that have nothing to do with the
work: the first real GitHub walk (2026-09-25) had a Human approve a plan, then watched the Run fail because
its session could not write a file. The next Run on the same record read the history, saw the approval, and
built without asking — the Agent's own judgement, which happened to be right. This records whose judgement
that is.

## The decision

**deevy decides whether an approval still stands, and the Agent always asks.**

When `gates.request` is asked to pass a Checkpoint on a record where a Gate at that same Checkpoint, for that
exact Proposal, was approved — by this Run or an earlier one on the same record — and that Gate's approvals
still meet the Checkpoint's policy as it stands now, the answer is that Gate. It is returned as it is, status
`approved`; the Run does not move to `awaiting_input`; nobody is asked; and deevy writes an Activity into the
Run naming the Gate it went past on. No Ruling is copied onto a new Gate: the Humans ruled once, on that
text, and the record of it stays where they made it.

Anything else is asked afresh, exactly as before:

- A **changed Proposal** is a different question. So is one that differs by a word: the match is exact.
- A **Checkpoint that now wants more** — two approvals where the Gate had one — is asked again, because the
  policy that governs a Ruling is the one in force when the work goes past it.
- A **rejection** carries nothing. A rejected Gate is answered by a new Proposal, one visit later.

The Agent's instructions say to ask even when an earlier Run's plan was approved, and to treat an answer that
comes back `approved` as the Checkpoint passed.

## Why deevy and not the Agent

An Agent that reads the history and decides for itself is an Agent deciding when a Human's approval applies,
which is a small version of the thing [ADR-0004](./0004-agents-never-approve-gates.md) says an Agent never
does. It was right in the walk because the Proposal was identical and the policy unchanged; nothing held it to
either. deevy can hold it to both, in one place, the same way for every Agent and every harness.

## Why per record and not per Run

Asking again on every Run would have been the stricter rule, and it would have asked a Human to re-approve a
plan they approved minutes earlier, word for word, because the machine carrying it out fell over. That is
friction with no protection in it: the question is the Proposal, and the Proposal did not change. A record is
the unit a Human thinks in — "the greeting script" — and an attempt is not.

## The cost, stated

- **An approval can outlive the Run it was given to.** A Human who approved a plan for one attempt has
  approved it for the next attempt on the same record. The Activity in the new Run links the Gate, so where
  it came from is one click away, and a Human who wants to withdraw it can change the Checkpoint's policy.
- **One more read per request.** Asking at a Checkpoint costs 20 statements where it cost 19
  (`budget.test.ts`).
- **The match is exact, so it is easy to miss.** An Agent that rewords its plan on the second attempt asks
  again. That is the safe direction to be wrong in.
