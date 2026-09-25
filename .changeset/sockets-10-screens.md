---
"@deevy/adapters": minor
"@deevy/cli": minor
"@deevy/web": minor
---

**The screens are what a Human does now.** **Home** is what needs you: Gates awaiting your ruling, then Runs awaiting your answer, then your Agents' Runs. **Runs** is the feed, and a Run's page has its Activity, its Gates, and **Try again** for its Agent's Sponsor or an admin when it failed or went stale. **Work** lists every record deevy has projected, read-only, each key linking to the tracker. The **Inbox** opens a Gate's ruling in place.

Settings gains **Sockets** — each with where it delivers, what it said lately, where it is installed, and disconnecting — **Projects** as bindings with their Checkpoints, and **Identities**. A tool's refusal is said in its own words, such as "Notion would not take these credentials: API token is invalid. (unauthorized, GET /users/me)", and every secret field is masked and kept from autofill.

`deevy gates open <gate or record key>` opens the ruling screen from the CLI; there is no `approve`, because a Gate is ruled by a Human in deevy's own browser. A browser picks a new version up on its next page load.
