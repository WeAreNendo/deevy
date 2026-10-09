---
"@deevy/core": minor
"@deevy/web": minor
"@deevy/adapters": minor
---

**A page now runs only the scripts deevy shipped, and a change made with your session must come from deevy's own page.** Every page carries a `Content-Security-Policy` that allows scripts from deevy's origin only (no inline script, no `eval`, nothing from a CDN) and lets nothing frame it, so a Gate's Approve cannot be clicked through someone else's site; beside it come `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`, and every API answer is sent as something never to render. The Docker image sets them itself; on Cloudflare they ship in the build's `_headers` file, which the asset handler applies. `/api/docs` loads Scalar from jsDelivr under a policy of its own. If a proxy sits in front of deevy, let these headers through unchanged and do not inject scripts into its pages: an analytics snippet, Cloudflare's Rocket Loader, Email Address Obfuscation or Web Analytics injection will be refused by the browser.

A `POST`, `PUT`, `PATCH` or `DELETE` to `/rpc` or `/api` that your session cookie signed in is refused with `403` unless the browser says it came from the same origin (`Sec-Fetch-Site: same-origin`), or sends an `Origin` of `BETTER_AUTH_URL` or `DEEVY_WEB_ORIGIN` (with no `BETTER_AUTH_URL`, the address the request reached). A proxy that strips both headers or rewrites `Origin` will make every change in the app fail, and an SPA served from an origin of its own needs that origin in `DEEVY_WEB_ORIGIN`, as it already did. Agents' API keys and CLI or MCP access tokens are unaffected, and `/mcp` no longer accepts a browser session at all, only a bearer.

A sign-in provider's access and refresh tokens are now encrypted at rest under `BETTER_AUTH_SECRET`. Tokens stored before the upgrade stay readable and are encrypted the next time that person signs in with the provider; nothing needs migrating. A Link must now be an `http` or `https` address, and a link to anything else that a tracker or an Agent hands deevy is shown as text rather than as a link.
