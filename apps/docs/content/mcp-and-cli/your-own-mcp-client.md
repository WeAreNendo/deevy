---
title: Your own MCP client
description: Connect Claude Code, Cursor or VS Code to your Workspace over MCP and work as yourself, signed in through your browser with no key.
sidebar:
  order: 1
---

You can point your own coding agent at your Workspace and work as yourself: read a record and its
conversation, comment on it, open a sub-issue, see what Agents did and answer one that asked you something.
It needs no key. Your client signs you in through your browser, you approve it once, and from then on what it
does is yours, in your name.

This is different from an Agent. The same Claude Code is an Agent when it holds an Agent's key, and is you
when it holds none: the credential decides who is acting, never the software. Nothing you connect this way is
ever registered as an Agent. To connect an Agent instead, see
[Bringing your own harness](/agents/your-own-harness/).

## Find your Workspace's endpoint

Go to **Settings › MCP clients**. **Connect your MCP client** shows the endpoint: your Workspace's URL
followed by `/mcp`.

:::note[deevy Cloud]
Your endpoint is `https://app.deevy.dev/<address>/mcp`, such as `https://app.deevy.dev/acme/mcp`.
:::

:::note[Self-hosted]
Your endpoint is your deevy's URL followed by `/mcp`. deevy signs MCP clients in only when its
`BETTER_AUTH_URL` is set; without it, everything else works and a Human's own MCP client is refused. See
[Configuration](/self-hosting/configuration/).
:::

## Claude Code

1. Add the server, with your endpoint:

   ```bash
   claude mcp add --transport http deevy https://app.deevy.dev/acme/mcp
   ```

2. Sign in:

   ```bash
   claude mcp login deevy
   ```

   You can also sign in from the `/mcp` menu of an interactive Claude Code session. `claude mcp add` only
   records the server; signing in is what connects it.

3. Your browser opens on deevy. Sign in if you are not already, and approve the client.

Run these from the repository you work in, or anywhere else. The tools arrive named for the server:
`issues_get` is `mcp__deevy__issues_get` to Claude Code.

## Cursor

Add the server to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` in one repository:

```json
{
  "mcpServers": {
    "deevy": {
      "url": "https://app.deevy.dev/acme/mcp"
    }
  }
}
```

When Cursor connects, it sends you to deevy in your browser to sign in and approve it.

## VS Code

Add the server to `.vscode/mcp.json` in the repository:

```json
{
  "servers": {
    "deevy": {
      "type": "http",
      "url": "https://app.deevy.dev/acme/mcp"
    }
  }
}
```

Start the server from VS Code, and it sends you to deevy in your browser to sign in and approve it.

Any other client that speaks MCP over streamable HTTP and signs in with OAuth connects the same way: give it
the endpoint and no header. It discovers how to sign in from deevy's first answer.

## Approve the client

deevy asks in your browser whether to let the client act as you, naming it the way it names itself:
**Let deevy CLI act as you?**, for the CLI. It says what that means: the client works as you, with the same Projects and Issues you can see, and it can never rule
on a Gate for you. Choose **Allow**, or **Refuse**.

## What your client can do

You are offered what you may call and nothing else:

| Tool                                      | What it does                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `issues_get`                              | One record by id, URL or the tracker's key, such as `ENG-12`, with its conversation if you ask. |
| `issues_list`                             | The records deevy has projected, newest change first, searchable by key or title.               |
| `issues_create`                           | Open a record in the tracker a Project is bound to, such as a sub-issue.                        |
| `comments_create`                         | Comment on the record, in the tracker it lives in.                                              |
| `docs_get`                                | Read a page of a Project's documents as markdown.                                               |
| `projects_get`                            | One Project: where its records come from and who works them.                                    |
| `links_add`, `links_list`, `links_remove` | Point a record at a pull request or any URL.                                                    |
| `runs_list`, `runs_get`                   | What Agents have done on a record, and one Run's feed.                                          |
| `gates_get`                               | What a Gate is waiting for, and what has been ruled.                                            |
| `runs_answer`                             | Answer a question an Agent left its Run waiting on.                                             |
| `inbox_list`                              | Your inbox.                                                                                     |

What it cannot do is deliberate. It cannot open, narrate or finish a Run, ask at a Gate or open a pull
request, because those belong to an Agent's Run and you are here for your own work. It cannot rule on a Gate,
because a Ruling is a Human present in deevy, and a credential you delegated is not that. And it cannot move,
retitle or close a record: that happens in the tracker, and deevy follows.

## What it leaves behind

Everything your client does is recorded as yours, exactly as if you had clicked. A comment it writes appears
in the tracker by deevy's account there, signed with your handle. A Link it adds is yours, and so is a record
it opens. There is no Run, because a Run is an Agent's attempt.

The access your client is given works only at the MCP endpoint, not at the API.

## Revoke a client

**Settings › MCP clients** lists every client you approved, with when. Choose **Revoke** beside one to stop it
asking for anything new. Access it already has keeps working until it expires, usually within the hour.

The [CLI](/mcp-and-cli/cli/) appears in the same list once you have signed in with it, as **deevy CLI**.
