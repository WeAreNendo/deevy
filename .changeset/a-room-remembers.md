---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/editor": minor
---

A room now remembers what was typed in it and turns it into versions. Thirty seconds of quiet writes the
markdown the room holds; a further quiet within ten minutes, by the same people, amends that version rather
than adding another, so an afternoon of writing leaves a history somebody can read. A version names everyone
whose keystrokes are in it, and `documents.versions` reports them. A version a Gate ruled on is never
amended. An Issue's description is saved the same way, without versions, because it has none.
