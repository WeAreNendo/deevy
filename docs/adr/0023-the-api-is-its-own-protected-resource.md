# 23. The API is its own protected resource, beside MCP

Date: 2026-09-18

## Status

Accepted.

## Context

deevy has been its own OAuth authorization server since M2 (ADR-0007), and every token it minted was
audience-bound to one resource: `${baseURL}/mcp`. That was right when MCP was the only surface a delegated
credential reached. `principal.ts` verified `audience: ${issuer}${MCP_PATH}` and nothing else, so an access
token was, by construction, a token for the tools.

The CLI (`docs/plans/cli.md`) is a Human holding a delegated credential and reaching the **operations** —
all ninety-four of them, over `/rpc`. Presenting an MCP-audience token there resolved as anonymous, which is
the audience check working correctly on a question nobody had asked yet: what is a token for deevy's API?

Three answers were available.

- **Widen the check** so any token this server minted is accepted anywhere. One line, and it erases the
  distinction RFC 8707 exists to draw: a Human who consented to some MCP client would find that consent also
  drives the whole API.
- **Let the CLI register as an MCP client** and spend an MCP token on `/rpc`. Same erasure, wearing a
  disguise.
- **Give the API its own resource.** More moving parts, and the only one where a token says what it is for.

## Decision

The operation API is a second protected resource, `${baseURL}/api`, configured on the same authorization
server as MCP's.

`/api` and `/rpc` share it. They are two transports for one set of operations — the same procedures, the same
`authorize()` middleware — so they are one resource; the identifier names what a token may reach, not how it
gets there. `/api` is the identifier because that is the surface deevy documents and serves a spec for.

The expected audience is a property of the surface a request reached, not a constant. `buildContext` takes
the path and passes it to `resolvePrincipal`, so `/rpc` and `/api` check against the API resource and `/mcp`
checks against MCP's. A token minted for one is refused at the other, in both directions, and tests assert
both directions rather than the one that happened to matter.

Better Auth supports this directly: `mcp()` extends the OAuth provider's options and appends its own resource
to the `resources` list it is given, so both are registered, both can be asked for with RFC 8707 `resource`,
and a client registered here may hold either.

## Consequences

- **An MCP client's consent no longer implies API access**, and never did — this makes the claim true rather
  than accidental. The Gate rules are untouched: `gates.approve` and `gates.reject` are `sessionOnly`, so no
  delegated credential of any audience decides a Gate (ADR-0004, ADR-0010).
- **RFC 9728 metadata is served for MCP only.** The plugin is the resource server for its own resource; the
  API resource is issued for but not advertised at
  `/.well-known/oauth-protected-resource/api`. This costs the CLI nothing — it is told the instance URL, so
  it reads the authorization server's own metadata and asks for the API resource by name — and a test records
  the current behaviour so the day it changes, somebody notices.
- **Existing tokens keep working where they were always spent.** An MCP token still reaches `/mcp`. Nothing
  an MCP client did before this change behaves differently.
- **`MCP_PATH` had two definitions**, one in `auth.ts` and one in `mcp/server.ts`, and the audience check now
  depends on it. They are one constant again.
- A third surface wanting its own resource adds a constant and a call site, not a mechanism.
