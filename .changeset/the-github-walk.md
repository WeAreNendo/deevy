---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/sockets": minor
"@deevy/adapters": patch
"@deevy/web": minor
"@deevy/agent": minor
---

deevy's GitHub setup was walked end to end against github.com, with a real App and Claude Code as the Agent,
and what it found is fixed here.

**Binding a Project to its code.** Bind a Project now binds the repository as the Project's code too when the
tool holds code — GitHub, GitLab — unless you untick **Its code is here too**, and a Project's Binding has a
**Repository** and a **Base branch** to change it or to bind code that lives elsewhere. The base branch
defaults to the repository's own. Before this, a Project bound from the screens had no code and its Agents
could push nothing.

**Connecting a GitHub App.** A GitHub Socket connected through **Create the App on GitHub** can be bound to a
Project (it was stored as able to do nothing), and GitHub sends you straight on to installing the App once it
is made. A GitHub Socket's page says where the App is installed, with a link to install it on more.

**Agents that write code.** The reference runtime gives a session its file and shell tools whenever its Run has
a repository — the one deevy names, not only `DEEVY_AGENT_REPO` — so an Agent can write the change it planned,
and every clone commits as the Agent. Over MCP, the tools that act in a tool — commenting, opening a sub-issue,
opening the pull request, reading a document — work again; they failed on every real Socket.

**Trying again, and approvals that stand.** A failed or stale Run has **Try again** on its page, for the
Agent's Sponsor or an admin (`runs.retry`, trigger `retry`). A Run that asks at a Checkpoint with the same
Proposal an earlier Run on the same record had approved is answered with that approval, while it still meets
the Checkpoint's policy, instead of asking the Humans again. Choosing a Project's Default Agent now also lets
that Agent see the Project.

Also fixed: an archived Project no longer routes records or starts Runs from deliveries; comments deevy writes
in the tracker keep their paragraphs, so the footer no longer folds into the last link and a Ruling's note no
longer swallows the signature; `issues.get` says when it could not read the conversation
(`commentsUnavailable`) rather than returning none; a pull request's footer names the Agent; the app is served
so browsers pick up a new version on their next load; a routed assignment no longer reads "unassigned"; and
several screens show names where they showed ids.
