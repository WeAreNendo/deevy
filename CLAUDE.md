# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

deevy is the glue between a team's tools and its Agents: the work stays in GitHub, Linear, GitLab or
Notion, and deevy routes it to Agents, records their Runs, and holds the Gates only a Human may rule on. Use the
vocabulary in [CONTEXT.md](CONTEXT.md) (Member, Human, Agent, Sponsor, Workspace, Socket, Project, Issue,
Checkpoint, Gate, Proposal, Ruling, Identity, Run, Event) in code, API names, and UI copy; it lists the words to
avoid. Hard-to-reverse choices live in `docs/adr`, the plan in `docs/PLAN.md`, setup and env vars in
`docs/DEVELOPMENT.md`, running the image, the Worker and each tool's setup in `docs/OPERATIONS.md`. History:
M1 (Humans), M2 (Agents), M3 (Workers) and M4 (the reference runtime, `apps/agent`) built v1, each from its
plan in `docs/plans/`, followed by the harness spike (ADR-0018), the agent owning git (ADR-0019), sign-in and
invitations, four-eyes Gates (ADR-0020), live Documents (ADR-0021) and sub-issue delegation (ADR-0022). Then
the **Sockets** milestone (`docs/plans/sockets.md`, ADR-0024 and ADR-0025), done in fifteen slices, cut
deevy's own tracker out: an Issue is a projection of a record in a Socket (a GitHub App, a Linear
application, a GitLab user, a Notion connection, a Slack app), a Project is a binding, a Gate is a request on
a Run with a Proposal, a Ruling may come from deevy, the tracker or Slack, and Documents, the Workflow,
Labels, Teams, stored comments and the board are gone. What each slice found is at the end of that plan. The
acceptance walk is a script (`vp run agent#acceptance`, `docs/sockets-acceptance.md`) that runs a record
through both deployments on every commit with no account, App or network. What comes next is PLAN.md's
"After Sockets" list, cost and time per Run first.

## Commands

Everything runs through Vite+ (`vp`), a pnpm workspace. If `vp` is not on PATH, `. ~/.config/vite-plus/env`.
Install with `vp install` (CI runs `vp install --frozen-lockfile`). The lockfile is pnpm 11's two-document
format, so pnpm 11 is required and pinned twice over: `devEngines.packageManager` in `package.json`, and
`.tool-versions` for the asdf shim. A pnpm 10 on PATH calls the lockfile broken and then blocks forever on
the prompt to wipe `node_modules`, so if an install hangs with no output, check `pnpm --version` first.
`vp dev`, `vp build`, `vp test`, `vp check` are built-ins that ignore package.json scripts; `vp run <script>`
runs scripts, `-r` recursively, `pkg#script` for one package (package names are `web`, `server`, `core`, `db`,
`adapters`, `sockets`, `agent`, `cli`, `release`; `agent` has its own `apps/agent/README.md`, and
`release` is `tools/release`, which holds the changelog fold and the commit-message rules).

- `vp check` (root): format, lint, typecheck the whole tree; `vp check --fix` applies formatting. Run it before
  every commit; CI runs it first.
- `vp run -r test`: all tests. One file: `cd packages/core && vp test tests/app.test.ts`; one case: add
  `-t "name substring"`. Tests import from `vite-plus/test`, not `vitest`. `test` is a **task** in each
  package's `vite.config.ts` and deliberately not a package.json script: only tasks are cached
  (`run.cache.scripts` is false at the root, so the generators are never cached), a task may not share a name
  with a script, and one defined at the workspace root would also run in the root itself. A new package copies
  that `run.tasks` block and leaves `test` out of its `scripts`.
- `vp run -r --parallel dev`: Node server on 3000 (rebuilt and restarted by `vp pack --watch`) plus the SPA
  on 5173 proxying `/api`, `/rpc`, `/healthz`. Needs a `.env` (copy `.env.example`).
- `vp run -r build`, `vp run web#build:workers` then `vp run web#check:workers` (wrangler dry run). In that
  order: the check dry-runs `apps/web/dist/deevy/wrangler.json`, which the build writes, and the committed
  `wrangler.jsonc` is a source that wrangler will not deploy on its own.
