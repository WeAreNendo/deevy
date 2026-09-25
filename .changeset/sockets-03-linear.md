---
"@deevy/core": minor
"@deevy/sockets": minor
---

**Linear, as an OAuth application acting as itself.** Make one in Linear with the addresses deevy shows under **Settings › Sockets › Connect Linear**, turn on client credentials and webhooks (Issues and Comments), and paste its client ID, client secret and webhook signing secret. Every comment and label is the application's.

Bind a Project to a team. Completed and canceled issues count as closed, and an Agent's sub-issues are Linear's own. A Linear admin can also install deevy as an agent from the Socket's page, after which assigning an issue to deevy hands it to the Project's default Agent.

Humans rule with `/approve` or `/reject <why>` once they link Linear under **Settings › Identities**, which asks on Linear's own page and keeps no token. Deliveries more than a minute old are refused.

"Working in Linear" in `docs/OPERATIONS.md` walks through it. It was checked against the schema Linear publishes — `vp run sockets#check:linear` repeats that — but not yet walked in a Linear workspace.
