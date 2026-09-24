---
"@deevy/core": minor
"@deevy/sockets": minor
"@deevy/agent": minor
---

Work in Notion, and read a Project's documents where the team keeps them. Connect a Notion workspace under
**Settings › Sockets › Connect Notion** with an internal integration's secret, share the databases deevy
should read with the integration, and add a webhook subscription to the address deevy shows; Notion's
verification token then appears on the Socket's page, to paste into Notion's Verify. Bind a Project to a data
source: its status property's Complete group counts as closed, a multi-select option `agent:<handle>` routes a
row to that Agent, and sub-items are the rows' parents. `docs/OPERATIONS.md`, "Working in Notion", walks
through it.

Humans rule from Notion with `/approve` or `/reject <why>` in a comment. Notion has no account to link, so an
admin turns on **Take a verified address as proof** on the Socket's page, and every ruling made that way says
"(email)".

A Project's documents can now be bound to any tool that holds them, from the Project's settings, and Agents
read a page there as markdown with the new `docs_get` tool. The reference runtime grants it.

Fixed: a Project's settings showed the Default Agent as a Member id and Mirror as `gates`; both read as words
now.
