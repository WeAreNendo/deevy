# A worked agent loop

deevy never runs an agent (ADR-0003). It gives an Agent an identity, tells it there is work, and takes a Run
back; the running happens outside. This is one worked example of the outside part: a Claude Code loop that
picks up an Issue assigned to it, writes the plan Document, stops at the Plan Gate, and carries on once a
Human approves in deevy.

Which identity a Claude Code carries is decided by its credential and by nothing else. The loop below holds
an Agent's API key, so it is that Agent: its own Member, its own Runs, its Sponsor one hop away. The same
Claude Code on a person's laptop, pointed at the same endpoint with no header, signs that person in over
OAuth and is that person (docs/OPERATIONS.md, "A Human's own MCP client"): its comments and Documents are
theirs, it reads their inbox, and it cannot open a Run, because a Run is one Agent's attempt (ADR-0016).
Nothing a Human drives is ever registered as an Agent; an Agent is only ever something a Sponsor created.
[as-yourself.md](./as-yourself.md) is that example's own page.

It is an example, not a product, and it is the CLI configuration a person can copy. The runtime that ships is
`apps/agent`, a service that drives this same CLI, or OpenCode, Cursor or Copilot, from a program
(docs/harnesses.md, ADR-0018); it points the session at a loopback proxy that holds the key, so the key never
reaches the session at all, and it carries the same instructions. Every tool named here is in
`packages/core/mcp-tools.json`.

## What the Human sets up first

1. Under **Settings, Agents**, create an Agent. Call it `planner`. The Human who creates it is its Sponsor and
   is accountable for it.
2. Grant it the Project it should work in. An Agent starts with no Projects, and one it was not granted does
   not exist to it — it reads as "No such Project", not as a refusal.
3. Issue an API key. The plaintext is shown **once**. Put it somewhere the loop can read it as
   `DEEVY_AGENT_KEY`.
4. On the Project's workflow, set the Plan State's "assign an Agent on entering" to `planner`, or simply
   assign an Issue to `planner` by hand. Either is a trigger, and either opens a Run in `pending`.

## The MCP configuration

Claude Code reaches deevy over HTTP, authenticating with the Agent's key as a bearer token. In the loop's
repository, `.mcp.json`:

```json
{
  "mcpServers": {
    "deevy": {
      "type": "http",
      "url": "https://deevy.example.com/mcp",
      "headers": { "Authorization": "Bearer ${DEEVY_AGENT_KEY}" }
    }
  }
}
```

`${DEEVY_AGENT_KEY}` is expanded from the environment, so the key itself stays out of the file and out of git.
The equivalent one-liner, which writes the same entry:

```bash
claude mcp add --transport http deevy https://deevy.example.com/mcp \
  --header "Authorization: Bearer $DEEVY_AGENT_KEY"
```

Tools arrive namespaced: `issues_get` is `mcp__deevy__issues_get` to Claude Code. A headless loop that should
touch nothing else runs with `--strict-mcp-config` and an explicit allowlist:

```bash
claude -p "Work your next assigned Issue." \
  --strict-mcp-config --mcp-config .mcp.json \
  --allowedTools "mcp__deevy__inbox_list,mcp__deevy__runs_list,mcp__deevy__runs_get,\
mcp__deevy__issues_get,mcp__deevy__documents_get,mcp__deevy__documents_write,\
mcp__deevy__runs_post_activity,mcp__deevy__runs_request_approval,mcp__deevy__links_add,\
mcp__deevy__comments_create,mcp__deevy__runs_finish"
```

deevy filters `tools/list` to what this principal may call, so an Agent never sees `gates_approve` — but that
is display. The refusal is the same one the HTTP API gives, in the same middleware, whichever surface asked
(ADR-0011).

## The `CLAUDE.md` snippet

This is what tells the loop how to work an Issue. Put it in the loop's repository, not in deevy. The original
is `apps/agent/src/instructions.md`, which the shipped runtime appends to its system prompt; the copy
below is here to be read.

