# What a Run spent: usage and time per Run, in vertical slices

The first item on [PLAN.md](../PLAN.md)'s "After Sockets" list, decided with Matt on 2026-09-26. Vocabulary is
[CONTEXT.md](../../CONTEXT.md). It is done when every Run shows what it spent — tokens by model, and a cost
wherever the thing that ran the Agent priced them — and how long it took, split into the time an Agent was
working and the time it waited on a Human; when the Runs feed shows both at a glance; and when an Agent's page
tells its Sponsor what the Agent costs a month. Budgets that stop spending are the next milestone, sized on
the numbers this one produces.

Six slices, in dependency order. Each is one PR on `main` and carries its own tests.

Why this and why now. deevy's promise is that a Human can hand work to an Agent and still be in charge of it.
"In charge" includes the bill. Today an operator running the reference runtime finds out what an Agent spent
from the model provider's invoice, a month later and for every Agent at once, and finds out how long a Run
took by reading timestamps. A Sponsor can approve a plan at a Gate without knowing that the Agent spent more
getting there than the work is worth. After Sockets, the work lives in the team's tools; what deevy uniquely
holds is the Run, and the Run is where the spend belongs.

## What is already there

- **Every harness already reads what it can.** A session's `done` event carries a `Usage`
  (`apps/agent/src/session.ts`): input and output tokens, and a cost in dollars when there is one. Claude
  Code reports tokens and a dollar estimate; OpenCode reports both per step, which the harness sums; Cursor
  reports tokens and no cost; Copilot's stream carries neither, and its totals live in a side file
  (`--usage-output-file`) the runtime does not read.
- **It stops there.** `work.ts` puts the usage into the supervisor's own result and its log line. Nothing
  reaches deevy: `runs.finish` takes a status and a summary, and the `run` table has no column for spend.
- **Time is mostly there.** `setRunStatus` (`packages/core/src/runs.ts`) is the one place a Run's status
  changes, and it stamps `startedAt` and `finishedAt`. The Event log has `run.awaiting_input` and
  `run.answered`, so when a Run waited is recorded — it is just not added up anywhere a list can read.
- **A resumed Run is a fresh session** (`work.ts`, "A resumed Run gets a fresh session"), so each session's
  totals are its own and adding them up does not count anything twice.
- **The screens have somewhere to put it.** `routes/runs/run.tsx` has a rail, `routes/runs/list.tsx` is a
  `DataTable` with columns, and `routes/settings/agent.tsx` is a stack of `SettingsSection`s.

## What is in the way

- **The Claude Code harness undercounts.** It reads the result's `usage`, which the Agent SDK documents as
  "MAIN AGENT LOOP ONLY — excludes Task subagent, sidechain, and auxiliary model calls … Prefer modelUsage
  for token/cost accounting". It also drops the prompt cache: `usage.input_tokens` excludes
  `cache_read_input_tokens` and `cache_creation_input_tokens`, which are most of an agent session's input.
  `modelUsage` has all of it, per model, with the cost of each and the price table it used (`costBasis`).
- **Money cannot be a float.** Sums of `0.1`-style dollar amounts drift; stored cost is integer
  micro-dollars.
- **A report can arrive twice.** The supervisor's HTTP call can be retried after a timeout it did not see
  succeed, so a report needs a key that makes the second one a replacement, not an addition.
