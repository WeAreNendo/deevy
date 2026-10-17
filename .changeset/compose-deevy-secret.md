---
"@deevy/server": patch
---

The repository's `docker-compose.yml` now asks for `DEEVY_SECRET`, as it already asked for `BETTER_AUTH_SECRET`, and refuses to start without it. Without one no tool could be connected, since deevy seals every tool's credentials under it. If you run deevy from that file, generate a second value once (`openssl rand -base64 32`, not the same as `BETTER_AUTH_SECRET`), put it in your `.env`, and keep it with the volume.
