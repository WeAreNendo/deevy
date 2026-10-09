---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/server": minor
"@deevy/web": minor
---

**Route Notifications to a team email address, like a Slack room.** Under Settings › Channels, **Add an email address** takes a shared mailbox, such as your approvals list. deevy mails it a confirmation link straight away and tells you what the sender said, so a domain it can't send from shows up there and then. Nothing is sent to the address until somebody there confirms; opening the link only asks, and the button confirms. Once confirmed, your routing rules reach it like any Channel: one email per Notification, whoever it concerns, ending with who routed it there and where that stops. While it waits, **Test** sends the confirmation again; once confirmed, it sends a test email. The API is `channels.createEmail`, and every Channel now reports `address` and `confirmedAt`.
