---
"@deevy/cli": minor
---

Commands now answer with something a person can read. A list is a table with the columns you recognise a row by — `key`, `title`, `handle`, and the State's name rather than its id — plus whatever time the row carries, so `deevy inbox list` shows you what is unread and `deevy members list` shows you who is suspended. A single thing is its fields, with nested shapes indented under their names. An operation whose whole answer is that it happened says so in a word, and one that counts says the count.

Free prose stays out of the grid and long values are clipped, so one Issue with a long description no longer makes every other row that wide. Titles that are not ASCII line up, because a column is not a UTF-16 unit.

`--json` is unchanged and exact, and is what a script should use.

Colour appears only when you are looking at a terminal: a pipe gets plain text, and `NO_COLOR` turns it off.

None of this is written per command. The shape of the answer decides how it is shown, so an operation added to deevy is readable without anybody teaching the CLI about it.
