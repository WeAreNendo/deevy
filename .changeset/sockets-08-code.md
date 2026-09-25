---
"@deevy/agent": minor
"@deevy/core": minor
"@deevy/sockets": minor
---

**deevy hands a Run its repository, and opens its pull request.** `runs.checkout` gives the runtime's supervisor the repository, the base branch, a branch deevy names (`deevy/<record>-<run>`) and a credential that expires — on GitHub, a one-hour token for one repository. It is never a tool, so the credential stays out of a model's context and out of the log.

`pulls.open` opens the pull request, or merge request, through the Project's forge with `Closes <the record's URL>` and the Run's id, and attaches it to the record. A Run has one: asking again answers with the one it already has.

The runtime needs no repository or token of its own any more. `DEEVY_AGENT_REPO`, `DEEVY_AGENT_GIT_TOKEN` and `DEEVY_AGENT_BASE_BRANCH` are now an override, for a repository deevy has no Socket for, and `DEEVY_AGENT_GITHUB_API` and `DEEVY_AGENT_GITHUB_REPO` are gone.
