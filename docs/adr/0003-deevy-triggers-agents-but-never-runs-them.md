# deevy triggers agents; it never runs them

> True again since [ADR-0034](./0034-deevy-runs-no-agent-and-manages-no-access.md): for a while deevy shipped
> a reference runtime beside it (ADR-0013); it no longer ships anything that runs an Agent.

Assigning an Issue to an Agent must make the agent start, and the obvious way to guarantee that is to run the
agent inside deevy, which is what Paperclip and It's a Plan do. We decided the opposite: deevy emits an event to
the URL an Agent registered and exposes an inbox over MCP for agents that poll, and that is all. deevy never
executes agent code, never holds model API keys, and never manages an agent's session. Agent runtimes (Claude Code
in CI, an Agent SDK service, a GitHub Action, a local loop) stay outside, which keeps deevy small, keeps model
credentials out of the tracker, and lets any runtime plug in.

## Consequences

- deevy must deliver triggers reliably: the Event log is the source, webhooks retry from it, and polling is the
  fallback.
- A reference runtime adapter is a separate deliverable, not part of the core.
