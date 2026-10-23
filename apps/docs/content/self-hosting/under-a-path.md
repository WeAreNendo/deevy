---
title: Behind a proxy or under a path
description: Put a reverse proxy in front of deevy, serve it under a path such as example.com/deevy, and keep what the proxy must forward and pass through intact.
sidebar:
  order: 7
---

The Docker image speaks plain HTTP, so it usually sits behind a reverse proxy that terminates TLS: Caddy,
nginx, Traefik, a load balancer or a tunnel. A Worker can sit behind a proxy too. Either way, deevy needs
a few things from the proxy to work.

## What a proxy must do

- **Forward everything under deevy's address**, unchanged. That includes `/api`, `/rpc` and `/mcp`, and
  `/hooks/…`, where your tools deliver: it has to be reachable from the internet, over HTTPS, for them.
  It also includes `/.well-known/…`, where MCP clients and the CLI discover how to sign in.
- **Set `BETTER_AUTH_URL` to the public address**, the one the browser visits, not the address the proxy
  forwards to. deevy builds sign-in, cookies and links from it, never from the request.
- **Let a response stream.** An open deevy page keeps one long-lived request that streams what changes, so
  a proxy that buffers responses, or cuts a connection that has been open for a while, delays or breaks
  the live view.
- **Pass `Origin` and `Sec-Fetch-Site` through untouched.** See
  [Where a change may come from](#where-a-change-may-come-from).
- **Pass deevy's security headers through, and add no script.** See
  [What a page may run](#what-a-page-may-run).

## Under a path

deevy can live under a path of a host, such as `https://example.com/deevy`, rather than at its root. There
is no separate setting for it: put the path in `BETTER_AUTH_URL`, and everything follows.

```bash
BETTER_AUTH_URL=https://example.com/deevy
```

- **Every route is under the path**: the web app at `/deevy/`, and `/deevy/api`, `/deevy/rpc`,
  `/deevy/mcp` and `/deevy/hooks/…`. The proxy forwards `/deevy/…` as it is, without stripping `/deevy`.
- **Each sign-in callback carries the path**: `https://example.com/deevy/api/auth/callback/github`.
- **Discovery lives at the root of the host**, outside the path. The standards for it put the well-known
  segment straight after the host, so MCP clients look for
  `/.well-known/oauth-authorization-server/deevy` and `/.well-known/oauth-protected-resource/deevy/mcp`.
  A proxy that forwards only `/deevy/…` has to forward `/.well-known/*/deevy*` to deevy too, or a Human's
  MCP client finds nowhere to sign in.
- **`/healthz` answers at the root of the host** as well as under the path, so a container's health check
  needs no change.
- **The session cookie is scoped to the path**, so two deevys on one host never share a sign-in.
- **Agents and the CLI take the whole address**: an Agent's `DEEVY_URL` is `https://example.com/deevy`,
  and so is `deevy login https://example.com/deevy`. Use a current CLI: older ones cut the address down to
  its host.

### On a Worker

Cloudflare's asset handler, which serves the web app at the root, knows nothing about a path. Under one,
every request has to reach deevy, which then serves the web app itself. In `apps/web/wrangler.jsonc`, set:

```jsonc
"assets": {
  "binding": "ASSETS",
  "not_found_handling": "single-page-application",
  "run_worker_first": true,
},
```

Then build, check and deploy again, as in [Deploy to Cloudflare Workers](/self-hosting/cloudflare-workers/).

## What a page may run

Every page deevy serves runs only the scripts deevy shipped, with one exception: the API reference at
`/api/docs` loads its viewer, Scalar, from `cdn.jsdelivr.net`, pinned to one version. Every other page
carries a `Content-Security-Policy` that allows scripts from deevy's own origin only, with no inline script
and nothing from another host,
along with `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and
`Referrer-Policy: strict-origin-when-cross-origin`.

So a proxy must pass these headers through rather than replace them, and must not add a script to the
page. An analytics snippet, or Cloudflare features that rewrite pages, such as Rocket Loader, Email Address
Obfuscation and automatic Web Analytics injection, add inline scripts the browser will refuse. If the
browser's console reports a Content Security Policy violation on one of deevy's pages and nothing in front
of deevy adds a script, that is a bug worth [reporting](https://github.com/WeAreNendo/deevy/issues).

## Where a change may come from

A change made with a browser's session, any `POST`, `PUT`, `PATCH` or `DELETE` to `/rpc` or `/api`, has to
come from deevy's own page. deevy takes it when the browser sends `Sec-Fetch-Site: same-origin`, or an
`Origin` that is `BETTER_AUTH_URL`'s origin or `DEEVY_WEB_ORIGIN`. Anything else is refused with
`403 FORBIDDEN` and the message "deevy only takes a change signed in with your session from its own
pages. Use deevy itself, or an API key or access token from a script."

A proxy that strips both headers, or rewrites `Origin`, makes every change in the web app fail that way.
An Agent's key, or a CLI's or MCP client's token, is unaffected.

## The web app on an address of its own

Both the Docker image and the Worker serve the web app themselves, at `BETTER_AUTH_URL`, and that is the
setup to keep. If you serve the web app from a different origin anyway, set `DEEVY_WEB_ORIGIN` to it. deevy
then accepts that origin's calls, and builds the links it hands a Human, in an invitation, a Gate or a
Slack message, on it rather than on the API's address.
