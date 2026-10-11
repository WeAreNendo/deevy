---
"@deevy/server": minor
---

deevy can live under a path of its host, such as `https://company.example.com/deevy` behind a reverse proxy: set `BETTER_AUTH_URL` to that URL and every route, the sign-in callbacks, the session cookie, the OAuth issuer and the SPA follow it. Discovery for a Human's MCP client stays at the root of the host (`/.well-known/oauth-authorization-server/deevy`), so a proxy that forwards only the path must forward those documents too, and a Worker under a path sets `assets.run_worker_first` to `true`; see "Under a path" in OPERATIONS.md. A deployment at the root of its host behaves exactly as before. The SPA's built files are now relative to a `<base href>` the server writes, so a proxy that rewrote asset URLs no longer needs to.
