# Runtime-agnostic core, Node first, Cloudflare Workers second

> Amended by [ADR-0037](./0037-two-deployment-shapes.md): the two shapes are the image and the hosted Worker
> (ADR-0028). The single-Workspace Worker on D1 is gone, and the hosted Worker's build is what keeps the core
> free of `node:`.

deevy ships as two deployment shapes and the operator picks one: a single Node process with SQLite in a Docker
image, and a Cloudflare Worker with D1. To keep that one codebase, the core uses only web-standard APIs (Request,
Response, WebCrypto, fetch) and Drizzle on the SQLite dialect, which both better-sqlite3/libsql and D1 speak.
Anything runtime-specific (job queue, cron, storage driver, static asset serving) sits behind a thin adapter with
a Node implementation and a Workers implementation. The Docker image ships first; the Worker target is the next
milestone, but the Workers build runs in CI from the start so nothing Node-only leaks into the core.

## Consequences

- No Node-only modules in `packages/core` or in server code outside the adapters. Postgres, when it arrives,
  is a third storage adapter.
- Webhook retries and periodic sweeps must be expressed as adapter operations, not timers.
- Live UI updates must work with request-scoped streaming; nothing may assume a long-lived process.
