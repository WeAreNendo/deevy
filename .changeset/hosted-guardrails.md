---
"@deevy/server": minor
---

The many-Workspaces Worker limits what each Workspace may do in a day, since they all send through one sender: past `DEEVY_HOSTED_INVITATIONS_PER_DAY` invitations in the last 24 hours (50 by default) the next is refused with when it can be made, and past `DEEVY_HOSTED_EMAILS_PER_DAY` emails (500) what is owed waits and goes out as the window opens, which Settings › Email shows. `Platform.configure` gives one Workspace limits of its own, and `Platform.status` reports the limits in force with invitations and emails today and Runs this month. The image and the Worker limit nothing, as before. See "The many-Workspaces Worker" in OPERATIONS.md.
