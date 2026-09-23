---
"@deevy/core": minor
"@deevy/sockets": minor
---

The reference runtime works a record in your own tracker, end to end.

An Agent's session no longer writes Documents or moves an Issue through a Workflow. It reads the record and
the conversation on it, says what it intends to do and stops at a Checkpoint, splits the work where it is too
big, and on approval builds, pushes and opens the pull request — all through thirteen tools, listed in
`apps/agent/src/instructions.md`.

Where a Run's code comes from changed with it. deevy mints the credential, names the branch and opens the
pull request from the Project's forge Socket, so the runtime no longer needs a repository or a GitHub token
of its own: `DEEVY_AGENT_REPO`, `DEEVY_AGENT_GIT_TOKEN` and `DEEVY_AGENT_BASE_BRANCH` are now an override for
a repository deevy has no Socket for, and `DEEVY_AGENT_GITHUB_API` and `DEEVY_AGENT_GITHUB_REPO` are gone.

Four fixes came out of running the milestone's acceptance walk:

- A Run waiting at a Gate is no longer moved back to `active` by anything said to it, so it cannot be swept
  as stale while a Human is deciding. Only a Human un-waits one.
- A Human is told once per question: `run.awaiting_input` is appended when a Run begins to wait, not every
  time something is said to a Run that is already waiting.
- One pull request per Run. `pulls.open` answers with the one this Run already has rather than opening a
  second.
- `runs.checkout` answers `null` for a Project bound to no repository instead of refusing, because that is an
  ordinary Project and a supervisor asks on every Run.

`issues.get` now carries the Checkpoints its Project asks a Run to stop at, and `health.ping` reports
`devSockets`. `DEEVY_DEV_STUB_SOCKETS=1` (with `DEEVY_DEV_STUB_CONTAINERS`) registers an in-process tracker
and forge, so deevy can be tried end to end with no GitHub App, no tunnel and no account anywhere.
