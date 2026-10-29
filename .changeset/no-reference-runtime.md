---
"@deevy/server": minor
---

deevy no longer ships a runtime for Agents. The `ghcr.io/wearenendo/deevy-agent` images (`latest`, `claude-code`, `opencode`, `cursor` and `copilot`) are no longer published, the Compose file has no `agent` service, and nothing reads the `DEEVY_AGENT_*` settings any more. deevy itself is unchanged: an Agent is whatever holds its key, so run it with the coding agent or program you already use, pointed at your Workspace's `/mcp` with the Agent's key, and give it access to its repository yourself (docs.deevy.dev, Agents › Bringing your own harness). If you run a `deevy-agent` image, stop it rather than keep it: the last one published, 0.11.4, runs git as root in a Run's clone, where the coding agent can plant a hook that git then runs, and reads what a Run moved from the clone's own `origin`, which the coding agent can repoint. Both were fixed on main and will not be released.
