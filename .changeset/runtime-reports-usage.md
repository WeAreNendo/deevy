---
"@deevy/agent": minor
---

**The reference runtime now reports what each session of a Run spent.** When a session ends, however it ended, the supervisor reports its tokens by model, prompt-cache reads and writes, and cost to deevy with `runs.reportUsage`, under the name of the harness that counted them. A Run that resumes after a Gate reports each session separately, and deevy adds them up. A report deevy refuses never changes how the Run itself ended.

**Claude Code's tokens were undercounted, and now they are not.** The runtime read the result's `usage`, which covers the main loop only: it leaves out subagents, and its input count excludes the prompt cache. It now reads `modelUsage`, which has every model, the cache, and each model's cost with the price table Claude Code used. OpenCode now counts the prompt cache too. Cursor reports tokens and no cost, since it prices nothing. Copilot's tokens come from the file its `--usage-output-file` flag writes when it exits, with no cost, since Copilot counts in AI units rather than dollars. Where a harness doesn't name the model, the Run's usage names the one `DEEVY_AGENT_MODEL` asked for.
