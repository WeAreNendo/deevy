---
"@deevy/core": minor
---

**For API and MCP clients.** Every operation that names an Issue takes one string, `issue`: deevy's id, the record's URL, or the tracker's key. A Project is named by its `slug`. `issues.create` and `comments.create` write to the tracker, and `issues.get` reads the tracker's conversation with `comments: true`, saying so (`commentsUnavailable`) when it could not.

Removed: `workflow.*`, `documents.*`, `labels.*`, `teams.*`, `issues.move`, `issues.setLabels`, `issues.update`, `runs.requestApproval` and `comments.list/update/delete`. New: `sockets.*`, `checkpoints.list/set`, `gates.request/get/list/approve/reject`, `identities.*`, `runs.checkout`, `runs.retry`, `pulls.open`, `docs.get` and `channels.createInSocket`.

The MCP tool set is nineteen: `comments_create`, `docs_get`, `gates_get`, `gates_request`, `inbox_list`, `issues_create`, `issues_get`, `issues_list`, `links_add`, `links_list`, `links_remove`, `projects_get`, `pulls_open`, `runs_answer`, `runs_finish`, `runs_get`, `runs_list`, `runs_post_activity` and `runs_start`.
