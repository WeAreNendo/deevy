---
"@deevy/core": patch
---

The API reference at `/api/docs` works again for a deevy served under a path and for every hosted Workspace (`/acme/api/docs`). Since 0.11.0 it was sent the policy every other page carries, which refuses the reference viewer's script, so the page stayed blank; at the root of a host it was unaffected.
