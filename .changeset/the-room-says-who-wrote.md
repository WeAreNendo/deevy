---
"@deevy/core": minor
"@deevy/web": minor
---

A Document open in your browser now tells you when an Agent has written into it. An Agent never joins a
room — its edit arrives as a block rather than as typing, so a cursor for it would be a lie — and instead
the Document's header says "Planner just wrote this" for as long as the change is still a surprise. The
write itself lands in the room as it happens, so the paragraphs change in front of you rather than the next
time the page is loaded.
