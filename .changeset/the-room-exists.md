---
"@deevy/core": minor
"@deevy/server": minor
"@deevy/web": minor
---

Groundwork for Documents two Members can write at once: the room exists, and nothing uses it yet. Operators
deploying the Worker should know that it now declares a Durable Object binding (`ROOMS`) and the
`nodejs_compat` and `new_module_registry` compatibility flags — a deploy creates the object, and Durable
Objects need a paid Workers plan. The Node deployment needs nothing extra and answers the same websocket on
the port it already listens on.
