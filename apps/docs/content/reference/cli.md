---
title: CLI reference
description: Every command and flag of deevy's command-line tool, who may run each, and the environment it reads.
sidebar:
  order: 2
---

`deevy` is deevy from a terminal. Almost every command is made from one of deevy's own API operations, so
the CLI does exactly what the API does, as whoever it is signed in as. For a guided start, see
[The CLI](/mcp-and-cli/cli/).

```bash
npm install -g @deevy/cli      # Node.js 22.18 or later
deevy <group> <command> [arguments] [flags]
```

`deevy --help` lists the groups, `deevy <group> --help` the commands in one, and
`deevy <group> <command> --help` a command's arguments and flags. `deevy --version` prints the version, which is deevy's own.

## Which deevy it talks to

- `login`, `logout`, `whoami`, `gates open` and `events watch` take the Workspace's URL as an optional last
  argument.
- Every other command takes `--deevy-url <url>`.
- Either way, left out, it is `DEEVY_URL`.

A URL may include a path, as a Workspace on deevy Cloud does: `https://app.deevy.dev/acme`. A bare host is
given `https://`, except `localhost`, `127.0.0.1` and `[::1]`, which are given `http://`.

## Who it acts as

- **A Human**, with the token `deevy login` stored for that Workspace.
- **An Agent**, when `DEEVY_API_KEY` holds the Agent's key. The key wins over a stored token, and
  `deevy whoami` says which of the two answered.

The CLI refuses, before it asks deevy, a command the credential can never run: an Agent's command with a
Human's token, a Human's command with an Agent's key, and anything marked **Not from the CLI** below.

## Environment

| Variable          | What it does                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `DEEVY_URL`       | The Workspace every command talks to, path included, when none is named.                      |
| `DEEVY_API_KEY`   | An Agent's API key. The CLI acts as that Agent.                                               |
| `DEEVY_WEB_URL`   | Where deevy's web app is, when that is not where its API is. Only `deevy gates open` uses it. |
| `XDG_CONFIG_HOME` | Where tokens are kept, under `deevy/`. Defaults to `~/.config`.                               |
| `NO_COLOR`        | Turns colour off. Colour is off for a pipe either way.                                        |

A token is kept in one file per Workspace, readable only by you: `~/.config/deevy/https_app.deevy.dev%2Facme.json`
for `https://app.deevy.dev/acme`, `~/.config/deevy/https_deevy.example.com.json` for a deevy at the root of
its host. Signing in to a second Workspace leaves the first signed in.

## Arguments and flags

- **Arguments** in `<angle brackets>` are required and in `[square brackets]` optional. Most are ids, which
  look like `mem_k3xr8v2m9qpw`; an `<issue>` also takes the record's URL or the tracker's key, such as
  `ENG-12` or `acme/web#42`.
- **Every command made from an operation** also takes `--deevy-url <url>` and `--json`.
- **A flag with no value shown** is a switch: give it alone for true, or follow it with `true` or `false`.
- **A repeatable flag** is given once per value: `--ids ntf_k3xr8v2m9qpw --ids ntf_9pd2w7c1xm4r`.
- **A `<json>` flag** takes JSON text: `--routing '{"labelPrefix":"agent:","mention":true}'`.
- **deevy checks the values**, and a refusal names the flag it is about.

A list prints as a table and a single thing as its fields. `--json` prints deevy's exact answer, for a
script.

The CLI exits with status 1 and a sentence when a command fails, and with 130 when `deevy events watch` is
stopped with Ctrl-C.

A CLI newer than the Workspace it is pointed at asks the Workspace which operations it has, and names a
command the Workspace does not have rather than failing at it.

## Who may run what

| In the **Who** column | Means                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------- |
| Anyone                | The command is about signing in, so it runs with no sign-in.                          |
| Signed in             | Any credential, from `deevy login` or `DEEVY_API_KEY`. The server checks no more.     |
| Humans                | A Human Member, signed in with `deevy login`. An Agent's key is refused.              |
| Humans and Agents     | A Human Member, or an Agent with `DEEVY_API_KEY`, within the Projects it was granted. |
| Agents only           | An Agent with `DEEVY_API_KEY`. These are the writing side of a Run.                   |
| Admins                | A Human who is an admin of the Workspace.                                             |
| A signed-in Human     | Somebody signed in to deevy, a Member or not yet.                                     |
| Not from the CLI      | Only a Human in deevy's own pages, in a browser. The CLI says why and stops.          |

