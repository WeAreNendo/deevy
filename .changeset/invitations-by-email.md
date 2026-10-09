---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/web": minor
---

**Invitations are emailed now, when a sender is configured.** Inviting someone emails them the link, saying who invited them, to which Workspace, as what, and until when. The dialog still shows the link once, and says either that it is being emailed or why it wasn't, so you can send it yourself. Each outstanding invitation shows whether its email went: Emailed, Email on its way, or Email failed with the sender's own words. Pass `send: false` to `invitations.create` to only get the link. To email it later, the link's token is kept sealed under `DEEVY_SECRET`, and only until the email lands or the invitation is accepted, revoked or expires; without `DEEVY_SECRET` the invitation is not emailed, and the dialog says so. A migration adds `invitation.sealed_token`, which no read ever returns.
