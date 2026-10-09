---
"@deevy/web": minor
---

A browser tab that stays hidden for 30 seconds stops listening for live updates, and picks up where it left off when you come back to it: what changed while it was hidden appears at once, and a tab left open in the background no longer holds a connection to the server all day. On a hosted Workspace, an open tab now hears about new Events over a WebSocket the Workspace pushes to, rather than a stream it keeps open, so a Workspace sleeps between Events while its tabs stay open. `health.ping` says which a deployment offers in a new `live` field: `stream` for the Docker image and a Worker of your own, which work as before, and `websocket` for a hosted Workspace. A tab that cannot open the socket, behind a proxy that drops WebSocket upgrades say, uses the stream instead.
