---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/web": minor
---

**A Gate is a request on a Run.** An Agent that reaches a Checkpoint stops and asks, with a Proposal in markdown — what it intends to do, or what it has done — and Humans rule on that text.

A **Checkpoint** is policy on a Project: how many distinct Humans it wants, whether the Human the work is for may be one of them, and who may rule. It is edited in the Project's settings and saved whole, and a threshold nobody could meet is refused. A Checkpoint nobody configured asks one approval, of anybody. A rejection ends a request and asking again is a new one, so four-eyes holds by construction; the same Proposal asked twice is one question, and a changed one supersedes the old. A Run that asks with the Proposal an earlier Run on the same record had approved is answered with that approval, while it still meets the policy.

**Three doors, one ruling.** In deevy, on `/gates/<id>` — the link an Agent hands a Human — with `⇧A`, `⇧R` and `⌘↵`; in the tracker, by commenting `/approve` or `/reject <why>` on the record where deevy asked; and in Slack. Each door applies the same policy with the same refusals, and a ruling records which door it came through. One from a tool counts only from an account deevy can tie to the Human: the one they sign in with, one they linked under **Settings › Identities**, or, where an admin allowed it, an address they verified. A delegated token still cannot rule: `gates.approve` and `gates.reject` stay session-only.

One sign-in change comes with it: a signed-in Human can now link a second account whose address differs from theirs, for that explicit link only.
