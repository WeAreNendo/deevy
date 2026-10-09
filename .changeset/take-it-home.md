---
"@deevy/server": minor
---

A hosted Workspace can be taken home. The image carries `dist/import.mjs`, which loads the dump a hosted export hands over into a new volume: `docker run --rm -i -v deevy-data:/data ghcr.io/wearenendo/deevy dist/import.mjs - < workspace.sql`. It refuses a database that already holds anything, brings a dump from an older release forward with the image's own migrator and refuses one from a newer release, removes the OAuth resources and tokens bound to the hosted address, checks `DEEVY_SECRET` against everything sealed with it when that is set, and prints what it imported and what to point at the new address. Start deevy on the volume with the `BETTER_AUTH_SECRET` and `DEEVY_SECRET` the export handed over. `dist/import.mjs --for-d1` turns the same dump into SQL for a new D1 database, for a Worker of your own. See "Taking a hosted Workspace home" in OPERATIONS.md. Nothing changes for an instance that does not import.