- **Nothing is proof.** deevy never runs an Agent (PLAN.md's fourth differentiator), so every number is what
  the Agent's client said. A cost from Claude Code is, in the SDK's words, "an estimate, not a billing
  statement".

## Decisions taken with Matt, 2026-09-26

| Question                                | Decision                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How spend reaches deevy                 | **A report per session.** A new `runs.reportUsage`: each session adds its tokens, cost, model and harness to the Run, keyed so a retry replaces rather than adds. It is also an MCP tool, so any client can report, not only the reference runtime. Always shown as reported. |
| A harness that gives tokens and no cost | **Show the tokens and say the cost was not reported.** deevy never prices tokens itself. A total over Runs where some were not priced says how much of it is unpriced.                                                                                                        |
| Budgets                                 | **Accounting now, budgets next.** This milestone records and shows; the next one stops, sized on real numbers.                                                                                                                                                                |
| Where it shows                          | **The Run page and the Runs list, and the Agent's page.** A Workspace-wide Spend page, per-Project totals and per-record totals are deferred.                                                                                                                                 |

Reconciled in writing this: time needs no report. deevy derives it from its own state, so it is shown for
every Run, whoever ran the Agent. Human-driven sessions stay out of it, as
[ADR-0016](../adr/0016-a-run-is-an-agents-and-the-registry-says-which-way-an-operation-faces.md) already
says: "a new thing reported by the tool, not a Run".

## The model

### Vocabulary (CONTEXT.md)

- **Usage** — what a Run consumed, as the client that ran its Agent reported it: tokens by model (input,
  output, and prompt cache read and written), and a cost where the client priced them. An estimate, never a
  bill. _Avoid_: billing, charges, invoice, spend (as a noun of the system).
- **Working time** and **waiting time** — how long a Run was active, and how long it waited on a Human at a
  Gate or a question. Their sum, with the time before it started, is the Run's whole life.

### Data (`packages/db/src/schema/run.ts`)

New table `run_usage` (`use_`): `run_id` (cascade), `report` (the client's key for one session), `harness`
(`claude-code`, `opencode`, `cursor`, `copilot`, or a client's own word), `model` (nullable: a harness that
does not say), `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_micro_usd`
(nullable: not reported), `cost_basis` (nullable: `list`, `managed`, `unknown`, as Claude Code says it), and
`reported_at`. Unique on `(run_id, report, model)`: a report replaces the rows it wrote before, because a
harness's totals are running totals and the latest is the truth. Indexed on `run_id`.

New columns on `run`: `waiting_ms` (integer, default 0) and `waiting_since` (nullable timestamp).
`setRunStatus` sets `waiting_since` when a Run enters `awaiting_input` and, when it leaves, adds the interval
to `waiting_ms` and clears it — in the same `UPDATE` it already issues, so no statement is added.

No totals are denormalised onto `run`. A list reads them with one grouped statement over the page's Run ids;
a sum kept on the row would be a second source of truth for the same thing.

### Operations

- **`runs.reportUsage {runId, report, harness, models: [{model?, inputTokens, outputTokens, cacheReadTokens,
cacheWriteTokens, costUsd?, costBasis?}]}`** — `agentsOnly`, the Run's own Agent only, `mcp: true` (tool
  `runs_report_usage`), `POST /runs/{runId}/usage`. It replaces that report's rows, appends
  `run.usage_reported` with the Run's new totals, and answers them. Allowed while the Run is open and for a
  day after it finishes, so the report from a session that ended by finishing its Run still lands. Bounds: 20
  models a report, 100 reports a Run, non-negative integers, a cost under $10,000 a report.
- **`runs.get` and `runs.list`** carry `usage: {inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
costUsd | null, unpricedTokens, models: [...] }` (the per-model breakdown on `runs.get` only) and `timing:
{queuedMs, workingMs, waitingMs}`, where `costUsd` is null when nothing was priced and `unpricedTokens`
  says how much was not.
- **`agents.usage {memberId, months?}`** — admin or the Agent's Sponsor: per calendar month (UTC), Runs,
  tokens, priced cost, unpriced tokens, working and waiting time, and the average per finished Run. One
  grouped statement.

`run.usage_reported` is a new EventKind with its four consumers: `event-text.ts` ("reported usage: 1.2M
tokens, $3.40"), no Notification (it is not something anybody is waiting on), no mirror, and the snapshots.

### The runtime (`apps/agent`)

`Usage` becomes `{ models: ModelUsage[] }` with the same fields as the operation, and each harness fills it:

- **Claude Code** reads `modelUsage` rather than `usage`: every model the session used, its subagents
  included, with cache reads and writes, its own cost and `costBasis`.
- **OpenCode** adds its cache reads and writes to what it already sums, per model.
- **Cursor** reports tokens by model, and no cost.
- **Copilot** reads the file `--usage-output-file` writes when the session ends. Its format is checked
  against Copilot's published documentation before the slice starts, and if it carries no model or no
  tokens, Copilot reports what it has and the slice says so.

The supervisor reports once per session, when the session ends, over HTTP with `report` set to the session's
own id, before it settles the Run. It is not in the model's tool list: the model does not know what it cost,
and it is not asked.

### The screens

- **A Run's page** gets a **Usage** block in its rail: tokens with the cache shown apart, the cost with who
  estimated it ("≈ $3.40, estimated by Claude Code"), or "cost not reported by Cursor", the models on
  expanding, and **Working**, **Waiting on a Human** and **Queued**. A Run with no report says "No usage
  reported" — true of any Run not worked by the reference runtime until its client reports.
- **The Runs feed** gains two columns, **Cost** and **Time** (working time, with waiting time in the
  tooltip). A cost is a number or "—", never a guess.
- **An Agent's page** gets a **Usage** section: this month and last, Runs, cost and unpriced tokens, average
  cost and working time per finished Run, visible to admins and the Agent's Sponsor.

## The slices

0. **The table and the report** (M). `run_usage`, `runs.reportUsage` and its tool, `run.usage_reported`,
   `usage` on `runs.get` and `runs.list`, bounds, the snapshots. Acceptance: a report adds its models to the
   Run; the same report twice is one set of rows, the second's; two reports add up; another Agent's report
   and a Human's are refused; a report a day after the Run finished is refused; a cost arrives as dollars and
   is stored as micro-dollars with no drift over a thousand reports; `runs.list` spends one statement more for
   a page, and `budget.test.ts` records it.
1. **Time** (S). `waiting_ms` and `waiting_since`, kept by `setRunStatus`; `timing` on the reads.
   Acceptance: a Run that waits twice at Gates reports the sum; a Run waiting now counts until now; a stale
   Run's silence is working time; `queuedMs` is creation to start.
2. **The runtime reports** (M). `Usage` by model, the four harnesses as above, the supervisor's report per
   session. Acceptance: recorded stream lines from each harness produce the models and cache counts the
   harness said, Claude Code's from `modelUsage` with its subagent's model included; a session that dies
   reports what it got to; the acceptance walk (`vp run agent#acceptance`) ends with the Run's usage in
   `runs.get` on both deployments.
3. **The Run's page and the feed** (M). The Usage block, the two columns, the words for each absence.
   Acceptance: the block names who estimated the cost; a Cursor Run says the cost was not reported; a Run
   with no report says so; the columns sort; nothing shows a price deevy computed. Checked in the browser on
   the `seeded` configuration, whose seed gains Runs with usage from each harness.
4. **The Agent's page** (S). `agents.usage` and the Usage section. Acceptance: a month's totals equal the sum
   of its Runs; unpriced tokens are said, not folded in; a Member who is neither an admin nor the Sponsor gets
   `FORBIDDEN`.
5. **The record** (S). OPERATIONS.md: what is counted, whose estimate it is, how a client that is not the
   reference runtime reports, and that a report is trusted as far as the Agent's credential is. CONTEXT.md's
   entries, PLAN.md's list moved on, and what each slice found.

## Conventions every slice follows

The Sockets milestone's: a changeset per package change, written for somebody upgrading; `vp check`, `vp run
-r test`, `web#build:workers` and `web#check:workers` green; a new EventKind lands with its consumers; the
statement budget ratcheted in `budget.test.ts`; a harness is tested against recorded lines, never a live
model.

## Deferred

Budgets and caps, per Run and per Agent per month, with what stops when one is hit — the next milestone.
Per-Project and per-record totals; a Workspace Spend page and a CSV export; a price table for models a
harness does not price; usage for a Human's own sessions (ADR-0016); converting currencies.

## Risks

- **The numbers are the client's.** An Agent's credential can report anything for its own Runs. The Run page
  says whose estimate a cost is, and OPERATIONS says a report is trusted as far as the credential is.
- **Harness formats move.** Claude Code's `modelUsage` has fields older builds lack (`costBasis`,
  `canonicalModel`, `thinkingTokens`); a harness is read field by field, an absent field is not a zero, an
  unknown one is ignored, and each is tested against recorded lines.
- **Copilot may not say enough.** If its usage file has no model or no tokens, a Copilot Run shows time and
  "no usage reported", which is the truth.
- **A Run that never reports** — worked by a client that does not know the operation — shows time and "No
  usage reported". The feed's totals say how many Runs are unreported, so an average is never quietly low.
