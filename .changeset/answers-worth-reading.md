---
"@deevy/cli": minor
---

Commands now answer with something a person can read. A list is a table with the columns you recognise a row by — `key`, `title`, `handle` — rather than a JSON document you have to scan; a single thing is its fields, aligned; and an operation whose whole answer is that it happened says so in a word.

`--json` is unchanged and exact, and is what a script should use.

Colour appears only when you are looking at a terminal: a pipe gets plain text, and `NO_COLOR` turns it off.

None of this is written per command. The shape of the answer decides how it is shown, so an operation added to deevy is readable without anybody teaching the CLI about it.
