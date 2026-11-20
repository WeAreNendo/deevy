---
"@deevy/server": patch
---

**The server image runs on a rebuilt base with zlib's fix** (`zlib1g` 1:1.3.dfsg+really1.3.1-1+deb13u1), closing CVE-2026-85091, a heap overflow in zlib. The same base moves Node to 24.22.3 and brings Debian's current `ca-certificates` and `tzdata` 2026f. Nothing to change on your side: pull the new image.
