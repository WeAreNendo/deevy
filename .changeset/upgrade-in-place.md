---
"@deevy/server": minor
---

Every release from this one on upgrades in place, and can be rolled back one release without restoring a backup: a release's migrations only add to the schema, and whatever it stops using is removed by a later release, so the release before it still runs on the schema it leaves. On Docker, start the previous image on the same volume; on Workers, roll the Worker back to its previous version and leave the D1 database as it is. When deevy starts on a database that has migrations it does not know, because a newer release ran on it, it now names them in its log. Going back two releases is still a backup restore; see "Upgrading" in OPERATIONS.md.
