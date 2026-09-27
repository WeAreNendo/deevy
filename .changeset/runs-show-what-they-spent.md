---
"@deevy/web": minor
"@deevy/server": patch
---

**A Run's page now shows what it spent and how long it took.** Its rail has a **Usage** section and a **Time** section:

- **Usage** shows the cost as the harness's estimate, and says whose ("≈ $2.89, estimated by Claude Code"). Where the harness priced nothing it says "Cost not reported by Cursor", and where nothing reported it says "No usage reported". Tokens are shown with the prompt cache apart, and each model behind a disclosure.
- **Time** splits the Run into working, waiting on a Human, and queued.

**The Runs feed has Cost and Time columns.** A dash, never $0, marks a Run nobody priced, and the tooltip on Time holds the waiting and queued time. The feed's "Last" column now takes the width the others leave, so a Run's summary is readable instead of cut to a word.

The `seeded` example data now includes Runs with usage from each harness.