Within those, deevy may refuse more: an Agent's keys, grants and schedule are its Sponsor's or an admin's to
change, for instance.

## Signing in

| Command              | What it does                                          | Flags          | Who    |
| -------------------- | ----------------------------------------------------- | -------------- | ------ |
| `deevy login [url]`  | Sign in as yourself, through a browser                | `--no-browser` | Anyone |
| `deevy logout [url]` | Forget the token stored for an instance               | —              | Anyone |
| `deevy whoami [url]` | Say who this terminal is, and how it is authenticated | `--json`       | Anyone |

## Commands by group

Each description is the one the command's `--help` prints. Under `agents`, `<memberId>` is the Agent's id,
which is in the address of its page under **Settings › Agents**. The `stub` tool under `sockets` is a stand-in
for trying deevy without a real tool, and only a deevy started for development offers it.

### agents

| Command                                             | What it does                                                           | Flags                                                                                                                                | Who    |
| --------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `deevy agents create`                               | Sponsor a new Agent; the Human who creates it is accountable for it    | `--name <string>` (required)<br>`--handle <string>`                                                                                  | Humans |
| `deevy agents grants add <memberId>`                | Let an Agent see a Project                                             | `--project-id <string>` (required)                                                                                                   | Humans |
| `deevy agents grants list <memberId>`               | The Projects an Agent may see                                          | —                                                                                                                                    | Humans |
| `deevy agents grants remove <memberId> <projectId>` | Take a Project back from an Agent                                      | —                                                                                                                                    | Humans |
| `deevy agents keys issue <memberId>`                | Mint an API key for an Agent; the plaintext is shown exactly once      | `--name <string>` (required)<br>`--expires-in-days <number>`                                                                         | Humans |
| `deevy agents keys list <memberId>`                 | The API keys an Agent holds, without any plaintext                     | —                                                                                                                                    | Humans |
| `deevy agents keys revoke <memberId> <keyId>`       | Retire one of an Agent's API keys                                      | —                                                                                                                                    | Humans |
| `deevy agents list`                                 | Every Agent in this Workspace, with its Sponsor and its Project grants | —                                                                                                                                    | Humans |
| `deevy agents reinstate <memberId>`                 | Let a suspended Agent work again                                       | —                                                                                                                                    | Humans |
| `deevy agents set-sponsor <memberId>`               | Hand accountability for an Agent to another Human                      | `--sponsor-member-id <string>` (required)                                                                                            | Admins |
| `deevy agents suspend <memberId>`                   | Stop an Agent without deleting its trail                               | —                                                                                                                                    | Humans |
| `deevy agents update <memberId>`                    | Change an Agent's name, handle, delivery URL, or schedule              | `--name <string>`<br>`--handle <string>`<br>`--webhook-url <string>`<br>`--webhook-secret <string>`<br>`--schedule-minutes <number>` | Humans |

### allowlist

| Command                           | What it does                                                                          | Flags                                                                                             | Who    |
| --------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| `deevy allowlist add`             | Admit every sign-in matching an email domain, a GitHub organization or a GitLab group | `--kind <email_domain \| github_org \| gitlab_group>` (required)<br>`--value <string>` (required) | Admins |
| `deevy allowlist list`            | The rules that admit a sign-in to this Workspace                                      | —                                                                                                 | Admins |
| `deevy allowlist remove <ruleId>` | Stop admitting sign-ins that only this rule matched                                   | —                                                                                                 | Admins |

### channels

| Command                             | What it does                                                      | Flags                                                                                                     | Who    |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| `deevy channels create`             | Add a Slack incoming webhook as a Channel                         | `--name <string>` (required)<br>`--webhook-url <string>` (required)                                       | Admins |
| `deevy channels create-email`       | Add a team email address as a Channel, and mail it a confirmation | `--name <string>` (required)<br>`--address <string>` (required)                                           | Admins |
| `deevy channels create-in-socket`   | Add a room in a connected Slack app as a Channel                  | `--name <string>` (required)<br>`--socket-id <string>` (required)<br>`--conversation <string>` (required) | Admins |
| `deevy channels delete <channelId>` | Remove a Channel; the routing rules aimed at it go with it        | —                                                                                                         | Admins |
| `deevy channels list`               | The Channels this Workspace delivers Notifications to             | —                                                                                                         | Admins |
| `deevy channels test <channelId>`   | Post a message to this Channel now, to prove it works             | —                                                                                                         | Admins |
| `deevy channels update <channelId>` | Rename a Channel, or point it at a new webhook                    | `--name <string>`<br>`--webhook-url <string>`                                                             | Admins |

