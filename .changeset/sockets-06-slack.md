---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/sockets": minor
"@deevy/web": minor
---

**Slack, to rule from a message.** **Settings › Sockets › Connect Slack** shows the app manifest with this instance's own request URL: create the app from it (Create New App → From a manifest), install it, and paste the Bot User OAuth Token and the Signing Secret. A user's token is refused, because deevy would post as that person. The app asks for `chat:write`, `im:write` and `commands`, and nothing about people.

Add a room under **Settings › Channels**, after `/invite @deevy` there, and route **Gate awaiting** to it. A Gate arrives with Approve and Reject — Reject asks why — and the message changes whenever anybody rules, wherever they ruled. A Human whose Slack account is linked is also told by direct message, which they can turn off per kind under **Settings › Notifications**.

A click counts only from a Slack account linked to a Member. An unlinked click, or `/deevy link`, gets a private ten-minute code to enter under **Settings › Identities**, which names the account before linking it. A request more than five minutes from deevy's clock is refused, and after a new signing secret is pasted the old one is still taken for a day.

The incoming-webhook Channel still posts to a room with no app. Its links, like the app's, open the record's page in deevy.

"Working in Slack" in `docs/OPERATIONS.md` walks through it. It was checked against Slack's docs, SDKs and signing example, but not yet walked in a Slack workspace.
