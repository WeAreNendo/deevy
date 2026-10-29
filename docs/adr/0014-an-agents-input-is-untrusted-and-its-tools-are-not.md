# An Agent's input is untrusted, and its tools are not

> Superseded by [ADR-0034](./0034-deevy-runs-no-agent-and-manages-no-access.md): deevy ships no runtime, so
> what bounds a session is whoever runs the Agent. The position below still describes the risk; the Gate no
> Agent can pass (ADR-0004) is still the last line.

Issues, Documents, comments and Activities are written by everyone with access to a Project — Humans, and
other Agents. All of it is read by a session that, when the runtime is configured with a repository, holds a
shell in a checkout. This records what bounds that, because a decision that lives only in a documentation
section gets refactored away by somebody who never read it.

## The position

**No prompt makes this safe, and the runtime does not pretend otherwise.** Instructions telling a model to
distrust its input are worth having and are not a control. What bounds an agent is what it is able to do.

## The bounds, and what each one is for

**The container is the sandbox.** The runtime image runs as a non-root user and holds a clone and nothing
else. A runtime run directly on a laptop has no boundary at all; that is fine for trying it out and is not a
way to run it against a Workspace other people write in. OPERATIONS.md says so in those words.

**Tools are granted by name.** Never by wildcard, so deevy gaining a twenty-first tool does not widen what
the runtime may do — that would be a change decided in a different pull request. `permissionPrompts` is
`none`, so anything not granted is refused rather than parked on a prompt nobody is there to answer, and
`bypassPermissions` appears nowhere in this repository.

**Nothing on disk configures the session.** `settingSources` is empty and `strictMcpConfig` is on, so a
`.mcp.json` or a `.claude/settings.json` in the cloned repository adds no server and grants no permission.
Without those two flags, a repository could reconfigure the agent reading it.

**The session's environment is an allowlist, not a scrub.** Its process gets enough to run and for git to find
its configuration, plus `ANTHROPIC_*`, plus whatever the operator names in `DEEVY_AGENT_PASS_ENV`. Nothing
else.

This one was got wrong twice, which is why it is stated as a rule rather than a list. The first version passed
the whole environment: a shell plus the Agent's key is every operation that Agent may call, over `curl`,
including the ones deliberately left out of the tool list — an allowlist a subprocess can walk around is not
an allowlist. The second version removed that key and the git token and passed everything else, which is a
denylist, and a denylist can only exclude what somebody thought of. It was caught by setting
`ANTHROPIC_API_KEY` to a deliberately invalid value and watching a live run succeed anyway, authenticated by
host credentials nobody had passed it. On a developer's machine the same gap covers cloud tokens, registry
tokens, and the credentials of whatever editor started the process.

**The credential is narrow and the supervisor holds it.** The git token is scoped to one repository and needs
only to push a branch and open a pull request. The runtime clones and pushes; the session is refused
`git push`, `git remote`, `git config` and `gh`, and the token travels as a header git does not persist, so
it is not in the working directory the session can read.

**A Gate is the last line.** An Agent can never approve one (ADR-0004), and neither can anything holding a
delegated credential (ADR-0010). Nothing an agent proposes ships without a Human deciding it did. This is the
bound that does not depend on getting any of the others exactly right.

## What is not bounded

A session with a shell runs whatever that repository's own build runs, reaches the network, and spends
tokens. A repository whose test suite is hostile is hostile when an agent runs it, and it would be when a
person did. The advice in OPERATIONS.md is the honest one: give the runtime a repository you would give a new
contractor, and read the pull requests.

Two things are deliberately not attempted. **Egress filtering**, because a coding agent that cannot reach a
package registry cannot build anything, and a filter with the holes that require is a claim rather than a
control. And **classifying Issue text as safe or unsafe** before it reaches a session, because it would be
wrong often enough to be trusted and never right enough to be relied on.

## The rule for anything added later

A capability an agent gets must come with the answer to two questions: what stops it reaching further than
intended, and what a Human sees when it tries. The `denied` events the runtime writes into a Run's feed are
the second answer for tools — a refusal is the one thing a model cannot report accurately about itself,
because all it sees is an error.
