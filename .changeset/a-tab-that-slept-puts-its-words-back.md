---
"@deevy/core": minor
"@deevy/web": minor
"@deevy/db": patch
---

A tab left open on a Document and put to sleep now comes back cleanly. A room whose stored state has grown
large enough to be swept up starts the Document's identity again, and a browser that was away across that
used to sync its old copy in beside the new one — the same text, twice. The room now turns such a browser
away instead, and the browser puts what you typed while you were gone back as markdown, merged the way an
Agent's write is merged. Where your words and the room's changed the same lines, the room keeps what it has
and the editor hands yours back for you to place, rather than dropping them or pasting them over somebody.
