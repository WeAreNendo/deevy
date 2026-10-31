---
"@deevy/core": minor
"@deevy/sockets": minor
"@deevy/web": minor
"@deevy/server": minor
"@deevy/hosted": minor
"@deevy/adapters": patch
---

deevy now only listens to your tools and says on a record when a Gate is waiting and how it was ruled. Your Agent reads and writes the tool itself, with its own access. Three operations are gone. `issues.create` was `POST /api/issues`, the MCP tool `issues_create` and `deevy issues create`. `comments.create` was `POST /api/issues/{issue}/comments`, `comments_create` and `deevy comments create`. `docs.get` was `GET /api/projects/{project}/docs`, `docs_get` and `deevy docs get`. `issues.get` no longer takes `comments` and no longer returns `comments` or `commentsUnavailable`. An Agent that commented, opened sub-issues or read pages through deevy now does those in the tool, with a token or MCP server of its own: `gh`, Linear's or Notion's MCP server, and so on. Each route now answers 404 and each tool is unknown. A sub-issue the Agent opens there reaches deevy when the tracker delivers it, like any record.

deevy no longer asks a tool what changed. `DEEVY_SOCKET_CATCHUP_MINUTES` is gone; unset it. A Socket's page no longer says deevy is asking a quiet tool; it says to check that the tool's webhook still points at deevy. A Socket no longer has `pollMinutes`, and `sockets.connect` and `sockets.update` ignore it. A record reaches deevy only when its tool delivers to `/hooks/<socketId>`. A deployment no tool can reach, such as a laptop with no tunnel, now hears nothing from its tools. If yours relied on polling, give it a public address or a tunnel. For anything a tool sent while deevy could not be reached, use the tool's own redelivery, such as **Redeliver** on GitHub.

What deevy writes on a record no longer has a setting. Every Project announces the same things: a Gate waiting, each approval, the decision, and a reply to a comment that ruled nothing. Nothing about a Run is written. A Project's **Mirror** is gone: `mirror` is no longer returned, and one sent is ignored. A Project that had it set to **Nothing** now gets these comments, and one set to **Runs as well** no longer gets comments about its Runs. A comment about a Run that was still waiting to be written when you upgrade is not written. deevy no longer sets the `deevy:awaiting-approval` label or Notion option, and it won't remove one left on a record from before the upgrade, so delete the label in your tracker if you don't want it there.

A Project's **Documents** setting is gone (`docs`, `docsSocketId` and `docsScope`), and a Notion Socket is a tracker only. A Notion connection now needs only read content, read comments, insert comments, and user information with email addresses; one that has more keeps working.

When the last sub-issue of a record closes, deevy now wakes the Agent that record is routed to; it used to wake the Agent that opened the sub-issues through deevy. A record no Agent is routed to, such as one an Agent took up because it was mentioned, wakes nobody: route the parent to the Agent, by its label or the Default Agent, if it should pick the work back up. The `issue.children_closed` Event carries `routedTo` in place of `openedBy`, so a webhook consumer that read `openedBy` has to read `routedTo` instead. A Sponsor's inbox no longer says that their Agent opened sub-issues, only that they are all finished. deevy knows a record's parent only from the tracker's own parent field, so on GitLab, which has none, deevy sees no sub-issues and wakes no parent. A GitHub issue that was added under a parent after it was opened is now linked to that parent in deevy. It used to stay unlinked, so the parent's Agent never woke when its sub-issues closed.

The three limits under **How far an Agent may split work** (sub-issues each, levels deep, open in one tree) bound nothing now, because deevy no longer opens sub-issues for an Agent, and the setting says so. To bound how far an Agent splits work, bound its access to your tracker. `issue.createdBy` is no longer returned, since deevy no longer opens records and so does not know who opened one.

`sockets.containers` answers `{ containers: null }` for a tool that can't list its containers, and **Bind a Project** then asks you to type the container's name the way the tool's deliveries write it. Every tool deevy ships still lists its containers.

If you build your own Socket module, a tracker now needs only `verifyInbound`, `normalize` and `createComment`. `getIssue`, `getComment`, `handshake` and `listContainers` are optional, and `listIssues`, `listComments`, `createIssue`, `setLabels` and the `docs` capability are gone.

A deployment that registers the stub Socket (`DEEVY_DEV_STUB_SOCKETS=1`, for development only, which the Docker image and deevy Cloud refuse) also serves what the stub holds at `/dev/tracker`.
