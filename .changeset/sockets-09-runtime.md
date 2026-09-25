---
"@deevy/agent": minor
---

**The reference runtime works a record in your tracker.** A session reads the record and its conversation, says what it intends and stops at a Checkpoint, splits work that is too big into sub-issues, and on approval builds, commits as the Agent, pushes and opens the pull request — through fourteen tools, listed in `apps/agent/src/instructions.md`. It has its file and shell tools whenever its Run has a repository.

A Run waiting at a Gate cannot go stale: only a Human un-waits it, and a Human is told once per question.
