---
"@deevy/agent": minor
"@deevy/core": minor
"@deevy/sockets": minor
"@deevy/web": minor
---

**Notion, for a database's rows as records and its pages as a Project's documents.** Make an internal connection in Notion's Developer portal — the Connect Notion dialog links it — with read, update and insert content, read and insert comments, and user information with email addresses, and paste its installation access token. A personal access token is refused: deevy would write as the person who made it.

Give the connection the databases and pages deevy should read, and subscribe its webhook to the address deevy shows. Notion's verification token then appears on the Socket's page, to paste back into Notion's Verify.

Bind a Project to a data source. Its status property's Complete group counts as closed, a multi-select option `agent:<handle>` routes a row to that Agent, and sub-items are rows' parents. Notion has no account a Human can link, so a ruling from a Notion comment counts only where an admin turned on **Take a verified address as proof**, and says "(email)" wherever it is shown.

A Project's documents can live in any tool that holds them, whatever its tracker is. Agents read a page as markdown with the `docs_get` tool, and where Notion could not read all of a page, the markdown ends saying what is missing and where the whole page is.

"Working in Notion" in `docs/OPERATIONS.md` walks through it. It was checked against Notion's SDK, API reference and example deliveries, but not yet walked in a Notion workspace.
