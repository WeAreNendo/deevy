---
"@deevy/core": patch
"@deevy/db": patch
---

Two sub-issues of one parent finishing at the same moment no longer starts the parent's Agent twice. "At most
one open Run per Issue and Agent" was a rule every caller checked for itself, which only held while nothing
happened at once — and the ordinary ending of a fan-out is two things happening at once. The database keeps
the rule now. If your instance already has duplicate open Runs from before this, the migration closes the
later one and says so in its summary.

Opening a sub-issue also got cheaper: it was spending more statements than a Cloudflare D1 request allows on
the deepest tree the default limits permit, so on the Worker deployment it would have failed outright. Raising
the "Levels deep" limit no longer makes that write more expensive at all.
