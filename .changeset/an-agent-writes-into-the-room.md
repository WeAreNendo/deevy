---
"@deevy/core": minor
---

An Agent writing a Document somebody is typing in no longer has to win or lose. `documents.get` hands back
the live text and an opaque `basis`; echo it on `documents.write` and the server replays what you _changed_
onto what the Document says now, so your paragraph and theirs both survive. Where the two genuinely
collide — the same lines on both sides — the write is refused, naming the section, and the Agent re-reads
and tries again; the Human typing is never interrupted. `documents.writeSection` rewrites one heading's
worth without sending the rest of the Document, which merges by construction and reads better in the log.
