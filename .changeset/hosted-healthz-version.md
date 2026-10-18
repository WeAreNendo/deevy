---
"@deevy/hosted": patch
---

The hosted Worker's own `/healthz`, at the root of its host, now answers with the release it runs (`{ "ok": true, "version": "<release>" }`), as each Workspace's `/healthz` already does. A deploy that tests a new version through Cloudflare's version override header reads it to prove the request reached that version.