### checkpoints

| Command                                | What it does                                                               | Flags                                         | Who    |
| -------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------- | ------ |
| `deevy checkpoints list <projectSlug>` | What a Project asks of a Run before it goes past each Checkpoint           | —                                             | Humans |
| `deevy checkpoints set <projectSlug>`  | Set what a Project asks at each Checkpoint, replacing what it asked before | `--checkpoints <json>`, repeatable (required) | Admins |

### comments

| Command                         | What it does                                           | Flags                        | Who               |
| ------------------------------- | ------------------------------------------------------ | ---------------------------- | ----------------- |
| `deevy comments create <issue>` | Say something on the record in the tracker it lives in | `--body <string>` (required) | Humans and Agents |

### docs

| Command                    | What it does                                                      | Flags                        | Who               |
| -------------------------- | ----------------------------------------------------------------- | ---------------------------- | ----------------- |
| `deevy docs get <project>` | Read a page from where this Project's documents live, as markdown | `--page <string>` (required) | Humans and Agents |

### email

| Command                 | What it does                                                         | Flags                                                                                                                                                                                               | Who              |
| ----------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `deevy email clear`     | Forget the email sender set here, so the environment's is used again | —                                                                                                                                                                                                   | Not from the CLI |
| `deevy email configure` | Set the email sender, over the environment's                         | `--sender <cloudflare \| resend \| postmark \| sendgrid \| mailgun \| ses \| smtp>` (required)<br>`--from <string>` (required)<br>`--config <json>` (required)<br>`--credentials <json>` (required) | Not from the CLI |
| `deevy email status`    | The email sender this Workspace sends through, and where it was set  | —                                                                                                                                                                                                   | Not from the CLI |
| `deevy email test`      | Send a test email to yourself through the sender in force            | —                                                                                                                                                                                                   | Not from the CLI |

### events

| Command                    | What it does                                                                | Flags                                                                                                                                                                                                     | Who    |
| -------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `deevy events list`        | Events in this Workspace from a cursor, oldest first unless asked otherwise | `--after <number>`<br>`--before <number>`<br>`--order <asc \| desc>`<br>`--kind-prefix <string>`<br>`--subject-type <string>`<br>`--subject-id <string>`<br>`--project-id <string>`<br>`--limit <number>` | Humans |
| `deevy events watch [url]` | Follow the Event log as it happens                                          | `--after <seq>`<br>`--project-id <id>`<br>`--json`                                                                                                                                                        | Humans |

### gates

| Command                           | What it does                                                                 | Flags                                                                                                                                                                  | Who               |
| --------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `deevy gates approve <requestId>` | Let this Run past the Checkpoint it stopped at                               | `--note <string>`                                                                                                                                                      | Not from the CLI  |
| `deevy gates get <requestId>`     | What has been ruled on a Gate, for an Agent waiting or a Human reading       | —                                                                                                                                                                      | Humans and Agents |
| `deevy gates list`                | Gates in this Workspace: open ones, or the ones waiting on you               | `--mine`<br>`--run-id <string>`<br>`--issue-id <string>`<br>`--status <open \| approved \| rejected \| superseded>`<br>`--project-slug <string>`<br>`--limit <number>` | Humans and Agents |
| `deevy gates open <gate> [url]`   | Open a Gate's ruling screen in a browser                                     | `--no-browser`                                                                                                                                                         | Humans and Agents |
| `deevy gates reject <requestId>`  | Send this Run back from the Checkpoint it stopped at, with what to change    | `--note <string>`                                                                                                                                                      | Not from the CLI  |
| `deevy gates request <runId>`     | Ask the Humans to let this Run past a Checkpoint, with what you intend to do | `--checkpoint <string>` (required)<br>`--proposal <string>` (required)<br>`--links <json>`, repeatable                                                                 | Agents only       |

### health

| Command             | What it does   | Flags | Who       |
| ------------------- | -------------- | ----- | --------- |
| `deevy health ping` | Liveness check | —     | Signed in |

