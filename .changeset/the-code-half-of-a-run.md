---
"@deevy/core": minor
"@deevy/sockets": minor
"@deevy/web": minor
---

**An Agent can clone the repository behind a Project, and deevy opens the pull request.**

`runs.checkout` answers a Run with the repository to clone, the base branch, the branch to cut, and a credential that expires. For GitHub that is an installation token: one hour, one repository. deevy names the branch — `deevy/<record>-<run>` — so the runtime never invents one and two attempts at a record cannot collide. A Run resumed after a Gate asks again and gets a fresh one.

It is **not** a tool, and that is deliberate: it answers with a credential, and a credential in a model's context is a credential in a transcript. The supervisor calls it over HTTP and keeps the token to itself, exactly as ADR-0014 and ADR-0019 describe. The log records that a checkout was issued and never what it was.

`pulls.open` opens the pull request through the Project's forge Socket, with the title and body written from the Run's own summary, `Closes <the record's URL>` so a merge closes it where the team reads it, and the Run id so a pull request points back at the attempt that produced it. The pull request is attached to the record as evidence, carrying the Run, and `run.pull_request_opened` goes in the log.

Opening it is its own operation rather than something `links.add` does on the side: a write to a third party hidden inside a link operation is the opposite of saying what a tool does.

A Project with no repository answers `NOT_FOUND`, which is ordinary — a tracker with nothing to build is a perfectly good Project.

The MCP tool set is eighteen: `pulls_open` joins it, and `runs_checkout` is absent by design.
