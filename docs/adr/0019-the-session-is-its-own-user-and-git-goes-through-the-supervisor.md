# The session is its own user, and git goes through the supervisor

> Two things below were not quite so. The supervisor did run untrusted code: the clone, `.git` included, is
> the session's, git runs whatever a clone's configuration and hooks name, and the supervisor's own git in it —
> the delivery, and reading what moved — ran as root. It now runs as the session's user, with an environment
> of its own and no credential, the git proxy holding it, and with hooks and the fsmonitor off
> (`apps/agent/src/workspace.ts`). And the remote's refs are read at every push the proxy carries and at the
> delivery too, not only when the Run clones and lets go, because a session finishes its own Run and a
> finished Run takes no more Activities.

[ADR-0014](./0014-an-agents-input-is-untrusted-and-its-tools-are-not.md) says the container is the sandbox
and the environment a session gets is an allowlist. Both were true and neither was enough, because the
session and the supervisor were the same user. This records what that cost, what replaced it, and the
freedom that came with it.

## What was found

A session with a shell reads the supervisor's environment out of `/proc`, and the Agent's API key and the
git token are in it. The allowlist decides what is _handed_ to a session; on one user it decides nothing
about what can be _taken_. Proved in the shipped image, before the change:

```
uid 10001; grep -c DEEVY_AGENT_KEY /proc/1/environ → 1
```

The loopback MCP proxy ([ADR-0018](./0018-a-harness-is-a-cli-behind-the-session-seam.md)) had removed the
key from the session's configuration and from its arguments. It could not remove it from the supervisor's
own process, which was one `cat` away the whole time.

## The decision

**The session is a different user.** The image has two: the supervisor as root, so it can spawn each session
as `session`, uid 10002. The working directory and the session's home are handed to that user after the
recipe has written its configuration and before the CLI starts. Root here is root in a container that needs
four capabilities, and which four was measured rather than reasoned: `SETUID` and `SETGID` to become the
session, `CHOWN` to hand it its working directory, and `DAC_OVERRIDE` to read and remove what it wrote. The
first pass documented two, and a probe in the image showed that a Run would have failed at its first chown —
which is why the container smoke now does the whole thing rather than only the `/proc` half. A runtime that is
not root — a laptop, or a container run with `--user` — keeps its old shape and prints a line saying the
session shares its user, because a bound that quietly is not there is worse than one that is not claimed.

**git reaches the world through the supervisor.** `origin` in the clone is a loopback URL. The supervisor
forwards to the real remote and adds the credential; the session holds nothing, and its `.git/config` has
nothing to find. A repository on disk is served by `git http-backend`, git's own CGI, so a remote on the
internet and the acceptance walk's bare repository reach the session as the same protocol.

**A credential helper is not this, and was rejected.** A helper hands git the token, so anything that can run
git can run the helper and print it. It moves the token out of a file, not out of the session. A proxy has
none to hand over.

**An Agent pushes what it wants, where it wants.** The four harnesses no longer deny `git push`,
`git remote`, `git config` or `gh`. An Agent branches, commits with its own messages, and pushes — including
to the base branch, including a force-push.

**And every ref it moves is an Activity.** The remote's refs are read when the Run clones and again when it
lets go; each one that changed becomes a sentence in the Run's feed naming the ref, the commit it came from,
the commit it points at, and whether the old commit is still in the new one's history. That is what replaces
the prohibition, and it is ADR-0014's second question answered: what a Human sees when an agent reaches
further than intended.

## Why freedom rather than a denylist

The denylist was ours, enforced by us, in the process we also ask to be careful. What actually decides where
an Agent can push is the scope of the token the operator issued and the branch protection the forge enforces
— both enforced by somebody other than the runtime, and neither bypassable by a session that finds a way
around a pattern in a permission file. Preferring them is preferring the control that holds.

It also made the runtime honest about what it was doing. The denylist read as though the base branch were
protected. It was not: the token was what stopped a push, and the recipe's list was a second fence in front
of a gate that was already the only one.

## What it costs, stated rather than mitigated

**An Agent can move the base branch, and no Gate stands in the way.** A Gate governs the State an Issue is
in ([ADR-0004](./0004-agents-never-approve-gates.md)); it says nothing about refs. An Agent that force-pushes
`main` has not shipped anything deevy tracks and has still rewritten the repository. The Run's feed says so,
after the fact. Nothing prevents it, and the way to prevent it is a protected branch and a token that cannot
push to it. OPERATIONS.md says this beside the token, in bold, because an operator who reads one line should
read that one.

**The supervisor is root in its container.** A bug in it is a root bug in a container with two capabilities.
The supervisor runs no untrusted code — it parses JSON lines and spawns one process — so the exposure is a
parser, and the trade buys the boundary everything else here depends on.

**Non-fast-forward detection is best-effort.** `merge-base --is-ancestor` needs both commits, and the clone
is shallow. A ref somebody else moved while the Run was working can leave the old commit unfetchable, which
is reported as a rewrite. Erring that way is deliberate: a Human told to look at something fine costs a
minute, and the other mistake costs the work.

## What it does not change

deevy still never runs agents (ADR-0003), and the runtime still takes no dependency and imports nothing from
`packages/core`. An Agent still cannot approve a Gate (ADR-0004), and a delegated credential still cannot
(ADR-0010). The deevy-tool allowlist is still enforced at the MCP proxy, so what a session may call in deevy
is unchanged by any of this: the freedom is git's, and git is not deevy.
