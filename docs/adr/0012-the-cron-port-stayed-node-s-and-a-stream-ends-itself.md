# The Cron port stayed Node's, and a stream ends itself

> Amended by [ADR-0032](./0032-a-hosted-workspace-pushes-its-events.md): the "real bus" deferred below is a
> hosted Workspace's object pushing each new seq to its tabs' hibernatable WebSockets, and on every
> deployment a hidden tab lets go of its stream and resumes from its cursor (OPERATIONS.md, "Live updates").
> The cursor stays the protocol.

Amends [ADR-0006](./0006-runtime-agnostic-core-node-first.md), which sketched the second runtime before
anything had run on it. The core is runtime-agnostic and the Docker image and the Worker are one codebase,
exactly as it said. Two of its three consequences turned out to describe the wrong seam once M3 built the
Worker, and this records what shipped instead so the sketch is not read as the design.

## The sweep is a function in the core, not an operation on a `Cron` adapter

ADR-0006: "Webhook retries and periodic sweeps must be expressed as adapter operations, not timers." M2 took
that literally and wrote a `Cron` port — `every(seconds, run)`, returning a stop function — with a Node
implementation on `setInterval` and a Workers one waiting for M3.

That Workers implementation cannot be written honestly. Cloudflare does not let a Worker start a schedule; it
calls `scheduled(controller, env, ctx)` when its own `triggers.crons` says so, and there is nothing to stop.
A `Cron` for Workers would have had to accept an interval it could not honour and hand back a stop function
that stopped nothing — a port whose contract is a lie on one of the two runtimes it exists to span.

So the split moved. The body of the sweep is now `runDueWork({ db, now, limits, baseUrl, signal })` in
`packages/core/src/work.ts`: the stale sweep, the schedule trigger, both delivery loops and the Gate reminder,
in that order, each bounded, with no timer and a report of what it did. Node's `startRunner` keeps the timer,
the drain loop, the overlap guard and the SIGTERM
behaviour and calls it; the Worker's `scheduled` handler calls it once through `ctx.waitUntil` with tighter
limits, because a trigger has a CPU budget and a per-invocation D1 query cap and the platform comes back a
minute later of its own accord. `Cron` stayed what it always was, the Node port, and `packages/adapters` has
no Workers cron at all.

The general form is the rule M3 wrote down for itself: where the two runtimes need different numbers, the
difference is an argument the entry passes, never a branch inside the core. `DueWorkLimits` is that argument.
An adapter is for a capability one runtime has and the other does not; it is not for a schedule that one
runtime owns and the other delegates.

## A stream ends before the platform ends it, and the client resumes

ADR-0006: "Live UI updates must work with request-scoped streaming; nothing may assume a long-lived process."
True, and not enough. `events.subscribe` was already request-scoped — one long-lived request per browser,
polling the Event log — and that alone does not survive a Worker, because the invocation holding the request
may run only so many D1 queries. Each poll is one query. The cap is therefore a ceiling on the stream's life,
and a stream that reaches it is cut off mid-message with nothing said about where it got to.

`subscribeToEvents` gained `maxDurationMs` beside `pollMs`. On reaching it the stream sends one last
heartbeat carrying its cursor and returns; `useLiveEvents` treats a stream that delivered something and then
ended as an invitation rather than a failure, and reconnects at once from that cursor. It keeps its two-second
wait for a genuine drop, and for a stream that ended having said nothing at all — there is no cursor to resume
from there, and reconnecting at once would be a hot loop. The Worker entry passes a duration and a two-second
poll, doubling a stream's life for a second of latency; `apps/server` passes neither, so the default is
unbounded and the Node deployment is unchanged.

What that costs is a claim: deevy's live updates are not a subscription, they are a resumable cursor with a
long-poll in front. The seam is visible in the protocol — a heartbeat carries a cursor — rather than hidden
in a transport, which is what lets the SPA cross it without the user seeing anything.

## Considered options

- **A Workers `Cron` that ignores its interval.** One line of documentation ("the interval is advisory on
  Workers") and the port's shape is preserved. Rejected: the caller that chooses an interval is `startRunner`,
  which does not run on Workers, so the argument would be dead on the only runtime that has the problem, and
  the stop function would be a handle to nothing. A port both sides implement truthfully is worth more than a
  port both sides mention.
- **`if (workers)` inside the sweep.** The obvious way to give a trigger tighter limits, and the one thing
  M3 ruled out for every slice: a branch in the core is a second implementation nobody tests twice. The
  parameter was missing, not the branch. Rejected.
- **Durable Objects for the Event stream.** The right answer eventually — a real bus instead of a poll, and
  no query cap to divide into. Deferred out of M3 deliberately: it changes the shape of live updates on both
  runtimes and it is not what a free account needs to run the milestone's scenario.
- **Letting the platform cut the stream off.** Cheapest, and the client already reconnects after a drop. But
  it reconnects blind — without a cursor it either re-reads from the beginning or starts from now and loses
  what happened in the seam — and a failure the client cannot distinguish from a real one costs it the
  two-second backoff every time. Rejected.

## Consequences

- `DEEVY_SWEEP_INTERVAL_SECONDS` is a Node-only knob and `DEEVY_STREAM_SECONDS` is a Workers-only one. Both
  say so in the configuration table in [OPERATIONS.md](../OPERATIONS.md), which is where a knob that exists on
  one target only has to be visible.
- A backlog drains a minute at a time on Workers and in one tick on Node, from the same code. `more: true`
  means "come back rather than raise the limit" on both; what comes back differs.
- Raising `DEEVY_STREAM_SECONDS` spends the invocation's query budget on polling. The value and the poll
  interval are one arithmetic, not two settings, and OPERATIONS.md states it as such.
- ADR-0006's third consequence stands untouched: no Node-only modules in `packages/core`, and Postgres will be
  a third storage adapter. The two amendments above are about which seam, not about whether there is one.
