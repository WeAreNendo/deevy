---
"@deevy/core": patch
---

The four-hourly reminder about a Gate now asks again only the Humans who still have something to do on it. Before, it brought the Gate's Notification back unread for everyone it had first asked, so on a Gate that wants two approvals the Human who had already approved was asked to approve again every four hours until somebody else did. Now a Human who has already ruled on the Gate is left alone, and so is one who has been suspended, or is no longer named on the Checkpoint, since the Gate asked. A Human named on the Checkpoint after the Gate asked is still told at the next reminder, as before, unless they have ruled on it by then. A Run waiting on a plain question reminds the Human behind it as before.
