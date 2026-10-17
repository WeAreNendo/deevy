---
"@deevy/core": patch
---

Saving a Project's Checkpoints no longer cuts its open Gates loose from them. Every save used to replace every Checkpoint, so afterwards a Gate's Slack message and its email said it wanted one approval, whatever its Checkpoint asked for, while deevy itself still counted the real number. A Checkpoint that stays on the list is now changed in place and keeps its id, so a Gate's message and email name the approvals its Checkpoint wants, lowered or not. A Checkpoint you remove still lets go of its Gates, which then want the default's one approval everywhere. A Checkpoint you add at a name an open Gate already asked at now counts for that Gate in Slack and email too. For API readers, `checkpoints.list` and `checkpoints.set` keep each Checkpoint's `id` across saves.