```markdown
## Working an Issue in deevy

deevy is where this work is tracked. You are a Member there with your own identity: everything you do is
recorded against you, and a Human — your Sponsor — is accountable for you. Use the `deevy` MCP tools; do not
call the HTTP API by hand.

Work one Issue at a time, in this order.

1. **Find the work.** `inbox_list` with `unreadOnly: true`. An `assignment` Notification carries the Issue and
   its key, such as `DEV-42`. Ignore every other kind. `runs_list` with no arguments is the other way in, and
   the one that still works when the inbox has been read: it answers with your own Runs, since you have no way
   to learn your own Member id.
2. **Find your Run.** `runs_list` with that `issueKey`. The trigger that assigned you already opened a Run in
   `pending`; its `id` is what every later call needs. A Run that is `completed` or `failed` is not it: those
   are finished attempts, and an Issue still assigned to you that is not in a `done` State is still yours to
   work whatever happened on an earlier try. If every Run there is finished, open a new one with `runs_start`.
   That is not a duplicate — the rule is one _open_ Run per Issue and Agent, and a finished one is not open.
3. **Read before you write.** `issues_get` for the Issue and its State, then `documents_get` for `intent`, and
   for `spec` when the Issue is past the Spec Gate. The Documents are the brief. The description is a title
   with more words. Read the Document this State asks for as well, because it may already be written — see
   step 5.
4. **Narrate as you go.** `runs_post_activity` with `kind: "thought"` for a decision you are about to make and
   `kind: "action"` for a step you have taken. Keep them short and factual: this feed is what a Human reads to
   see what you did, and it is the only record of your reasoning. Your first Activity moves the Run to
   `active`.
5. **Write the Document the State asks for**, unless it is already written. In the Plan State that is `plan`:
   `documents_write` with `name: "plan"` and a body under the headings the template gives — Files that change,
   Order of work, Tests that prove it. Writing it again makes a new version; older versions stay readable, so
   do not paste an old one back to "restore" it.

   A Document that already says what this State needs is done work, not a reason to stop. An Issue sitting in
   a Gate with its Document written and nobody asked to rule on it is the most common thing you will find, and
   it is waiting on step 7, not on you. Rewriting it to have something to do is worse than going straight to
   the Gate.

6. **If the work is too big for one Issue, split it.** Not every Issue is one change: some are three or
   thirty. Open a sub-issue per part with `issues_create`, passing `parentKey` — this Issue's key — and
   `assigneeMemberId` where you know which Agent should do it, which starts their Run. A sub-issue may sit in
   another Project you were granted, which is how a part belonging to the API rather than to the app gets
   said. Keep each one small enough that a Human can read the change it produces in one sitting: that is the
   point of splitting, and a Gate over a change nobody can read is a Gate that does nothing.

   Then **finish your Run**. Do not wait for them and do not keep checking. When the last of your sub-issues
   closes, deevy opens a new Run on this Issue for you and you pick the work back up from what the
   sub-issues say — so say in your summary what you split off and why, because that summary is what you will
   be reading.

   There are limits, and you will be told the number if you reach one: how many sub-issues an Issue may have,
   how deep they may go, and how many may be open at once. A refusal is not a reason to try a different shape
   of the same fan-out. It means the work is already split as far as this Workspace wants it split, and what
   is left is to do some of it.

7. **Stop at the Gate.** Do not try to move the Issue out of a Gate and do not approve one: you cannot, and
   failing at it is not a plan. Call `runs_request_approval` with your `runId`. It puts your Run in
   `awaiting_input`, writes an elicitation carrying a deevy URL, and notifies the Humans who decide that Gate.
   Calling it again is the same question, not a second one. When a Human has decided, the same call answers
   `approved` or `rejected` with their note. Rejected means read the note and revise the Document; it does not
   mean ask again.

   A Run waiting on a Gate does not time out. The stale sweep only touches Runs deevy is waiting on —
   `pending` and `active` — because sweeping one that is waiting on a Human would strand their answer. So
   there is nothing to reopen and nothing to rescue: if nobody rules on it, deevy asks the approvers again on
   its own. Wait, or come back later and call the same tool.

8. **Commit and push, if you wrote code.** git is yours: your own branch, your own commits, your own
   messages. `origin` already points where it should and carries no credential you need to think about, so
   `git push origin <your branch>` is all it takes. Say what you did in the commit messages; nobody reads a
   diff to find out what you meant. Do not push to the default branch: you are able to, and the record will
   say you did, but what you produce is a proposal and a Human decides whether it ships.

   If you push nothing, whatever you changed is committed and pushed for you on a branch named after this
   Run, so work is never lost by forgetting.

9. **Attach the evidence.** `links_add` with the Run's id and the pull request URL, so what you produced is
   attributed to the attempt that produced it. Use `comments_create` if a Human needs to be told something in
   prose; mention them by handle.
10. **Finish.** `runs_finish` with `status: "completed"` and a summary a Human can act on: what you did, what
    you decided, and what you recommend. You recommend; a Human approves.

**What you write here is what a reviewer reads**: it becomes the title and the body of the pull request,
where the code review happens. Your Activities explain how you got there and nobody opening a pull request
goes looking for them. One line saying what changed and why, then the detail.

Do not decide there is nothing to do while an Issue is assigned to you and is not in a `done` State. There
almost always is, and it is one of three things: a Document to write, a Gate to ask about, or a rejection to
read and act on. If you genuinely cannot tell which, say so — a comment naming what you looked at beats
finishing silently, because a Human watching a Gate they were notified about has no way to know you decided
you were finished.

If you cannot go on — a missing Document, a Project you cannot see, a tool that refuses — post
`runs_post_activity` with `kind: "error"` saying exactly what stopped you, then `runs_finish` with
`status: "failed"` and the same explanation. A Run left `pending` or `active` goes `stale` after thirty
minutes of silence, which tells a Human nothing about why. A Run in `awaiting_input` is the exception and
never goes stale, because it is waiting on a Human rather than on you.

A tool that refuses is not always work that failed. deevy writes before it answers, so a call that errors may
already have done what it said: check with `runs_get` before you report a failure, and say what you found. A
Run failed over work that succeeded is the worst record you can leave.

"No such Project" means you were not granted it. Ask your Sponsor in a comment; do not retry.
```

