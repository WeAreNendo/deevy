---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/web": minor
"@deevy/server": minor
"@deevy/sockets": minor
---

**A connected tool can now tell deevy what changed, and deevy can ask when the tool cannot reach it.**

`POST /hooks/<socketId>` takes a signed delivery from a tracker. deevy checks the signature over the raw body, writes the delivery down, and projects what it carries: the record becomes an Issue under the Project bound to that container, a label like `agent:planner` routes it to that Agent, and the Run opens exactly as an assignment in deevy would. A comment the Socket wrote itself is dropped, so deevy's own mirrored comments cannot answer themselves. A delivery that arrives twice is one Run, and one that arrives after a newer one changes nothing.

The route answers 200 whatever applying came to, because a provider that collects failures disables the hook. What went wrong is in the delivery row instead, which `sockets.inbound` lists.

**Polling is the fallback, and it is what makes a laptop instance work.** With no public URL there is no delivery, so the background pass asks a tool what changed — one Project per pass, one page at a time, through the same code a delivery goes through. Set `DEEVY_SOCKET_CATCHUP_MINUTES` (default 30) for how long a tool may be silent before deevy asks, or give a Socket its own poll interval.

**Credentials are sealed at rest.** Set `DEEVY_SECRET` to at least 32 random characters, separate from `BETTER_AUTH_SECRET`: rotating the one that signs sessions must not also mean connecting every tool again. Losing `DEEVY_SECRET` does mean that, so back it up with the database. Without it deevy refuses to connect a tool that holds a credential; a tool that holds none, like the in-process stub, still connects.

New operations, all admin and none of them tools: `sockets.update` (rename, rest, poll), `sockets.rotate` (mint a webhook secret and say it once), `sockets.containers` (what a Project can be bound to), `sockets.test` (re-ask who deevy is there), `sockets.inbound` (what the tool has said lately). `sockets.connect` takes `credentials`, a `webhookSecret` and `pollMinutes`, and answers the URL to paste into the tool. Disconnecting a tool now drops its credential and keeps its history. Every Socket read says whether each sealed column is set and never what is in it.

New Event: `socket.installation_added`. New tables: `inbound_delivery`, swept after thirty days. New column: `project.last_polled_at`.

**A Gate is still not in this release**, and `/hooks/<socketId>/setup` — the provider redirect for GitHub's manifest and installation callbacks — arrives with the GitHub Socket.
