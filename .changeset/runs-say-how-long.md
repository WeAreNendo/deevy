---
"@deevy/core": minor
"@deevy/db": minor
---

**Every Run now says how long it took.** Each Run in the API carries `timing`: `queuedMs`, from when it was created to when it started; `waitingMs`, the time it spent waiting on a Human, at a Gate or on a question, added up over every wait; and `workingMs`, the rest of its life. A Run still going counts until now, and a finished one stops at its finish. A stale Run's silence counts as working time, because nobody was waiting on a Human through it.

deevy works this out itself, so it is there for every Run, whatever ran the Agent. Two new columns on `run` are applied by the migrator at startup. A Run that was already waiting when you upgrade counts its wait from its next change.