### identities

| Command                                 | What it does                                                        | Flags                             | Who              |
| --------------------------------------- | ------------------------------------------------------------------- | --------------------------------- | ---------------- |
| `deevy identities begin`                | Start linking your account on a tool, on that tool's own page       | `--socket-id <string>` (required) | Not from the CLI |
| `deevy identities link`                 | Link the account a code names to you, so it rules as you            | `--code <string>` (required)      | Not from the CLI |
| `deevy identities list`                 | Your accounts on the tools, and which of them may rule as you       | —                                 | Humans           |
| `deevy identities peek`                 | Say which account a link code would link to you, without linking it | `--code <string>` (required)      | Not from the CLI |
| `deevy identities restore <identityId>` | Let an account you unlinked rule as you again                       | —                                 | Humans           |
| `deevy identities revoke <identityId>`  | Stop one of your accounts ruling as you                             | —                                 | Humans           |

### inbox

| Command                     | What it does                                    | Flags                                                        | Who               |
| --------------------------- | ----------------------------------------------- | ------------------------------------------------------------ | ----------------- |
| `deevy inbox list`          | The Notifications waiting for you, newest first | `--unread-only`<br>`--before <number>`<br>`--limit <number>` | Humans and Agents |
| `deevy inbox mark-all-read` | Mark your whole inbox read                      | —                                                            | Humans            |
| `deevy inbox mark-read`     | Mark some of your Notifications read            | `--ids <string>`, repeatable (required)                      | Humans and Agents |
| `deevy inbox unread-count`  | How many Notifications you have not read        | —                                                            | Humans            |

### invitations

| Command                                   | What it does                                                                | Flags                                                                   | Who               |
| ----------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------- |
| `deevy invitations accept`                | Join this Workspace with the invitation you were sent                       | `--token <string>` (required)                                           | A signed-in Human |
| `deevy invitations create`                | Admit one person by address, and get the link to send them                  | `--email <string>` (required)<br>`--role <admin \| member>`<br>`--send` | Admins            |
| `deevy invitations list`                  | Every invitation this Workspace has issued, spent and revoked ones included | —                                                                       | Admins            |
| `deevy invitations revoke <invitationId>` | Stop an invitation being accepted, keeping the record that it was sent      | —                                                                       | Admins            |

### issues

| Command                    | What it does                                                       | Flags                                                                                                                                                                                                                                                                                                            | Who               |
| -------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `deevy issues create`      | Open a record in the tracker a Project is bound to, and project it | `--parent <string>`<br>`--title <string>` (required)<br>`--body <string>`<br>`--assign-agent <string>`<br>`--project-slug <string>`                                                                                                                                                                              | Humans and Agents |
| `deevy issues get <issue>` | One record by id, URL or the tracker's key, with its family        | `--comments`                                                                                                                                                                                                                                                                                                     | Humans and Agents |
| `deevy issues list`        | The records deevy has projected, newest change first               | `--project-slug <string>`<br>`--q <string>`<br>`--cursor <string>`<br>`--state <open \| closed>`<br>`--state-name <string>`<br>`--assignee-member-id <string>`<br>`--assignee-kind <human \| agent>`<br>`--unassigned`<br>`--sponsor-member-id <string>`<br>`--label <string>`<br>`--open`<br>`--limit <number>` | Humans and Agents |

### links

| Command                       | What it does                                                     | Flags                                                                                                                          | Who               |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| `deevy links add <issue>`     | Point an Issue at a pull request, a commit, a branch, or any URL | `--url <string>` (required)<br>`--title <string>`<br>`--kind <pull_request \| commit \| branch \| url>`<br>`--run-id <string>` | Humans and Agents |
| `deevy links list <issue>`    | What an Issue points at                                          | —                                                                                                                              | Humans and Agents |
| `deevy links remove <linkId>` | Stop an Issue pointing at something                              | —                                                                                                                              | Humans and Agents |

### me

| Command        | What it does                                             | Flags | Who               |
| -------------- | -------------------------------------------------------- | ----- | ----------------- |
| `deevy me get` | The signed-in Human, their Member row, and the Workspace | —     | Humans and Agents |

### members

