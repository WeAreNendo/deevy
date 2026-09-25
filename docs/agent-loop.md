# A worked agent loop

deevy never runs an agent (ADR-0003). It gives an Agent an identity, tells it there is work, and takes a Run
back; the running happens outside. This is one worked example of the outside part: a Claude Code loop that
picks up a record routed to it in the team's own tracker, says what it intends to do, stops at the Gate, and
carries on once a Human rules in deevy.

Which identity a Claude Code carries is decided by its credential and by nothing else. The loop below holds
an Agent's API key, so it is that Agent: its own Member, its own Runs, its Sponsor one hop away. The same
Claude Code on a person's laptop, pointed at the same endpoint with no header, signs that person in over
OAuth and is that person (docs/OPERATIONS.md, "A Human's own MCP client"): what it says on a record is theirs,
it reads their inbox, and it cannot open a Run, because a Run is one Agent's attempt (ADR-0016).
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
4. Bind the Project to the tool the team already keeps its work in, and give it the Checkpoints it wants a
   Human to rule at — `plan`, `ship`, both or neither (Settings, Projects). Then label a record
   `agent:planner` in that tracker, or make `planner` the Project's default Agent so anything unrouted goes
   to it. Either is a trigger, and either opens a Run in `pending`.

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
mcp__deevy__runs_start,mcp__deevy__issues_get,mcp__deevy__docs_get,mcp__deevy__issues_create,\
mcp__deevy__comments_create,mcp__deevy__runs_post_activity,mcp__deevy__gates_request,\
mcp__deevy__gates_get,mcp__deevy__pulls_open,mcp__deevy__links_add,mcp__deevy__runs_finish"
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

An Issue is a record in the team's own tracker — a GitHub issue, a Linear issue, a Notion page — that deevy
projects. Its key is the tracker's (`acme/deevy#42`, `ENG-12`) and its URL is where a Human reads it. You
cannot create one outside a tracker, you cannot move it, and you do not close it: the Humans do that where
they work.

Work one Issue at a time, in this order.

1. **Find the work.** `inbox_list` with `unreadOnly: true`. An `assignment` Notification carries the Issue,
   its key and its URL. Ignore every other kind. `runs_list` with no arguments is the other way in, and the
   one that still works when the inbox has been read: it answers with your own Runs, since you have no way to
   learn your own Member id.
2. **Find your Run.** `runs_list` with that `issue`. The routing that assigned you already opened a Run in
   `pending`; its `id` is what every later call needs. A Run that is `completed` or `failed` is not it: those
   are finished attempts, and an open Issue still routed to you is still yours to work whatever happened on an
   earlier try. If every Run there is finished, open a new one with `runs_start`. That is not a duplicate —
   the rule is one _open_ Run per Issue and Agent, and a finished one is not open.
3. **Read before you write.** `issues_get` with the Issue and `comments: true`, which answers with the record
   as the tracker last said it — title, body, state, labels — and with what has been said on it, live from
   the tracker. That conversation is the brief. Where it links a page the team keeps its plans in — a Notion
   page — read it with `docs_get`, naming your Project by the `project.slug` the record came with and the page
   by its URL; a Project with no documents bound says so, and then the record is all there is. If the record
   does not say enough to act on, say so in a comment and ask. An answer with `commentsUnavailable` means the
   tracker did not answer and the conversation is unread, not empty: ask again once, and if it is still
   unread, say so in an Activity and do not plan as if nobody had said anything.

   The same answer carries `checkpoints`: the names this Project asks a Run to stop at. It is usually `plan`,
   `ship`, both or neither, and it is what decides steps 5 and 10. A Project that asks for none is one where
   you plan, build and finish without stopping.

4. **Narrate as you go.** `runs_post_activity` with `kind: "thought"` for a decision you are about to make and
   `kind: "action"` for a step you have taken. Keep them short and factual: this feed is what a Human reads to
   see what you did, and it is the only record of your reasoning. Your first Activity moves the Run to
   `active`.
5. **Say what you intend to do, and stop.** `gates_request` with your `runId`, `checkpoint: "plan"`, and a
   `proposal` in markdown: what you understand the work to be, what you will change, and how anyone will know
   it worked. Attach `links` to anything worth opening. Keep it short enough to read in a minute — a Human is
   about to decide on it, and a Proposal nobody finishes reading is a Gate that decides nothing.

   Your Run goes to `awaiting_input` and the Humans who rule that Checkpoint are asked. Asking again with the
   same Proposal is the same question, not a second one. Changing the Proposal supersedes it and asks afresh.
   Ask even when an earlier Run on this record had its plan approved: whether that approval still stands is
   deevy's to decide, not yours. When it does, the answer comes back already `approved` — the Checkpoint is
   passed, your Run keeps going, and you carry on to the work without stopping.
   `gates_get` says where it stands and what anyone has said. **Do not rule on it yourself**: you cannot, deevy
   refuses it whoever asks, and failing at it is not a plan.

   A Run waiting on a Gate does not time out. The stale sweep only touches Runs deevy is waiting on —
   `pending` and `active` — because sweeping one that is waiting on a Human would strand their answer. So
   there is nothing to reopen and nothing to rescue: stop, and you will be woken when somebody rules.

   Where `checkpoints` did not list `plan`, skip this: asking anyway stops your Run for a Human who was
   never told they had to rule on anything.

