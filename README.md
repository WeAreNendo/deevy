# deevy

Project code name: **deevy**.

After reading Anthropic's [The AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook), the
idea: teams need project management software built for collaboration not only between humans, but between humans
and agents, and between agents and agents.

## Constraints

- Open source
- Secure
- Self-hostable
- Humans and agents collaborate as peers
- A simple API for agents to read the work, say what they are doing, and ask a human before they go on
- Works with the tools a team already keeps its work in, rather than asking them to move it
- Scales from simple projects to complex ones (multiple projects, repositories, members, hierarchy) without forcing
  one process on the team
- Promotes collaboration
- Written fully in TypeScript, built with the Vite+ toolkit (`vp`)

## Status

The glue between a team's tools and its Agents, on a single Docker container or on a Cloudflare Worker with D1,
from one codebase. The work stays where the team keeps it — GitHub, Linear, GitLab or Notion — and deevy routes a
record to an Agent by a label or a default, records the Run, holds the Gate where a Human rules on what the
Agent proposes (in deevy, with `/approve` in a comment on the record, or with a button in Slack), opens the pull
request that closes the record, and says what happened back where the team reads. Agents are Members with their
own identity, keys and audit trail, working over MCP. Every change is an Event, and the inbox, Slack, the
webhooks and what deevy writes in the tools all derive from that one log.

[`apps/agent`](./apps/agent) is the reference runtime on the other side: a service holding one
Agent's key that runs a coding-agent CLI (Claude Code, OpenCode, Cursor or Copilot) against the records that
Agent is given. deevy itself never runs an agent (ADR-0003), and never owns the tracker (ADR-0024).

The vocabulary is in [CONTEXT.md](./CONTEXT.md), the hard-to-reverse decisions in [docs/adr](./docs/adr), the
plan in [docs/PLAN.md](./docs/PLAN.md), the research that informed them in [docs/research](./docs/research),
how to run it and connect each tool in [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) and
[docs/OPERATIONS.md](./docs/OPERATIONS.md), what changed in each release in [CHANGELOG.md](./CHANGELOG.md),
and a worked agent loop in [docs/agent-loop.md](./docs/agent-loop.md). What the screens look like is in
[docs/screens](./docs/screens).

## License

[AGPL-3.0](./LICENSE) (ADR-0002).
