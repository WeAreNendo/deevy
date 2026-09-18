# The API is its own protected resource, beside MCP

deevy has been its own OAuth authorization server since M2 (ADR-0007), and every token it minted was bound
to one resource: `${baseURL}/mcp`. `principal.ts` verified that audience and no other, so an access token
was, by construction, a token for the tools. That was right while MCP was the only surface a delegated
credential reached.

The CLI is a Human holding a delegated credential and reaching the **operations** instead — all ninety-four
of them, over `/rpc`. An MCP token presented there resolved as anonymous, which is the audience check
answering correctly a question nobody had asked yet: what is a token for deevy's API?

## The decision

The operation API is a second protected resource, `${baseURL}/api`, on the same authorization server.

`/api` and `/rpc` share it. They are two transports for one set of operations — the same procedures, the same
`authorize()` middleware — so they are one resource; the identifier names what a token may reach, not how it
gets there. `/api` is the identifier because that is the surface deevy documents and serves a spec for.

The expected audience is a property of the surface a request reached rather than a constant. `buildContext`
takes it and hands it to `resolvePrincipal`, and it is a required parameter of a union type on both: the
first version of this change gave each of them a default, the two defaults disagreed, and a caller that left
the argument off would have picked up whichever was wrong for it. Four call sites in the tree say which
surface they are, including two room servers that had been quietly flipped by those defaults.

**The API resource is allowed at registration, not handed out by it.** `clientRegistrationDefaultResources`
links a resource to every client that registers, which would have given the whole operation API to any MCP
client that asked for nothing — the opposite of the point. `clientRegistrationAllowedResources` means a
client is linked to the API only if it names it in its registration, so an MCP client that does not ask holds
a token for the tools and nothing else, and one that asks anyway is refused with RFC 8707's `invalid_target`.

## Why not the alternatives

**Widen the audience check** so any token this server minted is accepted anywhere. One line, and it erases
the distinction RFC 8707 exists to draw: a Human who consented to some MCP client would find that consent
also driving the whole API.

**Let the CLI register as an MCP client** and spend an MCP token on `/rpc`. The same erasure wearing a
disguise, and it would make every existing MCP client an API client too.

## What it does not change

An MCP token still reaches `/mcp`, and nothing an MCP client did before behaves differently. A test asserts
that beside the two that assert the refusals, because the interesting direction is not the one that broke.

The Gate rules are untouched. `gates.approve` and `gates.reject` are `sessionOnly`, so no delegated
credential of any audience decides a Gate (ADR-0004, ADR-0010).

API keys and cookies are untouched: they resolve by other branches and never reach the audience check.

## The cost, stated

**RFC 9728 metadata is served for the MCP resource only.** The plugin is the resource server for its own
resource; the API resource is issued for but not advertised at `/.well-known/oauth-protected-resource/api`.
A client that wants it reads the authorization server's metadata and names the resource by hand, which a CLI
can do because it was given the instance URL. A test records the current behaviour so the day the plugin
advertises both, somebody notices.

**A client must ask for the API at registration**, so a CLI registers by DCR with a `resources` extension. A
client registered through a Client ID Metadata Document has no requested resources, so it is linked to MCP
alone — which means a CLI cannot identify itself by CIMD without the API resource being linked some other
way.

**`resource` is repeatable**, so a client linked to both may hold one token whose audience is both, and such
a token is valid at both surfaces. That is RFC 8707 working as specified rather than a hole — the client
asked for both and the Human consented to both — but "a token for one is refused at the other" is a
statement about single-resource tokens, and is worth reading that way.

**`MCP_PATH` had two definitions**, in `auth.ts` and in `mcp/server.ts`, and the audience check now depends
on it. They are one constant again.

A third surface wanting its own resource adds a constant, a union member and a call site.
