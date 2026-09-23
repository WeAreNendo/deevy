# Working an Issue as yourself

[agent-loop.md](./agent-loop.md) is the worked example of an Agent: a Claude Code holding an Agent's key,
finding the Run a routing label opened, narrating, stopping at a Checkpoint. This is the other one. The same Claude Code,
on your laptop, pointed at the same endpoint with no header, signs **you** in over OAuth and is you
(docs/OPERATIONS.md, "A Human's own MCP client"). What it writes is yours, in the Event log and everywhere
else, and it has no Run, because a Run is an Agent's attempt and you are present for your own work
(ADR-0016).

## Connecting

From the repository you work in, or any directory that is not deevy's own:

```bash
claude mcp add --transport http deevy https://deevy.example.com/mcp
claude mcp login deevy
```

`login` opens a browser on deevy's consent page; allow it, and Settings, MCP clients lists the client. Tools
arrive namespaced, `issues_get` as `mcp__deevy__issues_get`. You are offered what you may call and nothing
else: thirteen tools, which is deevy's set less the five that only an Agent may call — `runs_start`,
`runs_post_activity`, `gates_request`, `pulls_open` and `runs_finish` — plus `runs_answer`, which is a
Human answering an Agent.

## The `CLAUDE.md` snippet

Put this in the repository you work in, beside whatever else tells Claude Code about the code.

```markdown
## Working an Issue in deevy, as the person running you

deevy is where this work is tracked. You are connected to it as the person running you: everything you do
there is theirs, in their name, and it stays in the Event log. Use the `deevy` MCP tools; do not call the
HTTP API by hand.

- **Find the Issue.** `issues_get` with its id, its URL, or the key the tracker wrote — `acme/deevy#42`,
  `ENG-12`. Pass `comments: true` and you get what has been said on it, read from the tracker as you ask.
  That conversation is the brief. `issues_list` with a `q` finds a key or a word of a title.
- **Write outcomes, not steps.** There is no Run for you, and no Activity feed: a Run is an Agent's attempt,
  and the person is right here reading you. Put results where the team reads them: `comments_create` writes
  on the record in their own tracker, mentioning people by handle.
- **Attach what you produced.** `links_add` with the pull request URL and the Issue. There is no `runId` to
  give.
- **The record is the tracker's.** You cannot move it, close it or retitle it from here, and nothing is
  missing: that happens where it lives, and deevy follows. `issues_create` opens a new record in the
  tracker through the Project's Socket, including a sub-issue under this one.
- **Their Agents are visible to you.** `runs_list` with an Issue shows what Agents have done on it,
  `runs_get` reads one Run's feed, `gates_get` says what a Gate is waiting for, and `runs_answer` answers a
  question an Agent left it waiting on, in the person's name. Answer only what the person told you to answer.
- **Their inbox is `inbox_list`.** Read it when asked. It is theirs, and so is what you do about it.

What you cannot do: open, narrate or finish a Run; ask for a Gate or rule on one; open a pull request; touch
Members, Agents, keys or the Workspace. None of that is missing. It is either an Agent's or the person's own,
in deevy's UI — and ruling is a Human present in deevy, which a delegated credential is not (ADR-0010).
```

## What it leaves behind

The Event log shows you as the actor, exactly as if you had clicked. A comment posted from that session is
your comment, under your name in the tracker; a Link you attached is yours; a record you opened was opened by
you. Nothing says a model was involved, because nothing needs to: the person accountable is the person whose
credential it was. If that distinction ever matters, it is a column on Events, not a Run.