| Command                                | What it does                                                          | Flags                                 | Who    |
| -------------------------------------- | --------------------------------------------------------------------- | ------------------------------------- | ------ |
| `deevy members list`                   | Every Member of this Workspace                                        | —                                     | Humans |
| `deevy members reinstate <memberId>`   | Let a suspended Member back into the Workspace                        | —                                     | Admins |
| `deevy members suspend <memberId>`     | Shut a Member out of the Workspace without deleting their trail       | —                                     | Admins |
| `deevy members update-role <memberId>` | Make a Member an admin of this Workspace, or an ordinary Member again | `--role <admin \| member>` (required) | Admins |

### oauth-clients

| Command                                 | What it does                                       | Flags | Who              |
| --------------------------------------- | -------------------------------------------------- | ----- | ---------------- |
| `deevy oauth-clients list`              | The MCP clients you have let act as you            | —     | Not from the CLI |
| `deevy oauth-clients revoke <clientId>` | Withdraw one MCP client's permission to act as you | —     | Not from the CLI |

### preferences

| Command                 | What it does                                                          | Flags                                         | Who    |
| ----------------------- | --------------------------------------------------------------------- | --------------------------------------------- | ------ |
| `deevy preferences get` | Which Notifications reach you, and in which Channels                  | —                                             | Humans |
| `deevy preferences set` | Say which of your Notifications reach the inbox, Slack and your email | `--preferences <json>`, repeatable (required) | Humans |

### projects

| Command                         | What it does                                                           | Flags                                                                                                                                                                                | Who               |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| `deevy projects archive <slug>` | Close a Project down; it stays readable and keeps what it projected    | —                                                                                                                                                                                    | Admins            |
| `deevy projects create`         | Bind a container in a Socket to a Project an Agent can be granted      | `--slug <string>` (required)<br>`--name <string>` (required)<br>`--description <string>`<br>`--tracker <json>` (required)<br>`--docs <json>`<br>`--default-agent-member-id <string>` | Admins            |
| `deevy projects get <slug>`     | One Project by its slug: where its Issues come from and who works them | —                                                                                                                                                                                    | Humans and Agents |
| `deevy projects list`           | The Projects in this Workspace, and what each is bound to              | `--include-archived`                                                                                                                                                                 | Humans and Agents |
| `deevy projects update <slug>`  | Rename a Project, rebind its documents, or change what deevy says back | `--name <string>`<br>`--description <string>`<br>`--default-agent-member-id <string>`<br>`--mirror <off \| gates \| runs>`<br>`--docs <json>`<br>`--routing <json>`                  | Humans            |

### routing

| Command              | What it does                                               | Flags                                   | Who    |
| -------------------- | ---------------------------------------------------------- | --------------------------------------- | ------ |
| `deevy routing list` | Which Notifications this Workspace sends to which Channels | —                                       | Admins |
| `deevy routing set`  | Replace the routing rules with this set                    | `--rules <json>`, repeatable (required) | Admins |

### runs

| Command                            | What it does                                                                       | Flags                                                                                                                                                                                           | Who               |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `deevy runs answer <runId>`        | Answer a Run's elicitation, so the Agent carries on                                | `--body <string>` (required)                                                                                                                                                                    | Humans            |
| `deevy runs finish <runId>`        | End your Run, completed or failed, with a summary of what happened                 | `--status <completed \| failed>` (required)<br>`--summary <string>` (required)                                                                                                                  | Agents only       |
| `deevy runs get <runId>`           | One Run with its Activity feed in the order it happened                            | —                                                                                                                                                                                               | Humans and Agents |
| `deevy runs list`                  | Runs on an Issue or by an Agent, newest first, from a cursor                       | `--issue <string>`<br>`--agent-member-id <string>`<br>`--mine`<br>`--status <pending \| active \| awaiting_input \| completed \| failed \| stale>`<br>`--before <string>`<br>`--limit <number>` | Humans and Agents |
| `deevy runs post-activity <runId>` | Post one Activity to your Run: a thought, an action, an elicitation, or an error   | `--kind <thought \| action \| elicitation \| response \| error>` (required)<br>`--body <string>` (required)<br>`--payload <json>`                                                               | Agents only       |
| `deevy runs retry <runId>`         | Try a failed or stale Run again: a fresh Run for the same Agent on the same record | —                                                                                                                                                                                               | Humans            |
| `deevy runs start <issue>`         | Begin a Run on an Issue, pending until the Agent posts its first Activity          | —                                                                                                                                                                                               | Agents only       |

