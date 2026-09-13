---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/web": minor
---

A Gate that wants two Humans no longer collects approvals of two different texts. When a Document changes
while its Issue is sitting at such a Gate, the approvals already given are cleared and the Gate asks again —
the ruling card says so where the buttons are, and the Activity says which Document changed. Nothing is
deleted: the rulings stay in the log and the version each one approved stays pinned. A Gate that wanted one
Human is untouched, because the Issue has already gone through it.
