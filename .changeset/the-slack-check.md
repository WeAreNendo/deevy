---
"@deevy/core": patch
"@deevy/sockets": patch
"@deevy/web": patch
---

Links in Slack notifications, from the Slack app or an incoming-webhook Channel, now open the record's page in
deevy (`/work/<id>`). They used to point at `/issues/<key>`, which no longer exists. Connecting Slack now
refuses a user's token, which would have made deevy post as that person. The app manifest no longer asks for
`users:read`, since a click already says who clicked, so an app made from it asks for `chat:write`, `im:write`
and `commands` only. Slack's refusals read as words with Slack's code, such as "deevy is not in that channel:
/invite @deevy there (not_in_channel, chat.postMessage)".
