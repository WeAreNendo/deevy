---
"@deevy/server": patch
"@deevy/web": patch
"@deevy/core": patch
---

deevy no longer runs without `BETTER_AUTH_SECRET`. Unset, Better Auth fell back to a default secret it publishes: the Docker image then came up and answered `/healthz` while every sign-in failed, and a Worker signed everybody in on that published value without saying so, which left its sessions, the links it sent and the sign-in providers' tokens it sealed open to anyone who looked the value up. Now the Node server refuses to start and says which variable to set, and a Worker answers its API, `/healthz` included, with a 503 that says the same (its pages still load, and then can't reach it), and runs no Cron pass or queue message until it is set. If your Worker ran without one, set it with `wrangler secret put BETTER_AUTH_SECRET` (generate it with `openssl rand -base64 32`); that is a change of secret like any other, so everybody signs in again. The Node server also refuses `BETTER_AUTH_SECRETS`, Better Auth's own list of rotated secrets, which it read ahead of deevy's: unset it, and keep the current secret in `BETTER_AUTH_SECRET`.
