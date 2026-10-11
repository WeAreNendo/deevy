---
"@deevy/core": minor
"@deevy/web": minor
---

**Settings shows the version deevy runs and links to its source; /healthz reports the version.** The foot of every Settings page reads `deevy <version> · Source code`, and the link goes to that release's tag on GitHub (the repository itself on a build that does not say its version), so whoever uses an instance can read the source of what they are using, as the AGPL asks. `/healthz` now answers `{"ok":true,"version":"<version>"}`, and `health.ping` has a `version` field; both say `null` when the build did not name one. A probe that only checks `ok` or the status code needs no change.
