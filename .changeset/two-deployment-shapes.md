---
"@deevy/web": minor
"@deevy/adapters": minor
"@deevy/db": minor
"@deevy/server": minor
"@deevy/hosted": minor
---

deevy is now deployed two ways: the Docker image, which you host yourself, and the hosted Worker that deevy Cloud runs. The single-Workspace Cloudflare Worker on D1 is gone. If you run deevy on a Worker of your own, run the Docker image instead. A later release of this series starts from an empty database, so nothing in your D1 database comes with it. The **Deploy to Cloudflare Workers** page is gone from the docs, and so are its bindings, `apps/web/wrangler.jsonc` and `apps/web/.dev.vars.example`.

A hosted Workspace taken home now goes only into the image: `dist/import.mjs <dump.sql>` loads it as before, and `--for-d1` is gone.

If you build deevy from source: `web#build:workers`, `web#check:workers` and `web#test:workers` are gone, and `vp run web#build` builds the SPA into `apps/web/dist` as before. The hosted Worker serves that same `apps/web/dist` as every Workspace's assets, so build it with `vp run web#build` and then `vp run hosted#build:hosted`. Its archive is laid out as before. `packages/db/migrations`, the migrations wrangler applied to D1, is gone, and so are `db#check:d1` and `server#check:d1-import`. `db#generate:d1` is now `db#generate:durable`, and writes only `packages/db/src/durable-migrations.ts`. `@deevy/adapters/workers` is gone; its SPA helpers are at `@deevy/adapters/spa`.
