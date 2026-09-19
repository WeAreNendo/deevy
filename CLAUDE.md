# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

deevy is project management where Humans and Agents collaborate as peers on the same Issues. Use the
vocabulary in [CONTEXT.md](CONTEXT.md) (Member, Human, Agent, Sponsor, Workspace, Issue, Gate, Run, Event) in
code, API names, and UI copy; it lists the words to avoid. Hard-to-reverse choices live in `docs/adr`, the
milestone plan in `docs/PLAN.md`, setup and env vars in `docs/DEVELOPMENT.md`, running the image and the
Worker in `docs/OPERATIONS.md`. Current milestone: M1 (Humans) done, in thirteen slices from
`docs/plans/m1.md`; M2 (Agents) done, in nine slices from `docs/plans/m2.md`, with a worked agent loop in
`docs/agent-loop.md` and its counterpart for a Human's own Claude Code in `docs/as-yourself.md`; M3 (Workers) built in ten slices from `docs/plans/m3.md`, its end-to-end walk written up
in `docs/m3-acceptance.md` and executed; M4 (Reference runtime) done, in ten slices from `docs/plans/m4.md`,
shipping `apps/agent`, whose acceptance walk is a script (`vp run agent#acceptance`) that runs
both deployments locally on every commit — no Cloudflare account, no OAuth App, no repository on the internet
(`docs/m4-acceptance.md`); the harness spike then made the runtime `apps/agent`, driving Claude Code,
OpenCode, Cursor CLI or Copilot CLI as a subprocess behind one contract (`docs/plans/harnesses.md`,
`docs/harnesses.md`, ADR-0018), and the agent-owns-git work then gave each session its own user and put git
behind a loopback proxy that holds the credential, so an Agent pushes where it likes and every ref it moved
is in the Run's feed (`docs/plans/agent-owns-git.md`, ADR-0019); the sign-in work then closed what M1 and M2
both deferred, making a provider configuration (GitHub, Google, GitLab, one generic OIDC), one Human one
Member across providers, a GitLab group an allowlist rule, and an invitation a link an admin sends
(`docs/plans/sign-in.md`); four-eyes Gates then took the first feature off the after-v1 list, giving each
Gate a number of distinct Humans it wants and a choice about whether the one who brought the Issue counts
(`docs/plans/four-eyes-gates.md`, ADR-0020); live Documents then made two Members able to write one Document
at the same time, with the Agent still reading and writing markdown (`docs/plans/collaborative-documents.md`,
ADR-0021); and sub-issue delegation then let an Agent cut work up and hand the pieces to other Agents,
finishing its own Run rather than waiting and being woken when the last piece closes, bounded by three counts
an admin sets per Workspace (`docs/plans/sub-issue-delegation.md`, ADR-0022). v1 is complete. The current
milestone is **Sockets** (`docs/plans/sockets.md`, ADR-0024 and ADR-0025): deevy stops being a tracker and
becomes the glue between a team's existing tools and its Agents — an Issue is a projection of a record in
a Socket (a GitHub App, a Linear app, a GitLab application, a Notion integration, a Slack app), a Project
is a binding, a Gate is a request on a Run with a Proposal, and Documents, the Workflow, Labels, Teams,
comments and the board go. CONTEXT.md already carries the new vocabulary and lists the retired words; until
slice 0 lands the code is v1's, so the architecture notes below describe what is in the tree.

## Commands

