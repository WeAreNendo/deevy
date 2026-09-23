---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/sockets": minor
---

Approve and reject from Slack. Connect a Slack app under **Settings › Sockets** — deevy shows the app
manifest with your instance's own request URL, so creating the app is one trip to Slack — then add a room in
it under **Settings › Channels** and route **Gate awaiting** there. A Gate arrives with Approve and Reject
(Reject asks why), and the message changes when anybody rules, wherever they ruled. Humans whose Slack
account is linked are also told by direct message, which they can turn off per kind under **Settings ›
Notifications**. The incoming-webhook Channel keeps working as before.

A click counts only for a Slack account linked to a Member. An unlinked click, or `/deevy link`, gets a
private ten-minute code to enter under **Settings › Identities**, which names the account before linking it.
Requests older than five minutes are refused, and after pasting a new signing secret (`sockets.update`,
`webhookSecret`) the old one is still accepted for a day.

Fixed: connecting a tool now proves the credential you pasted. Before, `sockets.connect` checked the
connection without it, so pasting an existing GitHub App failed.

New: the `link_code` table and three columns (applied by the migrator), `channels.createInSocket`,
`identities.peek` and `identities.link`, `sockets.connect` completing a Socket `sockets.begin` started,
`slackDm` on notification preferences, and `chatMessages` in the background pass's result.
