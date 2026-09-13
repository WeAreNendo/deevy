---
"@deevy/core": patch
---

A Document typed into for months no longer carries every keystroke it ever had. A room's stored state is
written in half the bytes it used to take, and once it passes a quarter of a megabyte with nobody in the
room it is rebuilt from the Document's own markdown and the history is dropped. Rooms saved by earlier
versions are read exactly as before.
