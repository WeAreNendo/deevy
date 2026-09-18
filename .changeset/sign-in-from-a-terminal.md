---
"@deevy/cli": minor
---

`deevy login`, `deevy logout` and `deevy whoami`. Signing in opens a browser, takes the consent you would give any other client, and keeps the token at `~/.config/deevy/<instance>.json` — one file per instance, mode 0600, so signing into a second deevy does not sign you out of the first.

Set `DEEVY_API_KEY` and the CLI acts as that Agent instead, which is what a script wants. It wins over a stored token because it is the explicit thing you put there for that one run, and `deevy whoami` says which of the two it used — that changes what the CLI may do, so it is stated rather than left to be guessed.

Nothing else is runnable yet: the operations arrive in the next release.
