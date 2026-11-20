---
"@deevy/db": minor
"@deevy/adapters": minor
"@deevy/core": minor
"@deevy/server": minor
"@deevy/hosted": minor
---

**This release starts on an empty database. There is no upgrade from 0.11 or anything before it.**

This release made deevy simpler, and what the removed parts kept went with a migration history that starts afresh: usage reports, Channels, routing rules and preferences, email senders, linked Identities, the OAuth server's clients and tokens, schedules, and the columns nothing reads any more. Every release after this one upgrades in place again, and the release before it runs on its schema.

- **Docker**: start this release on a new volume. On a volume an older release wrote, it stops before changing anything and says the database is from before 0.12. Keep that volume: it is your backup, and starting 0.11 on it is how you go back, since 0.11 does not run on what this release writes. On the new volume, sign in with the admin address, which makes the Workspace, then connect your tools, bind your Projects, create your Agents and give each its new key, and let your team in with the allowlist or an invitation. Your records arrive from your tools, each the next time it changes.
- **The hosted Worker**: destroy and provision every Workspace again for this release, and deploy it whole rather than gradually, since neither release opens a Workspace the other migrated. One an older release migrated answers 503 with no retry, and `Platform.status` for it says why.
- **Taking a hosted Workspace home**: the image's `import.mjs` refuses a dump from before 0.12, and says so. Import it with an image of the release it came from.
