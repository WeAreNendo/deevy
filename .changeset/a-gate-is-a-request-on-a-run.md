---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/web": minor
---

**Gates are back, as a request on a Run.**

An Agent that reaches a Checkpoint stops and asks, carrying a Proposal in markdown: what it intends to do, or what it has done. Humans rule on that text. There is no Workflow, nothing enters a state, and an Issue is still just what the tracker says it is.

A **Checkpoint** is policy on a Project: a name, how many distinct Humans a request to pass it wants, whether the Human the work is for may be one of them, and which Humans may rule at all. `checkpoints.set` replaces a Project's whole list and refuses a threshold nobody could meet. A Checkpoint nobody configured gets the default — one approval, from anybody — so an Agent asking about `security-review` in a Workspace that never heard of it is answered rather than stranded.

**A visit is a request.** Approvals are counted on one row; a rejection ends it; asking again is a new row one visit later. Asking twice with the same Proposal is one question, and a changed Proposal supersedes the old one rather than editing it under the Humans already reading it. Four-eyes is true by construction: nothing accumulates across visits, so nothing has to clear it.

New operations: `gates.request` (an Agent's alone, and a tool), `gates.get` (a tool, the polling half), `gates.list` with `mine` for what is waiting on you, and `gates.approve` / `gates.reject`, which stay `sessionOnly` — a Human present in deevy, never a token they delegated to a client. `checkpoints.list` and `checkpoints.set` beside them.

Every Ruling goes through one function, whichever door it came through, and the decision records which: `web` today, `socket` and `slack` as those doors open. The MCP tool set is seventeen; over MCP the ask is a URL elicitation for a client that can take one and the request itself for every client that cannot.

New Events: `gate.requested`, `gate.superseded`, `gate.approval` (which says how many of how many), `gate.approved`, `gate.rejected`. New tables: `checkpoint`, `checkpoint_approver`, `gate_request`, `gate_decision`.

The Gate screen at `/gates/<id>` is the next release; until then the link an Agent hands a Human opens a page that does not exist yet, and rulings go through the API.
