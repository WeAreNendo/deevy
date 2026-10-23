---
"@deevy/core": patch
"@deevy/web": patch
---

A Project's `routing.mention` now does what it says. Set to `false`, a comment that mentions an Agent in that Project, as `@deevy planner` or `@planner`, starts no Run for it; the comment is still recorded, and whoever it names still gets a Notification. Labels, assignment in the tool and the Default Agent route as before. Every Project created so far has it on, so nothing changes until you turn it off: with **Route by mention**, a new switch beside **Routing label** in a Project's settings, or `deevy projects update <slug> --routing '{"labelPrefix":"agent:","mention":false}'`, which sets both fields, so give your own label prefix there if it isn't `agent:`. A Project that had it set to `false` through the API before this release stops starting Runs from mentions once you upgrade.
