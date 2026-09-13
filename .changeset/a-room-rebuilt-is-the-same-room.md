---
"@deevy/editor": patch
---

A Document is no longer at risk of becoming several copies of itself. A room is rebuilt from its markdown
whenever there is no state to open it with — the first time, after a restart, after an eviction — and a
browser that was in the room still holds its own copy of the same words. Those two are now built the same
way from the same text, so they merge into one Document instead of one after the other.
