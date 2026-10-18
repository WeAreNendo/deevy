---
"@deevy/hosted": patch
---

The hosted Worker's own `/healthz` now also answers with `versionId`, the id of the Cloudflare Worker version serving the request, through a new `version_metadata` binding (`CF_VERSION_METADATA`) in its `wrangler.json`. A deploy that tests a version at 0% through Cloudflare's version override header compares it with the version it uploaded, which proves the request reached that version even when the release is the same as the one running. A deployment of your own needs nothing new: Cloudflare provides the binding.
