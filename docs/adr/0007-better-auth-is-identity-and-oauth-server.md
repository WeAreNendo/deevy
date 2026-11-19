# Better Auth provides identity, and deevy is its own OAuth authorization server

> Amended by [ADR-0035](./0035-only-agents-speak-mcp.md): Better Auth is identity only. deevy is no OAuth
> authorization server, a Human's MCP client is not offered, and `/mcp` takes an Agent's key.

Humans sign in with GitHub, GitLab, Google, or a generic OpenID Connect provider. There is no local password.
Agents authenticate with API keys issued by their Sponsor. MCP clients used by Humans, such as Claude Code, sign
in with OAuth 2.1 as the 2026-07-28 MCP authorization spec requires, which means deevy must be an authorization
server that publishes protected-resource and authorization-server metadata and accepts client ID metadata
documents. Better Auth 1.7 supplies all of it on Hono under Node, and most of it under Workers, so deevy uses
Better Auth for sessions, social providers, API keys, and the OAuth server, rather than building any of them.

Every Member is a Better Auth user. An Agent is a user with no password and no login, only API keys, the way
Vikunja's bot users work, so sessions, API keys, MCP tokens, and Events all resolve to one principal. deevy keeps
its own tables for Workspace, Team, Member, and Sponsor; Better Auth's organization plugin is not used.

A fresh instance gets its first admin from an admin email in configuration: the first sign-in matching it becomes
Workspace admin. This is deterministic and needs no transaction, which D1 cannot provide.

## Consequences

- Pin Better Auth to the 1.7 line and upgrade its scoped packages together; earlier lines miss OAuth fixes.
- Date columns must be stored as integer timestamps, since Better Auth's Drizzle adapter on D1 fails on text
  dates today.
- The Workers target needs a client-ID-metadata-document fetch transport of our own, since Better Auth ships only
  a Node one, and a workaround for token verification when the authorization server and MCP server share a
  Worker. Both belong to the Workers milestone.
