---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/web": minor
"@deevy/server": minor
"@deevy/sockets": minor
---

**deevy no longer has a tracker of its own. Your work stays where it already is, and deevy connects to it.**

This is a clean break. The migration history is re-baselined to a single migration, so this version starts from an empty database and there is no upgrade path from 0.8. Do not point it at an existing volume.

An **Issue** is now a projection of a record in a **Socket** — one connected tool under one identity. It carries the tracker's own key (`acme/deevy#42`), its URL, its title and body, and whether the tracker says it is open or closed. deevy authors none of it. A **Project** is a binding: the Socket and container its records come from, optionally the repository its code is in, which Agent gets a record nobody named, and how much deevy says back.

What this removes: Documents and their live collaborative editing, the Workflow of States and Gates per Project, Labels, Teams, comments stored in deevy, the board, the Issue list and the Issue page, and deevy's own `DEV-42` keys. The Durable Object went with the Documents, so a Cloudflare deployment needs no paid binding for them and `nodejs_compat` is off.

Operations removed: `workflow.*`, `documents.*`, `labels.*`, `teams.*`, `gates.*`, `issues.move`, `issues.setLabels`, `issues.update`, `runs.requestApproval`, `comments.list/update/delete`. Added: `sockets.list/connect/remove`. Changed: every operation that names an Issue takes one string, `issue`, which is an id, a URL or the tracker's key; `projects.*` take a `slug` and carry a binding; `issues.create` and `comments.create` write to the tracker.

The MCP tool set is fifteen: `comments_create`, `inbox_list`, `issues_create`, `issues_get`, `issues_list`, `links_add`, `links_list`, `links_remove`, `projects_get`, `runs_answer`, `runs_finish`, `runs_get`, `runs_list`, `runs_post_activity`, `runs_start`.

**A Gate is not in this release.** It comes back in the next one as a request on a Run, carrying the Agent's proposal and the Checkpoint it asks about, with the four-eyes settings that were on a Workflow State moving to the Project. Until then an Agent asking for a ruling has nowhere to ask, which is why this version is not one to run a team on.

**The only provider in this release is a stub**, in-process and offered only where `DEEVY_DEV_STUB_OAUTH=1` already is. GitHub, Linear, GitLab and Notion follow. The plan is `docs/plans/sockets.md`; the reasoning is ADR-0024 and ADR-0025.
