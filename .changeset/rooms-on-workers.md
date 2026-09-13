---
"@deevy/web": minor
---

Live Documents work on the Cloudflare deployment: each room is a Durable Object, and the Worker routes
`/collab` to it. Durable Objects are a paid feature, so a deployment without the `ROOMS` binding keeps
exactly the Documents it had — `health.ping` says which, and nothing opens a socket that would not answer.