- Schema change: edit `packages/db/src/schema`, `vp run db#generate`, then hand-patch `NOT NULL` onto every
  `text PRIMARY KEY` in the new `migration.sql` (drizzle-kit rc regression) and run `vp run db#check:migrations`.
- API change: `vp run core#snapshot:openapi` and commit `packages/core/openapi.json`; CI fails on a stale snapshot.
- **Every commit message is a conventional commit** in the standard imperative — `feat(gates): add ruling
authority to Gate`. The type is one of `build chore ci docs feat fix perf refactor revert style test`; the
  scope is optional and free-form. The body stays unwrapped prose. Merges are squashed, so the **pull request
  title** must be conventional too — that is the message that lands on `main`, and CI checks it (ADR-0017).
- **Every change to a package carries a changeset**: `changeset add`, or `changeset add --empty` when nothing
  a user can observe changed. CI fails a pull request without one, the way it fails a stale snapshot. Write
  the summary for somebody upgrading deevy, not for somebody reviewing the diff; it is published verbatim as
  the release notes. Docs, tests and CI need none. Never edit `CHANGELOG.md` by hand — `vp run version` writes
  it, and the per-package `CHANGELOG.md` files are gitignored scratch.
- UI components come from the shadcn registry (`apps/web/components.json`, style `base-mira`, Base UI not
  Radix): `pnpm dlx shadcn@latest add <name> --overwrite` from `apps/web`. It rewrites `pnpm-workspace.yaml`
  and strips its comments, and it pins new dependencies, so move them to the catalog and put the comments back.
- SPA tests mock `lib/orpc` with `tests/stub-client.ts`; a test overrides only the operations it asserts on.
- Better Auth options that affect tables live twice: `packages/core/src/auth.ts` (runtime) and
  `packages/db/auth.generate.config.ts` (generator). Change both, then `vp run db#generate:auth` regenerates
  `packages/db/src/schema/auth.ts` (never edit it by hand).

## Architecture

One typed core, projected to three surfaces (ADR-0005), on two runtimes from one codebase (ADR-0006).

**Operation registry** (`packages/core/src/operations/registry.ts`): every API operation is a `defineOperation({
name, summary, method, path, auth, input, output, handler })`. `auth` is `public | session | member | admin`
and is enforced by middleware, which also treats a suspended Member as no Member; the handler's `context` type
narrows accordingly. A streaming operation (the SSE Event stream) is a `defineStreamOperation` with an
`eventIterator` output and a handler returning an async generator. oRPC is the implementation behind it:
the same procedure becomes the RPC endpoint (`/rpc`, used by the SPA through `@orpc/tanstack-query`), the OpenAPI
route (`/api`, reference UI at `/api/docs`), and, where it says so, an MCP tool. Each area is a module in
`packages/core/src/operations/` (`issues.ts`, `runs.ts`, …) whose helpers, when more than one area
needs them, live in `shared.ts`; `index.ts` only assembles the router. Add an operation to its area's
module and never build oRPC procedures outside the registry (ADR-0009). GET operations
need an object input schema; use `NoInput` for none.

**Request context** is built once per request in `packages/core/src/app.ts`: Better Auth session, then the
caller's Member row and the Workspace. `createApp({ db, auth?, origin })` is the Hono app both entries mount:
`apps/server` (Node, `@hono/node-server`) and `apps/web/src/worker.ts` (Cloudflare Worker, D1).

**Sockets** (ADR-0024): the core holds the port — the types a tool must answer to, in
`packages/core/src/sockets/port.ts`, exported as `@deevy/core/sockets` — and never a provider. Each tool is a
module in `packages/sockets/src/<provider>` (github, linear, gitlab, notion, slack, and the in-process `stub`);
the two entries build the registry with `socketModules()` and pass it as `createApp({ sockets })`. A tool
delivers to `POST /hooks/:socketId`, mounted before everything else, where the module verifies the raw body,
`normalize` turns it into `InboundEvent`s, and `applyInbound` projects, routes and rules. Credentials are
sealed under `DEEVY_SECRET` (`secrets.ts`). A provider module is tested against recorded payloads with an
injected `fetch`, never the network, and one walk per provider puts the real module behind the real route.

