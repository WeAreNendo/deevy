---
"@deevy/cli": minor
"@deevy/core": minor
---

The CLI now asks the instance what it can do before it asks it to do anything. A command the instance does not have is refused by name — `https://old.example.com has no \`projects.create\`` — rather than failing as a 404 you have to interpret. That is what makes a newer CLI safe against an older deevy, which will happen the first time somebody upgrades one and not the other.

It reads the instance's own API document once a day and keeps the answer beside the token. It is not a version check: two instances on the same version have the same operations, and comparing the operations says _which_ command is missing.

An instance now puts its version in that document, so the message can name both sides. A deevy that does not say (an older one, or one whose entry never told it) is described rather than given a number it did not claim.

`--deevy-url` points a single command somewhere without setting `DEEVY_URL`.

One upgrade note: the file a token is kept in now carries the scheme — `https_deevy.example.com.json` rather than `deevy.example.com.json` — because `http://host` and `https://host` are two instances and were sharing one file. Signing in again is all that is needed.
