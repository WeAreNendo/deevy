# A deployment may live under a path

Hosted Workspaces live in the path, `app.deevy.dev/acme` ([ADR-0028](./0028-a-hosted-workspace-is-a-durable-object.md),
[hosted.md](../plans/hosted.md)), and every deployment until now assumed it sat at the root of its host: its
routes, Better Auth's base path, the OAuth issuer, the session cookie and the SPA all started at `/`. This
records how a deployment learns it does not.

## The decision

**The path of `BETTER_AUTH_URL` is where a deployment lives, and nothing else says so.** That URL was
already the OAuth issuer, the base of the MCP and API resources, of every Socket's webhook URL and of every
link deevy sends; a second setting for the path could only disagree with it. So:

- `createApp` mounts everything under the path (`basePathOf`, `packages/core/src/base-path.ts`), and
  answers `/healthz` at the root too.
- Better Auth is handed `${BETTER_AUTH_URL}/api/auth` outright, because it routes on the path of its own URL
  and keeps one that has a path exactly as given. Its cookies are scoped to the path.
- The issuer is the deployment's URL, path included. RFC 8414 and RFC 9728 insert the well-known segment
  after the host, so the issuer `…/acme` is described at `/.well-known/oauth-authorization-server/acme`;
  Better Auth's provider already answers both that and the appended form, and the MCP challenge names the
  path-inserted resource metadata.
- The SPA is built once with assets relative to `<base href>`. The server writes `<base href="/acme/">`
  into the index it serves, and the page reads its base off the same element (`apps/web/src/lib/base.ts`).
  Node and the Worker share one helper for it (`@deevy/adapters/spa`).

## Why not the alternatives

**A `DEEVY_BASE_PATH` setting.** Explicit, and redundant: a base path that disagreed with
`BETTER_AUTH_URL` would mint tokens for one URL and answer on another. Refused.

**Stripping the path at the edge.** A proxy, or the hosted router, could remove `/acme` and hand deevy a
request at the root. Then deevy would build every link, issuer and cookie for the root and be wrong about
all of them. Refused.

**A build per path.** Vite can bake a base into a build. One build per Workspace is exactly the fan-out
ADR-0028 refused. Refused.

## The cost, stated

- Discovery lives at the root of the host, outside the path. A proxy that forwards only `/deevy/*` must
  forward the well-known documents that name `deevy` too; the hosted router does.
- The CLI kept only an origin; it has to keep the whole URL, and ships that as a release of its own.
- A Worker under a path runs first for every request (`run_worker_first: true`), because the platform's
  asset handler cannot know what the index should say.
- Deployments on one host share an origin, so nothing in the browser separates them but the path. The
  session cookie is the path's, and the SPA keeps what it stores per path, but a script that runs in one can
  act in another: ADR-0028 records why that is accepted and what the CSP owes in return.
