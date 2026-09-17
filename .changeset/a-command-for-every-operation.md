---
"@deevy/cli": minor
---

The first piece of a deevy CLI: a new `@deevy/cli` package that reads deevy's operation registry and works out the command list from it. Nothing is runnable yet — the commands themselves, sign-in and output formatting are the slices after this one — but the shape is now fixed, and it is the shape the API, the MCP tools and the web client already have: one operation defined once, projected to a surface (ADR-0005).

There is nothing to install and nothing changes for a running instance.
