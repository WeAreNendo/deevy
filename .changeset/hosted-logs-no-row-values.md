---
"@deevy/hosted": patch
"@deevy/core": patch
---

A hosted Workspace's logs now keep deevy Cloud's promise to carry nothing from its database. When a query failed, the Workspace logged drizzle's error whole, and its message lists every value the query was bound to, such as the row being written or a Human's email address; Better Auth's own log lines about a failed query did the same, as did the line its router writes for a failure inside a sign-in (`# SERVER_ERROR`), which could carry the Human's address or the sign-in's PKCE verifier, and so did a failure the runtime logged for a request the Workspace could not serve or for its background work. Each of these now names the Workspace, the error, the query's SQL with its placeholders, and SQLite's reason, which names a column or a constraint and never a value; any other error's message is left out for the same reason. The Docker image and the self-hosted Worker still log errors whole, since that log is the operator's own.
