---
"@deevy/agent": patch
---

The runtime no longer goes down when the git it serves a local repository with answers before it has read
the whole request, or is not there to be started. Both showed up as a crash of the supervisor rather than
as a failed push, and only with a repository on disk as the remote — the acceptance walk and the tests —
never with a remote on the internet. A backend that finishes early now has its answer relayed as it was,
and a git that cannot be started is a 502 that says so.
