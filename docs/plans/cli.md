# A deevy CLI, generated from the registry: vertical slices

Breakdown of the CLI, 2026-09-18. Vocabulary is [CONTEXT.md](../../CONTEXT.md); the surfaces this joins are
[ADR-0005](../adr/0005-one-core-three-surfaces.md), and the registry it reads is
[ADR-0009](../adr/0009-orpc-2-beta-as-operation-layer.md). It is the last item on
[PLAN.md](../PLAN.md)'s after-v1 list.

It is done when a Human can sign in from a terminal, drive the Issues they could drive in the browser, and
every operation the registry gains is a command without anybody writing one.

Eight slices, 0–7, in dependency order. Each is one PR, stacked on the one below it, leaving `vp check` and
`vp run -r test` green and carrying a changeset.

## Why generated

deevy already defines every operation once and projects it three ways: a REST route at `/api`, an MCP tool at
`/mcp`, and a typed browser client at `/rpc`. A command line should be the fourth rather than a hand-written
list that drifts from the other three — 94 operations is far past the size where a hand-kept list stays
honest, and the two existing generators (`snapshot-openapi.ts`, `snapshot-mcp-tools.ts`) already prove the
registry carries enough to do it.

The walk reads the router at runtime rather than a generated file, and the zod schema is the reason: it
validates argv with the refinements and coercions the operation actually declared, which a JSON Schema
snapshot of the same thing would flatten away. The cost is that `@deevy/core` is inlined into the bundle,
measured at 3.09 MB for one file — half the server's.

## Decisions taken

|              |                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Commands     | Generated from the registry, ours rather than `trpc-cli`                                                                       |
| Coupling     | `apps/cli` imports `@deevy/core` and ships in the same version, **and filters itself to what the connected instance supports** |
| Auth         | Both, equal footing: `deevy login` (OAuth, PKCE, loopback) and `DEEVY_API_KEY`                                                 |
| OAuth reach  | A second RFC 8707 resource for the API, so a CLI token is not an MCP token                                                     |
| Parsing      | Our generator, on `commander`                                                                                                  |
| Distribution | Published to npm — the first package deevy publishes                                                                           |

## Two constraints that shape it

**A CLI can never rule a Gate.** `gates.approve` and `gates.reject` are `sessionOnly`, which demands
`principal.kind === "cookie"` — a Human in deevy's own browser. That is
[ADR-0004](../adr/0004-agents-never-approve-gates.md) and
[ADR-0010](../adr/0010-a-delegated-credential-cannot-decide-a-gate.md) on purpose, not a gap. The CLI offers
`deevy gates open <issue-key>` instead. `oauthClients.list` and `oauthClients.revoke` are `sessionOnly` too,
for their own reason: a delegated credential should not be able to enumerate or revoke the consents that
delegated it.

> ADR-0010's text says `sessionOnly` is "carried by `gates.approve` and `gates.reject` and nothing else",
> which the `oauthClients` pair has since made stale. Worth amending when somebody is next in that file.

**An OAuth token was bound to `/mcp`.** `principal.ts` verified `audience: ${issuer}${MCP_PATH}` and nothing
else, so a CLI presenting one at `/rpc` resolved as anonymous. Slice 1 is where that changes, and it is the
riskiest in the stack: Human sign-in does not work until it lands, and getting it wrong widens what a
delegated credential reaches. The CLI registers by DCR naming the API resource — a client identified by CIMD
is linked to MCP alone (ADR-0023).

## The slices

**0 — The package and the walk.** `apps/cli`, and `commandsFor(router)`: one descriptor per operation,
carrying the words a user types, the summary that becomes help text, which arguments are positional, the
authority the operation wants, whether it streams, and the zod schemas. Nothing runnable.

**1 — A token the API accepts.** The API becomes a second protected resource, and the expected audience
becomes a property of the surface a request reached rather than a constant: `/api` and `/rpc` check against
it, `/mcp` against MCP's, and a token minted for one is refused at the other in both directions. The resource
is _allowed_ at client registration rather than defaulted onto every client, so an MCP client holds a token
for the tools and nothing else. [ADR-0023](../adr/0023-the-api-is-its-own-protected-resource.md).

**2 — Identity.** `deevy login` (authorization code, PKCE S256, loopback redirect), `logout`, `whoami`.
Token at `~/.config/deevy/<origin>.json`, mode 0600. `DEEVY_API_KEY` overrides it and says it is acting as an
Agent.

**3 — The commands.** One commander command per operation: positionals for path parameters, flags for the
rest of the input object, `summary` as the description, zod for validation, `--json` on every one.

**4 — What this instance can do.** `version` joins `health.ping`'s output here, where it is first used. The
CLI intersects its commands with the `operationId`s in the instance's `/api/spec.json`, cached per origin and
version. A command the server does not have is hidden from `--help`
and refused with both version numbers. This is what makes a newer CLI safe against an older instance.

**5 — Output worth reading.** A human shape for the output schemas that carry most traffic; pretty JSON for
the rest. Colour only when stdout is a TTY.

**6 — The stream and the Gates.** `deevy events watch` over `events.subscribe`, the one streaming operation,
and `deevy gates open` to put a ruling in front of a Human. The refusal that explains itself for the four
`sessionOnly` operations shipped with slice 3, where the commands that carry it were generated.

**7 — Shipping it.** A `bin`, `vp pack`, and a publish job of its own in `changesets.yml` — not
`changesets/action`'s `publish` input, because that workflow already owns the tag and the Release so both
describe the folded changelog, and handing half the release back would put two things in charge of when a
version is out. It stays inside the `fixed` group, so `@deevy/cli`'s version is the same number as the image
tag. Publishing needs an `NPM_TOKEN` secret and the `@deevy` scope to exist; without them the release still
tags, still writes its notes and still pushes both images.

## Conventions every slice follows

M1's eight-step definition of done ([m1.md](./m1.md)) holds where a slice touches deevy; only slice 1 does.
The CLI adds three:

25. **No command is written by hand.** Anything a user types is derived from the registry, or it is a bug in
    the derivation. The exceptions are the verbs the registry has nothing to make — `login`, `logout`,
    `whoami`, `gates open`, and `events watch`, which is an operation but a streaming one — and there are
    five of them.
26. **The command list is asserted against the OpenAPI snapshot**, which CI already keeps current. An
    operation that gains a command and an operation that loses one both fail a test rather than surprising
    somebody at a prompt.
27. **A credential the CLI cannot use is explained, not relayed.** The four `sessionOnly` operations say what
    would satisfy them; they do not pass a bare `FORBIDDEN` back to the user.

## Deferred

Verbs for the daily loop (`deevy triage`, `deevy mine`) — the generated set is the floor, and hand-written
ergonomics sit on top of it once somebody has used the floor for a while. Shell completions. A second
instance in one configuration file. Anything that would let a CLI rule a Gate.
