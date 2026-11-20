---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/web": minor
"@deevy/server": minor
"@deevy/hosted": minor
---

An Agent now asks its questions on the record, in your tracker, and a Human answers there. deevy no longer has a way to ask or to answer. `runs.answer` is gone: that was `POST /api/runs/{runId}/answer`, the MCP tool `runs_answer` and `deevy runs answer`, so each route now answers 404 and the tool is unknown. `runs.postActivity` takes `thought`, `action`, `response` or `error`. It refuses `elicitation` and `prompt`, and the refusal names the four kinds. An Agent that needs to know something comments on the record with its own access and asks whoever answers to mention it. The reply that names the Agent lands in its inbox as a `mention`, and on its webhook as a `comment.created` whose `payload.mentionedMemberIds` names it. If the Agent has a Run open on that record, the reply opens no second Run. If it has none, the mention opens one, as before. An Agent's instructions that told it to post an `elicitation` and wait now need to tell it to ask on the record. `docs/agent-loop.md` has the words.

Only a Gate makes a Run wait now. An Activity never moves a Run to `awaiting_input`; only `gates.request` does. A Run with an open question is open but not waiting, so it goes **Gone quiet** after thirty minutes of silence and picks up again with the Agent's next Activity. The `run.awaiting_input` Event now always names its Gate in `gateRequestId`, and no longer carries `activityId`. Over MCP, `gates_request` answers with the Gate request itself, its page in `url`, and never with a URL elicitation or an `input_required` result, whatever the client says it supports.

A Gate's Proposal and its Ruling are no longer written into the Run's Activity feed. They are on the Gate, which the Run's page lists beside the feed. The Agent hears of a Ruling through `run_answered` in its inbox and reads it with `gates_get`, as before. The line that says a Checkpoint was passed on an approval already given stays.

The **Run awaiting input** Notification is gone: from the Inbox, from **Settings › Notifications**, from Slack and email routing, and from the email it sent. Your own email now defaults to **Gate awaiting** alone. **Needs me** no longer has **Runs awaiting your answer**. A waiting Run's badge, and the Runs filter, read **Waiting on a ruling**. The Event log now says which Checkpoint a Run is waiting at, where it used to say only that it was waiting on a Human. When a Ruling reaches the Run, it now says which way it sent it, where it used to say only that the Run was answered.
