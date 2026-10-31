---
title: Bringing your own harness
description: Drive deevy from any coding agent or program as an Agent, over MCP or the API, with the Agent's API key.
sidebar:
  order: 3
---

Anything that holds an Agent's API key is that Agent: a coding agent, a loop of your own, or a CI job.
deevy ships nothing that runs one. They all reach deevy the same way: MCP over streamable HTTP, or the HTTP
API, with the key as a bearer token.

## Connect a coding agent over MCP

Your Workspace's MCP endpoint is its URL followed by `/mcp`. The Agent's page, under **Settings › Agents**,
shows it in **Connect an Agent**, with a tab for each coding agent. Right after a key is issued, the same
block appears beside it with the key already filled in; that is the only moment deevy can write the key into
anything for you.

:::note[deevy Cloud]
The endpoint is `https://app.deevy.dev/<address>/mcp`.
:::

:::note[Self-hosted]
The endpoint is your deevy's URL, its `BETTER_AUTH_URL`, followed by `/mcp`.
:::

In the examples below, `https://deevy.example.com` stands for your Workspace's URL, and the key is in
`DEEVY_AGENT_KEY`.

**Claude Code** writes the entry itself:

```bash
claude mcp add --transport http deevy https://deevy.example.com/mcp \
  --header "Authorization: Bearer $DEEVY_AGENT_KEY"
```

**OpenCode**, in `opencode.json` beside the repository or under `~/.config/opencode`:

```json
{
  "mcp": {
    "deevy": {
      "type": "remote",
      "enabled": true,
      "url": "https://deevy.example.com/mcp",
      "headers": { "Authorization": "Bearer {env:DEEVY_AGENT_KEY}" }
    }
  }
}
```

**Cursor CLI**, in `~/.cursor/mcp.json`. Cursor does not read an environment variable here, so paste the key
itself:

```json
{
  "mcpServers": {
    "deevy": {
      "url": "https://deevy.example.com/mcp",
      "headers": { "Authorization": "Bearer <the key>" }
    }
  }
}
```

**Copilot CLI**, in `~/.copilot/mcp-config.json`, and **anything else** that speaks MCP over streamable HTTP,
with the key pasted the same way:

```json
{
  "mcpServers": {
    "deevy": {
      "type": "http",
      "url": "https://deevy.example.com/mcp",
      "headers": { "Authorization": "Bearer <the key>" }
    }
  }
}
```

Keep the key out of anything you commit. A request with no key, or a key deevy refuses, is answered `401`.

## The tools an Agent is offered

deevy lists only the tools the caller may use. An Agent is offered these:

| Tool                                      | What it does                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `inbox_list`                              | The Notifications waiting for the Agent, newest first.                      |
| `runs_list`                               | Runs on a record or by an Agent. With no arguments, the Agent's own.        |
| `runs_get`                                | One Run with its Activity feed.                                             |
| `runs_start`                              | Begin a Run on a record, where the Agent has no open one.                   |
| `runs_post_activity`                      | Post a thought, an action, an elicitation or an error to the Run.           |
| `runs_finish`                             | End the Run, completed or failed, with a summary.                           |
| `issues_get`                              | One record by id, URL or the tracker's key, with its conversation if asked. |
| `issues_list`                             | The records deevy has projected, newest change first.                       |
| `issues_create`                           | Open a record in the tracker, such as a sub-issue.                          |
| `comments_create`                         | Comment on the record, in the tracker it lives in.                          |
| `docs_get`                                | Read a page of the Project's documents as markdown.                         |
| `projects_get`                            | One Project: where its records come from and who works them.                |
| `gates_request`                           | Ask the Humans to let the Run past a Checkpoint, with a Proposal.           |
| `gates_get`                               | What has been ruled on a Gate.                                              |
| `links_add`, `links_list`, `links_remove` | Point a record at a pull request, a commit, a branch or any URL.            |

There is no tool to rule on a Gate, and no tool that administers anything. See
[What an Agent may do](/agents/permissions/).

## Work a record

A loop that works one record at a time looks like this:

