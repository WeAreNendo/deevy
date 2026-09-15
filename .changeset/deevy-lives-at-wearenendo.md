---
"@deevy/server": patch
"@deevy/agent": patch
---

deevy has moved to the WeAreNendo organisation on GitHub, and its images with it. From this release on they
are published as `ghcr.io/WeAreNendo/deevy` and `ghcr.io/WeAreNendo/deevy-agent`; the old paths under
`ghcr.io/mattallty` keep every tag they already have and receive no new ones. Change the image in your
compose file or `docker run` line, and the `DEEVY_AGENT_IMAGE` you pass to the runtime if you set one. The
repository itself redirects from its old address, so links and clones keep working.