6. **If the work is too big for one Issue, split it.** Not every Issue is one change: some are three or
   thirty. Open a sub-issue per part with `issues_create`, passing `parent` — this Issue's key or URL — and
   `assignAgent` where you know which Agent should do it, which opens their Run. deevy writes the record in
   the tracker, with the routing label the Project names, so the team sees the parts where they see everything
   else. A sub-issue may sit in another Project you were granted, which is how a part belonging to the API
   rather than to the app gets said. Keep each one small enough that a Human can read the change it produces
   in one sitting.

   Then **finish your Run**. Do not wait for them and do not keep checking. When the last of your sub-issues
   closes, deevy opens a new Run on this Issue for you and you pick the work back up from what the
   sub-issues say — so say in your summary what you split off and why, because that summary is what you will
   be reading.

   There are limits, and you will be told the number if you reach one: how many sub-issues an Issue may have,
   how deep they may go, and how many may be open at once. A refusal is not a reason to try a different shape
   of the same fan-out. It means the work is already split as far as this Workspace wants it split, and what
   is left is to do some of it.

7. **On approval, do what you said you would do.** You will be given a fresh session that tells you which way
   it went and what the Human said. Approved means build it. Rejected means read the note and write a new
   Proposal that answers it, then ask again; it does not mean asking the same thing twice.
8. **Commit and push.** git is yours: your own branch, your own commits, your own messages. `origin` already
   points where it should and carries no credential you need to think about, so `git push origin <your
branch>` is all it takes. Say what you did in the commit messages; nobody reads a diff to find out what you
   meant. Do not push to the default branch: you are able to, and the record will say you did, but what you
   produce is a proposal and a Human decides whether it ships.

   If you push nothing, whatever you changed is committed and pushed for you on a branch named after this
   Run, so work is never lost by forgetting.

9. **Open the pull request.** `pulls_open` with your `runId` and a `summary` of what you did. deevy opens it
   through the same tool the code lives in, attaches it to the record, and writes `Closes <the record's URL>`
   into it so merging closes the record where the team reads it. The branch is the one deevy named for this
   Run; pass `head` only if you pushed a different one. A Project with no repository has no pull request to
   open, and deevy will say so.
10. **Ask at the ship Checkpoint, where the Project listed one.** `gates_request` with `checkpoint: "ship"`
    and a Proposal naming what you built and what you want looked at, with the pull request in `links`. Where
    `checkpoints` did not list it, there is nothing to wait for: go on and finish.
11. **Finish.** `runs_finish` with `status: "completed"` and a summary a Human can act on: what you did, what
    you decided, and what you recommend. You recommend; a Human approves. Use `comments_create` if somebody
    needs telling something in prose — it is written on the record in their own tracker, where they will see
    it.

**What you write is what a reviewer reads.** Your `summary` becomes the title and the body of the pull
request, where the code review happens; your Proposal is what a Human rules on. Your Activities explain how
you got there and nobody opening a pull request goes looking for them. One line saying what changed and why,
then the detail.

Do not decide there is nothing to do while an Issue is routed to you and is open. There almost always is, and
it is one of three things: a Proposal to write, a Gate to wait at, or a rejection to read and act on. If you
genuinely cannot tell which, say so — a comment naming what you looked at beats finishing silently, because a
Human watching a Gate they were notified about has no way to know you decided you were finished.

If you cannot go on — a record you cannot read, a Project you cannot see, a tool that refuses — post
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
routes `gate_awaiting` to a Channel. The Checkpoint decides who is told — the approvers it names, or every
active Human when it names none — not the Human behind the Run. And deevy says it again where the team
already reads: a comment on the record in their own tracker, carrying the Proposal, signed with the Agent and
the Run, with the record labelled while it waits.

The Notification, the elicitation and that comment all carry the same link, `/gates/<requestId>`. Opening it
puts the Human on the ruling screen with the Proposal rendered, its links, the arithmetic the Checkpoint
asks for, and the Run's feed beside it. They approve or reject, with a note.

Ruling happens in deevy, in a browser. A Human's own MCP client holds a valid credential for that Human and
is still refused: the party that proposes has no route to approve, and a delegated credential is not the
Human (ADR-0010). A Ruling made in the tracker is coming, and is bounded by what the tracker can vouch for
(ADR-0025).

The decision appends a Gate Event, resumes whatever Run stopped at that Checkpoint, and is said back in the
tracker with the arithmetic. The Agent is told once, through `run_answered` in its inbox; `gates_get` says
which way it went and what the Human wrote.

## What it leaves behind

The Event log tells the whole story with the Agent as the actor and the Human one hop away: `run.started`
carrying the trigger, `run.checkout_issued` saying a credential was minted and never what it was,
`run.activity` per Activity, `gate.requested` carrying the Proposal, `run.awaiting_input`, `gate.approved`
with the deciding Human, `run.pull_request_opened`, `run.completed` with the summary. The record carries the
Links the Run attached and the Gates with their Rulings and notes; what was said about it lives in the
tracker, where the team reads it (ADR-0024).

## Known edges of this example

- **Reading an answer to an ordinary elicitation.** `gates_get` reports a Gate's own outcome, so a Gate needs
  nothing else. A plain `elicitation` Activity is answered by a Human through the `runs.answer` operation,
  which lands in the Run's feed — read with `runs_get`, or over the HTTP API with the same key
  (`GET /api/runs/{runId}`). Asking through a Gate is usually the better shape: it is the thing a Human is
  notified about.
- **Webhook instead of polling.** An Agent with a registered URL is told rather than asked: the `run.started`
  delivery carries the Run's id as `subjectId`. It does not carry the Issue key, so the loop still calls
  `runs_list` to get one. Verifying the signature is in [OPERATIONS.md](./OPERATIONS.md).
- **One Run per Issue at a time.** `runs_start` on an Issue where this Agent already has an open Run is a
  conflict, deliberately: two attempts claiming one outcome is not a record of anything.
