# A hosted Workspace pushes its Events

Amends [ADR-0012](./0012-the-cron-port-stayed-node-s-and-a-stream-ends-itself.md), which made deevy's live
updates a resumable cursor with a long-poll in front, and deferred "a real bus instead of a poll" until
Durable Objects. A hosted Workspace is one ([ADR-0028](./0028-a-hosted-workspace-is-a-durable-object.md)),
and there the long-poll is what costs: an object is billed for wall time while it is awake, an open
`events.subscribe` keeps it awake, and a tab left open through working hours is about $4 a month per
Workspace, $120 for a hundred (docs/plans/hosted.md, "Live updates"). This records what replaced the stream
there, and what every deployment gained on the way.

## The decision

**A hidden tab lets go, on every deployment.** `useLiveEvents` (`apps/web/src/lib/live.ts`) closes its
connection once the tab has been hidden for 30 seconds, so a glance at another tab costs nothing and a tab left
behind holds nothing open. Shown again, it reconnects from the cursor it had, which is ADR-0012's resume: what
changed meanwhile is read once and re-read where it is shown.

**A hosted Workspace's tab holds a hibernatable WebSocket, and the object tells it a number.** `health.ping`
says `live: "websocket"`, and the SPA opens `/api/live` under the Workspace's path. The core admits the socket
by asking `refusal()` — the rule the operation middleware throws — about `events.subscribe`, refuses an
Origin that is not the deployment's own, and hands the upgrade to a `LiveSocket` the entry passed to
`createApp`. The object accepts it through Cloudflare's hibernation API (`ctx.acceptWebSocket`) and keeps, on
the socket rather than in memory, whose it is, when their session ends and the last seq it was told. When an
Event is appended — always inside the object, so it is awake anyway — it sends `{"seq": N}` to every open
socket, a burst gathered into one message. The tab reads the Events from its cursor with `events.list`, under
its own session, and invalidates exactly as it did for the stream. Between Events the object hibernates with
the sockets open; the runtime answers the tab's `ping` with `pong` without waking it.

**The log tells whoever listens to its database.** `onEventAppended(db, listener)` (`packages/core/src/live.ts`)
is called by `appendEvent` once an Event's Notifications and deliveries are written, before its triggers.
Listeners are kept by the database handle in a `WeakMap`, so an isolate running many Workspaces' objects can
only ever tell a Workspace about its own log. The object registers once, in its constructor, on the handle
everything in it writes through.

**Node and the self-hosted Worker keep the stream.** They pass no `LiveSocket`, so `health.ping` says `stream`
and `/api/live` answers 501. In the SPA a socket refused before it opens — a proxy that drops upgrades, a
session that is over — hands over to one stream at once, and the socket is tried again when that stream ends;
in an object that is minutes (`DEEVY_STREAM_SECONDS`, 300 there).

## Why not the alternatives

- **`events.subscribe` over oRPC 2's WebSocket adapter.** `@orpc/server/websocket` serves a router over a
  socket and names Cloudflare's hibernation API as a target, so the whole operation could have moved. But a
  subscription is an async generator held in the object's memory — `subscribeToEvents`' loop and its timer —
  so the object cannot hibernate while one is open, which is the cost this exists to remove; and the
  adapter's peers live in a `WeakMap` that hibernation empties. oRPC 1's hibernation plugin, which let a woken
  object resume an iterator by id, has no counterpart in the 2.0 beta pinned (beta.32). Refused: it moves the
  stream to another transport rather than ending it.
- **Pushing the Events themselves.** One round trip fewer, but the socket would then decide what each Member
  may see — an invitation's Events are an admin's — a second set of permissions that drifts from the first.
  A seq carries no authority. Refused.
- **A port threaded beside `jobs` on every `EventSource`.** The shape `jobs` has. But some twenty places build
  a source — sign-in's bootstrap, a tool's delivery, the alarm's sweep, a team address's confirmation — and
  the one a later change forgets loses its pushes silently, since a missed push looks like nothing at all.
  Keying listeners by the handle reaches all of them. Refused.
- **Reading the log's head after each request the object answers.** No change to the core at all, but a
  write can outlive its request: an MCP tool call answered as a stream runs after `fetch` has returned.
  Refused.

## Consequences

- A hosted Workspace with tabs open is awake for each Event and for its alarm's pass, not for the hours its
  tabs are open. `Platform.status` reports `awakeSince` and `openTabs`, so the platform can see whether
  objects sleep. `vp run hosted#test:hosted` checks it on workerd: left alone for 15 seconds with a tab open
  and the pass a minute apart, the object is constructed again when next asked, and the next Event still
  reaches the tab.
- ADR-0012's claim stands: live updates are a resumable cursor. What tells a tab to read changed; what it
  reads, and from where, did not.
- A socket is closed when its session ends (at the next push after), when the Workspace is suspended, and
  when it is destroyed (codes 4401, 4403, 4404). The tab opens another, which the core refuses if the
  session is over.
- `/api/live` is a route, like `/api/identities/:provider/callback`, and not an operation: it is not in the
  OpenAPI document, and the CLI and MCP never see it.
- Not measured: Cloudflare's own bill for a hibernating object with sockets open, and whether its edge closes
  a WebSocket that is quiet for long. The tab's 30-second keepalive is there for the second, and costs no
  wake.
