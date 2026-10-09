---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/server": minor
"@deevy/web": minor
---

**Settings › Email** shows which sender this Workspace sends through, as which From address, and whether that was set here or in the environment. **Send a test email** mails it to you, and says where it went or what the sender refused. An admin can also set the sender here, which overrides the environment's until they press **Use the environment's sender**. Its key is sealed under `DEEVY_SECRET` like a connected tool's credentials, and never shown again; leave it empty to keep the saved one when you only change the From. A sender that can't be built, or can't run on this deployment, is refused with the reason before it is saved. The page is admin-only and can only be changed from a signed-in session. The API is `email.status`, `email.configure`, `email.clear` and `email.test`, and the Event log records `email.configured` and `email.cleared` (without the key). A migration adds the `email_sender` table.
