# Two deployment shapes: the image and the hosted Worker

Amends [ADR-0006](./0006-runtime-agnostic-core-node-first.md),
[ADR-0012](./0012-the-cron-port-stayed-node-s-and-a-stream-ends-itself.md) and
[ADR-0028](./0028-a-hosted-workspace-is-a-durable-object.md). Planned in [simplify.md](../plans/simplify.md),
slice 11.

ADR-0006 gave deevy two shapes, a Node process with SQLite in a Docker image and a Cloudflare Worker with D1,
each serving one Workspace. ADR-0028 added a third, the hosted Worker, which serves many Workspaces from one
Worker, each in a Durable Object of its own. All three ran the same core, and the acceptance walk ran on each.

The single-Workspace Worker cost more than any other part of deevy that nobody used. It had its own entry
(`apps/web/src/worker.ts`) and its own environment reader. It had a `wrangler.jsonc` whose `run_worker_first`
list had to match every route the app mounts. It had a Queue adapter, and a D1 projection of every migration
that wrangler applied. It needed a 1,600-line smoke on workerd and a second check that a hosted Workspace's
dump loads into D1, as well as a leg of the walk and an operator's chapter of its own. It also had a converter
that turned a hosted dump into SQL for D1. No Workspace ran on it. A team that wants deevy without running a
server has deevy Cloud, which is the hosted Worker, and a team that wants its own has the image.

## The decision

**deevy is deployed two ways: the image, and the hosted Worker.**

- **The image** runs `apps/server` on `node:sqlite`, one Workspace per volume. It is what a team hosts
  itself.
- **The hosted Worker** runs `apps/hosted`, one Workspace per Durable Object, released as an attested archive
  (docs/plans/hosted.md). It is what deevy Cloud runs.
- **One SPA serves both.** `vp run web#build` writes `apps/web/dist`. The image serves it, and the hosted
  Worker uploads the same files as every Workspace's assets. `apps/web` has no Worker, no wrangler and no
  Cloudflare plugin.
- **A Workspace goes home to the image.** `dist/import.mjs` loads a hosted Workspace's dump into the image's
  database, and nowhere else.
- **The hosted Worker's build is what keeps the core portable.** `packages/core`, `packages/db` and
  `packages/sockets` still import no `node:`, because they run in a Durable Object. CI builds the hosted Worker
  on every commit, and that build fails on a leak, as the Workers build did before it.
- **Migrations come in two renderings, one per shape.** drizzle-kit writes `packages/db/drizzle`, which the
  image's migrator reads as it is. `vp run db#generate:durable` renders the same folders as the module a
  Durable Object imports. The D1 rendering goes.

## Which of D1's rules the core keeps, and why

The core was written for D1 and a Node process at once, so some of its rules were D1's. A Durable Object is
SQLite too, behind the same async core, and each rule was weighed against it:

- **No interactive transactions.** They stay out. A Durable Object's `transactionSync` takes a synchronous
  closure, and the core awaits between its statements, so it could not hold one across them either. Writes
  that belong together stay sequential with a re-checking `UPDATE … RETURNING`, or go in one batch.
- **A budget of statements per request.** It stays, and `budget.test.ts` keeps its ceiling of fifty. That was
  D1's cap on one invocation. An object runs one thing at a time, so every statement one request spends is a
  statement every other request in that Workspace waits behind.
- **Chunked inserts.** They stay. A Durable Object's SQLite accepts at most 100 bound parameters in a
  statement, as D1 did.
- **A stream that ends itself.** It stays as a mechanism, for a different reason. ADR-0012 ended a stream
  because each poll was a D1 query against that invocation's cap. A hosted Workspace pushes Events over a
  hibernatable socket (ADR-0032), and ends the polling stream that a tab falls back to after five minutes so
  the tab lets go of the object. The image's stream runs for as long as the browser keeps it open.
- **The Cron port.** It was already Node's (ADR-0012). The image runs `runDueWork` on a timer, and a hosted
  Workspace runs it from its alarm.

## How it lands

In slice 11. These go:

- `apps/web/src/worker.ts`, `src/env.ts`, `wrangler.jsonc`, `.dev.vars.example`, `scripts/smoke-workers.ts`,
  `stub-queue-hand.js` and `stub-receiver.js`;
- `@deevy/adapters/workers`, with its D1 `createDb` and its Queue;
- `packages/db/migrations`, `db#check:d1` and `server#check:d1-import`;
- `import.mjs --for-d1`, and the walk's Worker leg with the `tick` that poked its Cron Trigger;
- the Worker steps in CI and in the pre-push hook;
- `docs/m3-acceptance.md` and the public page on deploying to Cloudflare Workers.

`worker-routes.test.ts` becomes `app-paths.test.ts`. It now holds the routes `createApp` mounts against
`isAppPath`, the list the hosted router hands the app under a Workspace's path.

The acceptance test is `tools/release/tests/two-deployment-shapes.test.ts`, with the walk on the image, the
image under `/deevy` and a hosted Workspace, and `hosted#test:hosted`.

## What it costs

- **A team on its own Worker moves to the image, and starts it empty.** No Workspace is known to run on one,
  and slice 12 starts every deployment from an empty database. Nothing carries a D1 database into the image:
  `import.mjs` takes a hosted Workspace's dump, and a D1 export is not one.
- **"No server to keep" now means deevy Cloud.** A team that wanted its own deevy on Cloudflare's free plan
  has no shape for that. The hosted Worker could serve one Workspace, but it is built for a platform that
  provisions Workspaces and holds the console, and running it alone is not supported.

## Why not the alternatives

**Keep the Worker and stop testing it.** An untested deployment shape is one that breaks silently, and the
walk's claim that an Agent cannot tell the shapes apart would then hold for two of three.

**Make the hosted Worker the self-hosted Worker too.** One Worker for one Workspace and for many is possible,
but it needs a console that someone runs, a directory and provisioning. That is a product of its own, and
nobody has asked for it.
