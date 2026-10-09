---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/server": minor
"@deevy/web": minor
---

**Choose what deevy emails you, under Settings › Notifications.** A new Email column sits beside Inbox, Slack and Direct message, one switch per kind. Until you change them, email is on for a Gate awaiting you and a Run awaiting your answer, and off for the rest. The page says which address email goes to; if your sign-in didn't confirm an address, it says deevy can't email you and the switches are off.

**Every email can be stopped from the email itself.** Each carries a one-click unsubscribe (RFC 8058) that turns off that kind of email for you alone, and leaves the inbox and Slack as they were. Opening the link only asks; the change happens when you press the button, so a mail scanner opening links does nothing. The link is signed with `BETTER_AUTH_SECRET` and works for six months.

The migration adds a nullable `email` column to `notification_preference`, applied at startup on Docker. On Workers, apply the D1 migrations before deploying, as for every release.