### sockets

| Command                               | What it does                                                                       | Flags                                                                                                                                                                                                                                                | Who    |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `deevy sockets begin`                 | Start connecting a tool whose own flow has to send you back here                   | `--provider <github \| linear \| gitlab \| notion \| slack \| stub>` (required)<br>`--name <string>` (required)<br>`--config <json>`                                                                                                                 | Admins |
| `deevy sockets connect`               | Connect a tool, proving the connection by asking who deevy is there                | `--provider <github \| linear \| gitlab \| notion \| slack \| stub>` (required)<br>`--name <string>` (required)<br>`--config <json>`<br>`--credentials <json>`<br>`--webhook-secret <string>`<br>`--poll-minutes <number>`<br>`--socket-id <string>` | Admins |
| `deevy sockets containers <socketId>` | What a Project could be bound to inside this tool                                  | —                                                                                                                                                                                                                                                    | Admins |
| `deevy sockets handshake <socketId>`  | Show the token a tool sent to verify its webhook, to paste back into it            | —                                                                                                                                                                                                                                                    | Admins |
| `deevy sockets inbound <socketId>`    | What this tool has said lately, and what deevy made of it                          | `--limit <number>`                                                                                                                                                                                                                                   | Admins |
| `deevy sockets install <socketId>`    | Give a connected tool's app more than its credential could, on the tool's own page | —                                                                                                                                                                                                                                                    | Admins |
| `deevy sockets list`                  | The tools this Workspace is connected to                                           | —                                                                                                                                                                                                                                                    | Admins |
| `deevy sockets providers`             | The tools this deevy was built to speak                                            | —                                                                                                                                                                                                                                                    | Admins |
| `deevy sockets remove <socketId>`     | Disconnect a tool, leaving what it projected readable                              | —                                                                                                                                                                                                                                                    | Admins |
| `deevy sockets rewire <socketId>`     | Point a tool's own webhook at this deevy's address, after the address moved        | —                                                                                                                                                                                                                                                    | Admins |
| `deevy sockets rotate <socketId>`     | Mint a new webhook secret for a tool whose settings take one, and say it once      | —                                                                                                                                                                                                                                                    | Admins |
| `deevy sockets test <socketId>`       | Ask the tool who deevy is there, which proves the credential still works           | —                                                                                                                                                                                                                                                    | Admins |
| `deevy sockets update <socketId>`     | Rename a tool, rest it, or ask it on a schedule                                    | `--name <string>`<br>`--status <pending \| active \| paused>`<br>`--poll-minutes <number>`<br>`--identity-by-email`<br>`--webhook-secret <string>`                                                                                                   | Admins |

### webhooks

| Command                                                  | What it does                                                           | Flags                                                                                                                                                | Who    |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `deevy webhooks create`                                  | Subscribe a URL to this Workspace's Events                             | `--member-id <string>`<br>`--url <string>` (required)<br>`--secret <string>` (required)<br>`--kinds <string>`, repeatable<br>`--project-id <string>` | Humans |
| `deevy webhooks delete <subscriptionId>`                 | Stop telling this URL anything, and forget it                          | —                                                                                                                                                    | Humans |
| `deevy webhooks deliveries <subscriptionId>`             | What this subscription was owed lately, and how each attempt went      | `--limit <number>`                                                                                                                                   | Humans |
| `deevy webhooks list`                                    | The URLs this Workspace tells when something happens                   | —                                                                                                                                                    | Humans |
| `deevy webhooks redeliver <subscriptionId> <deliveryId>` | Owe this delivery again, from the beginning                            | —                                                                                                                                                    | Humans |
| `deevy webhooks update <subscriptionId>`                 | Repoint a subscription, narrow it, rotate its secret, or switch it off | `--url <string>`<br>`--secret <string>`<br>`--kinds <string>`, repeatable<br>`--project-id <string>`<br>`--disabled`                                 | Humans |

### workspace

| Command                  | What it does                                                                     | Flags                                                                                                                              | Who    |
| ------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `deevy workspace get`    | The Workspace this instance serves                                               | —                                                                                                                                  | Humans |
| `deevy workspace update` | Rename the Workspace this instance serves, and set what an Agent may not go past | `--name <string>`<br>`--max-children-per-issue <number>`<br>`--max-delegation-depth <number>`<br>`--max-open-descendants <number>` | Admins |
