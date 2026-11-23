# Only Agents speak MCP

Supersedes [ADR-0023](./0023-the-api-is-its-own-protected-resource.md), and amends
[ADR-0007](./0007-better-auth-is-identity-and-oauth-server.md),
[ADR-0010](./0010-a-delegated-credential-cannot-decide-a-gate.md) and
[ADR-0016](./0016-a-run-is-an-agents-and-the-registry-says-which-way-an-operation-faces.md). Planned in
[simplify.md](../plans/simplify.md), slice 9.

Since M2, deevy was its own OAuth 2.1 authorization server (ADR-0007), so that a Human's own MCP client, such
as Claude Code signed in as them, could reach the tools. ADR-0023 then made the operation API a second
protected resource, so the CLI could sign in through a browser and act as the Human. That was Better Auth's
`mcp()`, `jwt()` and `cimd()` plugins, eight tables, a consent page, Settings › MCP clients, `oauthClients.*`,
a transport that dereferences client metadata documents safely, audience checks per surface, and a CLI with
a loopback listener and a token file.

All of it served one reader, a Human at a model's prompt, and every rule deevy keeps about Humans had to be
restated for them. A token held by a model is not a Human present (ADR-0010), so `sessionOnly` refused Gates
and linking an account to it. A Human's client was shown tools it could never call, so `agentsOnly` and
`tools/list` learned to face both ways (ADR-0016). Once the Socket became the place a Human answers and rules
(ADR-0024, ADR-0025), and the chat channel the place deevy tells them (simplify.md, slice 8), the Human's
MCP client had nothing left that was its own.

## The decision

**deevy is no OAuth authorization server, and `/mcp` takes an Agent's API key and nothing else.**

- **A key stands only for an Agent.** `resolvePrincipal` takes a bearer that is a deevy key whose user is an
  Agent. Any other bearer, a Human's key included, is nobody. Better Auth's `/api/auth/api-key/*` routes are
  closed with `disabledPaths`, so a signed-in Human cannot mint a key for themselves. Before this, one could,
  and it authenticated as them. A Sponsor issues an Agent's key through `agents.keys.issue`, which calls the
  plugin from the server.
- **`/mcp` answers anything else with 401** and `WWW-Authenticate: Bearer realm="deevy"`. There is no
  Protected Resource Metadata to point at, so the challenge names none. The discovery documents
  (`/.well-known/oauth-authorization-server`, `oauth-protected-resource`, `openid-configuration`), the JWKS
  and every `/api/auth/oauth2/*` endpoint are 404. `/.well-known/*` is still routed to the app, so a client
  probing for an authorization server is told there is none rather than handed the SPA's HTML.
- **A Human's surfaces are deevy's pages, the tracker and the chat channel.** A Human signs in to deevy with
  a session cookie and with nothing else. A Human reads and answers on the record, and rules in deevy, in the
  tracker, or in the channel a Project's Gates are posted to.
- **The registry's facing collapses to two.** A tool faces an Agent: `mcp: true` is sayable only beside
  `agents: true`, and the tool manifest no longer records which way each tool faces. An operation faces
  whoever its `auth` says, with `agents` and `agentsOnly` as ADR-0011 and ADR-0016 left them. `sessionOnly`
  goes: a Human holds no credential but the cookie, so "a Human present" is what `auth` already means.
- **The CLI is an Agent's tool.** It acts as the Agent whose key is in `DEEVY_API_KEY`, and as nobody without
  one. `deevy login`, `deevy logout` and the stored token go, and so does `deevy events watch`, since the
  Event stream is a Human's. Its generated commands are the operations an Agent may call, plus the public
  health check. A command that could only be refused is not one of its commands.

What stays: no Agent rules on a Gate (ADR-0004), and an Agent is denied every operation that does not say
otherwise (ADR-0011). ADR-0010's rule, that a delegated credential decides nothing, now holds by
construction. A credential that comes back has to bring its own refusal with it.

## How it lands

In slice 9. Both Better Auth configurations lose `mcp()` and `jwt()` (`packages/core/src/auth.ts`,
`packages/db/auth.generate.config.ts`). `vp run db#generate:auth` regenerates the auth schema without the
OAuth tables. The retired tables move to `packages/db/src/schema/oauth.ts`, out of the relations and read by
nothing, for slice 12's fresh migration history to drop. The following go:

- `cimd.ts` in core and in `apps/server`;
- the consent route and Settings › MCP clients;
- `oauthClients.*`;
- the CLI's `login.ts` and `watch.ts`;
- `@better-auth/mcp`, `@better-auth/cimd` and `@better-auth/oauth-provider`;
- `docs/as-yourself.md` and the public page for a Human's own MCP client.

The acceptance test is `packages/core/tests/only-agents-speak-mcp.test.ts`, with the CLI's half in
`apps/cli/tests/identity.test.ts`.

## What it costs

- **No model at a Human's prompt acts as them.** A Human who drove deevy from their own Claude Code now reads
  in deevy and works in the tracker. A Human who wants a model to do deevy's part of the work gives it an
  Agent, sponsored by them, with a key of its own. Its Runs, its Proposals and its Gates are then recorded
  as that Agent's.
- **A script acts as an Agent too.** A Human who scripted against the API with the CLI's token makes an Agent
  for the script. What only a Human may do, such as issuing a key, connecting a tool or ruling, has no
  scriptable path, by design.
- **MCP's own authorization flow is not offered.** A client that only knows the 2026-07-28 OAuth flow and
  cannot send a configured bearer cannot connect. Every coding agent deevy documents takes a header.

## Why not the alternatives

**Keep the OAuth server for Human clients, and keep restating the rules for them.** That is the state this
replaces: two credentials for one Human, a refusal list that grows with every Human-only operation, and eight
tables and a consent page to answer for. None of it is used once a Human answers in their tool.

**Keep the OAuth server for the CLI only.** That is a browser dance, a token at rest and an audience per
surface (ADR-0023), all so that a terminal can do what deevy's pages already do. A script that needs deevy is
an Agent's job.

**Let a Human mint a personal key.** It is one table deevy already has, and it is a credential that acts for
a Human while they are away. ADR-0010 exists to keep that credential from deciding anything, and the simplest
way to keep it from deciding anything is not to mint it.
