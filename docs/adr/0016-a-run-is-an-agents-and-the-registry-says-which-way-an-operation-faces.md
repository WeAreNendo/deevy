# A Run is an Agent's, and the registry says which way an operation faces

> Amended by [ADR-0035](./0035-only-agents-speak-mcp.md): every MCP tool faces an Agent, and the tools that
> faced a Human left MCP with the Human's client. An operation still faces whoever its `auth`, `agents` and
> `agentsOnly` say.

Walking the Human MCP path with a real Claude Code (docs/plans/m2.md, "Walked with a real Claude Code")
showed a Human's own client twenty tools, four of which it could never call: `runs_start`,
`runs_post_activity`, `runs_finish` and `runs_request_approval` each refused a Human, one in its handler and
three by way of "this Run belongs to another Agent". The question that raised was not the tool list. It was
whether a Human, through their own Claude Code, should have Runs at all.

## The decision

**A Run stays one Agent's attempt on one Issue** (CONTEXT.md), and the registry now says so where it can be
checked. `OperationMeta` gains `agentsOnly?: true`, sayable only beside `agents: true` on a `member`
operation, and `authorize()` refuses a Human with "Only an Agent can do that" in the same middleware that
refuses an Agent an unmarked operation (ADR-0011). The four operations that write a Run carry it. The MCP
`tools/list` filter reads the same flag, so a Human's client is offered what it may call and nothing else,
exactly as an Agent's is; the filter is still display, and the middleware is still the rule.

Three operations became tools in the same change, because the walk showed what a Human's client is for.
`runs_answer`, so a Human answers an Agent's question from the client they read it in; it faces the Human
and no Agent. `issues_move` and `projects_get`, so a Human, or an Agent that is done with an Issue, can put
it in the next State and knows which State that is. A Gate is still left by a ruling and never by a move,
which `assertLeavable` already enforced.

## Why a Human does not get a Run

Every job a Run does exists because the Agent is absent: the `pending` row is the queue a runtime claims,
the status is the sign of life, the Activities are the only record of its reasoning, `requestApproval` and
`answer` are how a question crosses to a Human and back, and the Link's `runId` says which attempt produced
the pull request. A Human driving Claude Code is present for all of it. Their work is visible where every
developer's is — commits, pull requests, Documents, comments, the Issue's State — and it is theirs because the
credential is theirs (ADR-0007, ADR-0010), not because a Run says so.

## Considered options

- **A Run for any Member.** One condition removed from `runs.start`, and then: the stale sweep marking a
  Human's Run `stale` after thirty minutes without an Activity; `run_finished` Notifications sent to the Human
  about their own Run; `requestApproval` becoming a Human asking approval of themselves, which is the one
  separation the product is built on (ADR-0004); a model's thoughts recorded as a Human's; and every screen
  and trigger that says a Run is an Agent's. Rejected: it trades a display problem for a model problem.
- **Hide the four tools from a Human and change nothing else.** The list would be honest and the handler
  checks would stay scattered, one `BAD_REQUEST` and three `FORBIDDEN`s, with nothing stopping the next Run
  operation from forgetting its check. Rejected in favour of a rule the registry states once.
- **A single `actor` field replacing `agents: true`.** Cleaner in the abstract, thirty operations edited, and
  ADR-0011's language rewritten. Rejected for now; `agentsOnly` is the mirror of a field that exists.

## Consequences

- An Agent's client is offered twenty-two tools; a Human's, nineteen. `packages/core/mcp-tools.json` records
  `agents` and `agentsOnly` for each, so the facing of every tool is reviewed like the set itself.
- A Human's Claude Code has a worked example of its own, `docs/as-yourself.md` (removed with ADR-0035), beside
  the Agent's in [docs/agent-loop.md](../agent-loop.md). The Agent's instructions did not change: its tools
  are granted by name (ADR-0014), so a wider set is not a wider runtime.
- If cost or time accounting of Human-driven sessions is ever wanted, it is a new thing reported by the
  tool, not a Run.
