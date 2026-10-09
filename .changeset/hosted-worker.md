---
"@deevy/server": minor
---

A third way to run deevy: `apps/hosted`, one Cloudflare Worker that serves many Workspaces on one host, each under its own path (`https://app.example.com/acme`) with its database in a Durable Object of its own. Workspaces are provisioned, suspended, dumped and removed through a `Platform` service binding, sign in through one relay registered with every provider, and run their background work on their own alarms. The image and the Worker are unchanged. See "The many-Workspaces Worker" in OPERATIONS.md.
