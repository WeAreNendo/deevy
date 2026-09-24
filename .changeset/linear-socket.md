---
"@deevy/core": minor
"@deevy/sockets": minor
---

Work in Linear. Connect a Linear workspace under **Settings › Sockets › Connect Linear**: make an OAuth
application in Linear with the addresses deevy shows you, turn on client credentials and webhooks (Issues
and Comments), and paste its client ID, client secret and webhook signing secret back. deevy works as the
application itself, so every comment and label is the app's. Bind a Project to a team, and an issue labelled
`agent:<handle>` there goes to that Agent; completed and canceled issues are closed, and an Agent's
sub-issues are Linear's own. A Linear admin can also install deevy as an agent from the Socket's page, after
which assigning an issue to deevy hands it to the Project's default Agent. `docs/OPERATIONS.md`, "Working in
Linear", walks through it.

Humans rule from Linear with `/approve` or `/reject <why>`, as on GitHub, once they have linked their Linear
account under **Settings › Identities › Link Linear**, which asks on Linear's own page and keeps no token.
Deliveries more than a minute old are refused.

A Project that mirrors Runs now also comments on the record when an Agent opens a pull request, where the
tracker is not also where the code is.

New: `identities.begin` and the `/api/identities/:provider/callback` route, `sockets.install`,
`accountCallbackUrl` on `sockets.begin`, `tools` on `identities.list`, and `title` on the `issue.link_added`
Event's payload.
