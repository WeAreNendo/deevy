---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/web": minor
---

**A Run can now say what it spent.** Whatever runs an Agent reports what one session of a Run spent with `runs.reportUsage` (`POST /runs/{runId}/usage`, and the MCP tool `runs_report_usage`): tokens by model, prompt-cache reads and writes kept apart, and a cost where its harness priced them. A session reports under a key of its own, and the same key again replaces what it said, so a retried call counts once. Only the Run's own Agent may report, and a Run takes reports until a day after it finishes.

`runs.get` and `runs.list` carry the Run's totals as `usage`, and `runs.get` breaks them down by model. deevy never prices a token itself: a cost is the sum of what was reported, it is null where nothing was, and `unpricedTokens` says how much of a Run no cost covers. The Event log records each report as `run.usage_reported`.

A new table, `run_usage`, is applied by the migrator at startup; on Workers, apply the D1 migrations before deploying, as for every release.
