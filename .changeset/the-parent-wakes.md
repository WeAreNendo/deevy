---
"@deevy/core": minor
---

An Agent that splits work into sub-issues no longer has to sit and wait for them. It finishes its Run, and
when the last sub-issue closes it gets a new one to pick the work back up from — reading what its sub-issues
concluded off the Issue, the way anybody else would. Where there is no Agent left to wake, because it was
suspended or lost the Project, the Issue still says its sub-issues are done, so the work is visibly somebody's
rather than silently nobody's. A sub-issue in another Project counts exactly the same: done is done wherever
it is.