**Runtime boundary**: `packages/core`, `packages/db` and `packages/sockets` use web-standard APIs only; no
`node:` imports and no `types: ["node"]` in their tsconfigs. Anything runtime-specific goes in `packages/adapters` (`./node`:
`node:sqlite`, migrator, SPA serving; `./workers`: D1). The Workers build in CI is what catches a leak.
The core uses no interactive transactions because D1 has none; multi-statement writes are sequential
(bootstrap) or batches.

**Identity** (ADR-0007): every Member is a Better Auth user (`user.kind` is `human | agent`); deevy's own
`workspace` and `member` tables hold roles and Sponsors. A single instance serves one Workspace, created by
`bootstrapWorkspace` when `DEEVY_ADMIN_EMAIL` signs in (runs on user creation and on every new session, and is
idempotent). Other sign-ins join through the allowlist or an invitation. A Human's accounts on the tools are
Identities (`member_identity`, `packages/core/src/identities.ts`), which is what makes a Ruling from a tool
theirs (ADR-0025).

**Events**: every write appends one through `appendEvent` (`packages/core/src/events.ts`) in the same handler,
and its tail derives what is owed right after the insert: inbox rows and Slack deliveries
(`deriveNotifications`), webhook deliveries, what the tracker is told (`deriveSocketMirrors`) and chat message
updates. The Event log is the only record of what happened: a record's history, the live stream, the inbox
and every mirrored comment read it rather than keeping a second source. Add a new kind to the `EventKind`
union, with a case in the SPA's `lib/event-text.ts`.

**Ids** (ADR-0015): every row deevy creates gets `<prefix>_<12 chars of 0-9a-z>` from `newId(kind)` in
`packages/core/src/ids.ts` (`iss_`, `mem_`, `proj_`, `run_`…; Better Auth's rows through its `generateId` hook);
never `crypto.randomUUID()`. `Event.seq` stays an integer, and an Issue's key is its tracker's own
(`acme/deevy#42`, `ENG-12`).

**Data** (ADR-0008): Drizzle 1.0 rc on the SQLite dialect. Relations use `defineRelations` /
`defineRelationsPart` merged per table in `packages/db/src/relations.ts`; dates are integer `timestamp_ms`
columns; the Better Auth adapter is the `/relations-v2` entry. Migrations are applied by the Node migrator at
startup (`openDatabase`) or by `wrangler d1 migrations apply`, never by `drizzle-kit migrate`.

**Builds**: `vp pack` bundles every dependency into `apps/server/dist/index.mjs` and copies the migrations next
to it, so the Docker runtime image carries `dist/` and the SPA only. `apps/web` builds the Worker only when
`DEEVY_TARGET=workers`, emitting `dist/deevy` (the bundle plus the `wrangler.json` a deploy uploads) beside
`dist/client` (the SPA those assets are). A deploy uses that generated configuration, never `src/worker.ts`.

## UI

The SPA's decisions — Base UI only, which registries and items are allowed, the design language, the keyboard
model, the screens the Sockets milestone left (Needs me, Inbox, Runs, a Gate, a read-only Work list, Settings)
and the accessible names the tests rely on — are the `deevy-ui` skill in `.claude/skills/deevy-ui/SKILL.md`.
Read it before changing anything under `apps/web/src` or `apps/web/tests`; the vendored `shadcn` and
`frontend-design` skills beside it are the component rules and the design process it leans on. To see the app
without an OAuth App or a tool, use the `seeded` launch configuration (build first; every identity at
example.com, nothing read from `.env`) or `dev:stub` with `DEEVY_DATABASE_PATH=./data/stub.sqlite vp run
server#seed` (`docs/DEVELOPMENT.md`, "Running without an OAuth App").

## Dependencies

Better Auth 1.7.x, Drizzle 1.0.0-rc.x, and oRPC 2.0.0-beta.x are pinned exactly in the catalog in
`pnpm-workspace.yaml`. Upgrade a line on purpose and as a whole (all `@better-auth/*` or `@orpc/*` together),
never by `latest` or `rc`/`beta` tags, then regenerate the OpenAPI snapshot and check migrations. New packages
take their version from the catalog (`"catalog:"`).
