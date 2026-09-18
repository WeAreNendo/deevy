---
"@deevy/core": minor
---

deevy now issues access tokens for two protected resources instead of one: the MCP server at `${BETTER_AUTH_URL}/mcp`, as before, and the operation API at `${BETTER_AUTH_URL}/api`, which is new. A token is checked against the resource it was minted for, so one granted to an MCP client reaches the tools and not the ninety-four operations behind them, and one granted to an API client is refused at `/mcp`.

**Nothing an existing MCP client does changes.** Its tokens are still minted for `/mcp` and still accepted there; the second resource is additive.

This is what lets a Human sign in from something that is not a browser — the CLI being built on top of it — without that credential inheriting everything an MCP consent grants. Gate rulings are unaffected and still cannot be made by any delegated credential, whatever it is for.

RFC 9728 protected-resource metadata is served for the MCP resource only. A client that needs the API resource reads `/.well-known/oauth-authorization-server` and names the resource in its authorization request (RFC 8707).