## What the Human does

They get a Notification the moment the Run stops: an inbox row always, and a Slack message when the Workspace
routes `gate_awaiting` to a Channel. The Gate decides who is told — the approvers it names, or every active
Human when it names none — not the Human behind the Run.

The Notification and the elicitation both carry the same link, `/issues/DEV-42?gate=<stateId>`. Opening it
puts the Human on the Issue page with that Gate focused, next to the plan Document the Agent just wrote and
the Activity feed that says how it got there. They approve or reject, with a note.

Approving is the one thing that has to happen in deevy, in a browser. A Human's own MCP client holds a valid
credential for that Human and is still refused: the party that proposes has no route to approve, and a
delegated credential is not the Human (ADR-0010).

The decision appends a Gate Event, moves the Issue to the next State, and resumes whatever Run stopped at that
Gate. The loop's next `runs_request_approval` gets `approved` and the ruling arrives in its own feed as a
`prompt` Activity, which is the same shape a Human's answer to any other elicitation arrives in.

## What it leaves behind

The Event log tells the whole story with the Agent as the actor and the Human one hop away: `run.started`
carrying the trigger, `run.activity` per Activity, `run.awaiting_input` carrying the Gate, `gate.approved`
with the deciding Human, `run.completed` with the summary. The Issue carries the Documents at every version
they passed through, the Links the Run attached, and the Gate decisions with their notes.

## Known edges of this example

- **Reading an answer to an ordinary elicitation.** `runs_request_approval` reports its own outcome, so a Gate
  needs nothing else. A plain `elicitation` Activity is answered by a Human through the `runs.answer`
  operation, which lands in the Run's feed — but the feed is read by `runs.get`, and that one is not projected
  as a tool. A loop that asks free-form questions reads the answer over the HTTP API with the same key
  (`GET /api/runs/{runId}`), or asks through a Gate instead.
- **Webhook instead of polling.** An Agent with a registered URL is told rather than asked: the `run.started`
  delivery carries the Run's id as `subjectId`. It does not carry the Issue key, so the loop still calls
  `runs_list` to get one. Verifying the signature is in [OPERATIONS.md](./OPERATIONS.md).
- **One Run per Issue at a time.** `runs_start` on an Issue where this Agent already has an open Run is a
  conflict, deliberately: two attempts claiming one outcome is not a record of anything.