Everything runs through Vite+ (`vp`), a pnpm workspace. If `vp` is not on PATH, `. ~/.config/vite-plus/env`.
Install with `vp install` (CI runs `vp install --frozen-lockfile`). The lockfile is pnpm 11's two-document
format, so pnpm 11 is required and pinned twice over: `devEngines.packageManager` in `package.json`, and
`.tool-versions` for the asdf shim. A pnpm 10 on PATH calls the lockfile broken and then blocks forever on
the prompt to wipe `node_modules`, so if an install hangs with no output, check `pnpm --version` first.
`vp dev`, `vp build`, `vp test`, `vp check` are built-ins that ignore package.json scripts; `vp run <script>`
runs scripts, `-r` recursively, `pkg#script` for one package (package names are `web`, `server`, `core`, `db`,
`adapters`, `agent`, `cli`, `editor`, `release`; `agent` has its own `apps/agent/README.md`, and
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
route (`/api`, reference UI at `/api/docs`), and in M2 an MCP tool. Each area is a module in
`packages/core/src/operations/` (`issues.ts`, `runs.ts`, …) whose helpers, when more than one area
needs them, live in `shared.ts`; `index.ts` only assembles the router. Add an operation to its area's
module and never build oRPC procedures outside the registry (ADR-0009). GET operations
need an object input schema; use `NoInput` for none.

**Request context** is built once per request in `packages/core/src/app.ts`: Better Auth session, then the
caller's Member row and the Workspace. `createApp({ db, auth?, origin })` is the Hono app both entries mount:
`apps/server` (Node, `@hono/node-server`) and `apps/web/src/worker.ts` (Cloudflare Worker, D1, no auth yet).

**Runtime boundary**: `packages/core` and `packages/db` use web-standard APIs only; no `node:` imports and no
`types: ["node"]` in their tsconfigs. Anything runtime-specific goes in `packages/adapters` (`./node`:
`node:sqlite`, migrator, SPA serving; `./workers`: D1). The Workers build in CI is what catches a leak.
The core uses no interactive transactions because D1 has none; multi-statement writes are sequential
(bootstrap) or batches.

**Identity** (ADR-0007): every Member is a Better Auth user (`user.kind` is `human | agent`); deevy's own
`workspace` and `member` tables hold roles and Sponsors. A single instance serves one Workspace, created by
`bootstrapWorkspace` when `DEEVY_ADMIN_EMAIL` signs in (runs on user creation and on every new session, and is
idempotent). Other sign-ins get a user row and no Member until M1's allowlist and invitations.

**Events**: every write appends one through `appendEvent` (`packages/core/src/events.ts`) in the same handler,
and `deriveNotifications` turns Events into inbox rows right after the insert. The Event log is the only record
of what happened: the timeline, the live stream and the inbox all read it rather than keeping a second source.
Add a new kind to the `EventKind` union.

**Ids** (ADR-0015): every row deevy creates gets `<prefix>_<12 chars of 0-9a-z>` from `newId(kind)` in
`packages/core/src/ids.ts` (`iss_`, `mem_`, `proj_`, `run_`…; Better Auth's rows through its `generateId` hook);
never `crypto.randomUUID()`. `Event.seq` stays an integer and Issue keys stay `DEV-42`.

**Data** (ADR-0008): Drizzle 1.0 rc on the SQLite dialect. Relations use `defineRelations` /
`defineRelationsPart` merged per table in `packages/db/src/relations.ts`; dates are integer `timestamp_ms`
columns; the Better Auth adapter is the `/relations-v2` entry. Migrations are applied by the Node migrator at
startup (`openDatabase`) or by `wrangler d1 migrations apply`, never by `drizzle-kit migrate`.

**Builds**: `vp pack` bundles every dependency into `apps/server/dist/index.mjs` and copies the migrations next
to it, so the Docker runtime image carries `dist/` and the SPA only. `apps/web` builds the Worker only when
`DEEVY_TARGET=workers`, emitting `dist/deevy` (the bundle plus the `wrangler.json` a deploy uploads) beside
`dist/client` (the SPA those assets are). A deploy uses that generated configuration, never `src/worker.ts`.

## UI

The SPA is being redesigned in slices from `docs/plans/ui-redesign.md`; the decisions it has made so far —
Base UI only, which registries and items are allowed, markdown as the one format Documents are stored in, the
design language, the keyboard model, and the accessible names the tests rely on — are the `deevy-ui` skill in
`.claude/skills/deevy-ui/SKILL.md`. Read it before changing anything under `apps/web/src` or `apps/web/tests`;
the vendored `shadcn` and `frontend-design` skills beside it are the component rules and the design process it
leans on. To see the app without a GitHub OAuth App, run the `dev:stub` launch configuration and
`DEEVY_DATABASE_PATH=./data/stub.sqlite vp run server#seed` (`docs/DEVELOPMENT.md`, "Running without an OAuth App").
The Sockets plan removes the Documents tab, the Workflow editor, Labels, Teams and the board, and adds
Sockets, bindings, Checkpoints, the Gate screen and a read-only Work list; the skill's test contracts are
rewritten in that plan's last slice, and until then they describe the tree.

## Dependencies

Better Auth 1.7.x, Drizzle 1.0.0-rc.x, and oRPC 2.0.0-beta.x are pinned exactly in the catalog in
`pnpm-workspace.yaml`. Upgrade a line on purpose and as a whole (all `@better-auth/*` or `@orpc/*` together),
never by `latest` or `rc`/`beta` tags, then regenerate the OpenAPI snapshot and check migrations. New packages
take their version from the catalog (`"catalog:"`).