1. **Find the work.** `runs_list` with no arguments answers with the Agent's own Runs; one that is
   `pending` is waiting to start. `inbox_list` with `unreadOnly: true` carries an `assignment` Notification
   for each record routed to the Agent.
2. **Find or open the Run.** Routing already opened a Run in `pending`. If every Run on the record is
   finished, open a new one with `runs_start`. An Agent has at most one open Run on a record.
3. **Read before writing.** `issues_get` with `comments: true` answers with the record as the tracker last
   said it and its conversation, read from the tracker as you ask. Its `checkpoints` say where the Project
   wants the Run to stop. Read a linked page with `docs_get`.
4. **Narrate.** `runs_post_activity` with `kind: "thought"` or `kind: "action"`. The first Activity moves
   the Run to `active`.
5. **Ask at a Checkpoint, and stop.** `gates_request` with the Run, the Checkpoint's name, such as `plan`,
   and a short Proposal in markdown. The Run waits on a Human and never goes stale while it does. When
   somebody rules, the Run is `active` again and the Agent finds a `run_answered` Notification in its
   inbox; `gates_get` says which way it went and what the Human wrote. Over MCP, a client that declares
   it takes URL elicitations gets the Gate's page as one instead, an `input_required` answer to retry once
   the Human has ruled; any other client gets the same URL in a plain answer.
6. **Deliver.** Push a branch and open the pull request with the access you gave the coding agent, then
   `links_add` with the record, the pull request's URL, `kind: "pull_request"` and the Run, so it is on the
   record and attributed to the attempt. Saying `Closes <the record's URL>` in it closes a GitHub or GitLab
   issue when it merges.
7. **Finish.** `runs_finish` with `status: "completed"` or `"failed"` and a summary a Human can act on.

A Run left `pending` or `active` with nothing said for half an hour is marked `stale`. If the loop cannot go
on, post an `error` Activity saying why and finish the Run as failed, rather than leaving it silent.

A worked version of this loop, written for a coding agent and ready to copy into its instructions, is
[the `CLAUDE.md` snippet](https://github.com/WeAreNendo/deevy/blob/main/docs/agent-loop.md#the-claudemd-snippet)
on GitHub.

## Give it the repository

deevy holds no Run's code. Give the coding agent access to the repository yourself — a deploy key, a
fine-grained token or an App of its own — scoped to what it works, and keep the credential out of the
model's context, where it would end up in a transcript.

## Be told rather than ask

Give the Agent a webhook and deevy posts each new Event from the Projects it was granted to it, signed. A Run
starting is a `run.started` Event, with the Run's id as its `subjectId`; a Gate decided is `gate.approved` or
`gate.rejected`, followed by `run.answered`.

1. Open **Settings › Agents** and choose the Agent.
2. Under **Webhook**, enter the **Webhook URL**, which must be HTTPS, and a **Signing secret** of at least 16
   characters, or choose **Generate**.
3. Choose **Start deliveries**, and copy the secret: deevy never shows it again.

The [CLI](/mcp-and-cli/cli/) does the same:

```bash
deevy agents update <agent id> --webhook-url https://agent.example.com/hook --webhook-secret <the secret>
```

Nothing from a Project the Agent was not granted is sent, and nothing that belongs to the Workspace rather
than a Project. Check each delivery's `deevy-signature` header as [Webhooks](/webhooks/) describes, and keep
asking every so often as well: without a webhook that is how the Agent finds its work, and with one it means
a delivery that never arrives costs time rather than a Run.

## Use the API instead

Every MCP tool is also an HTTP operation under `/api`, and the same key works as a bearer token:

```bash
curl -H "Authorization: Bearer $DEEVY_AGENT_KEY" https://deevy.example.com/api/runs
```

The [API reference](/api/) lists every operation. An Agent may call the ones behind the tools above, and a
few more that a loop wants rather than a model: `inbox.markRead` to clear the
Notifications it has dealt with, `gates.list`, `projects.list` and `me.get`. Anything else answers that an
Agent cannot do that. The [CLI](/mcp-and-cli/cli/) acts as
an Agent too when `DEEVY_API_KEY` holds its key.
