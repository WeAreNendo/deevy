---
title: CLI reference
description: Every command and flag of deevy's command-line tool, the Agent it acts as, and the environment it reads.
sidebar:
  order: 2
---

`deevy` is deevy from a terminal, for an Agent. Almost every command is made from one of the API operations
an Agent may call, so the CLI does exactly what the API does for the Agent whose key it holds. For a guided
start, see [The CLI](/mcp-and-cli/cli/).

```bash
npm install -g @deevy/cli      # Node.js 22.18 or later
deevy <group> <command> [arguments] [flags]
```

`deevy --help` lists the groups, `deevy <group> --help` the commands in one, and
`deevy <group> <command> --help` a command's arguments and flags. `deevy --version` prints the version, which is deevy's own.

## Which deevy it talks to

- `whoami` and `gates open` take the Workspace's URL as an optional last argument.
- Every other command takes `--deevy-url <url>`.
- Either way, left out, it is `DEEVY_URL`.

A URL may include a path, as a Workspace on deevy Cloud does: `https://app.deevy.dev/acme`. A bare host is
given `https://`, except `localhost`, `127.0.0.1` and `[::1]`, which are given `http://`.

## Who it acts as

The Agent whose API key is in `DEEVY_API_KEY`, and nobody else. Without a key, `deevy whoami` says how to get
one, and every other command stops before it asks deevy. deevy refuses a key that is not an Agent's.

deevy answers the Agent within the Projects it was granted, and may refuse more: a Gate is ruled by a Human,
never with a key. What only a Human does, such as sponsoring an Agent, issuing its key, connecting a tool or
ruling on a Gate, has no command: it is done in deevy's own pages.

## Environment

| Variable          | What it does                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `DEEVY_URL`       | The Workspace every command talks to, path included, when none is named.                         |
| `DEEVY_API_KEY`   | An Agent's API key. The CLI acts as that Agent.                                                  |
| `DEEVY_WEB_URL`   | Where deevy's web app is, when that is not where its API is. Only `deevy gates open` uses it.    |
| `XDG_CONFIG_HOME` | Where the CLI keeps what each Workspace said it can do, under `deevy/`. Defaults to `~/.config`. |
| `NO_COLOR`        | Turns colour off. Colour is off for a pipe either way.                                           |

The CLI keeps nothing secret on disk. It caches what a Workspace can do for a day, in one file per Workspace:
`~/.config/deevy/https_app.deevy.dev%2Facme.capabilities.json` for `https://app.deevy.dev/acme`,
`~/.config/deevy/https_deevy.example.com.capabilities.json` for a deevy at the root of its host.

## Arguments and flags

- **Arguments** in `<angle brackets>` are required and in `[square brackets]` optional. Most are ids, which
  look like `run_k3xr8v2m9qpw`; an `<issue>` also takes the record's URL or the tracker's key, such as
  `ENG-12` or `acme/web#42`.
- **Every command made from an operation** also takes `--deevy-url <url>` and `--json`.
- **A flag with no value shown** is a switch: give it alone for true, or follow it with `true` or `false`.
- **A repeatable flag** is given once per value: `--ids ntf_k3xr8v2m9qpw --ids ntf_9pd2w7c1xm4r`.
- **A `<json>` flag** takes JSON text: `--links '{"url":"https://example.com/pull/7","title":"The fix"}'`.
- **deevy checks the values**, and a refusal names the flag it is about.

A list prints as a table and a single thing as its fields. `--json` prints deevy's exact answer, for a
script.

The CLI exits with status 1 and a sentence when a command fails.

A CLI newer than the Workspace it is pointed at asks the Workspace which operations it has, and names a
command the Workspace does not have rather than failing at it.

## Who it is

| Command              | What it does                     | Flags    |
| -------------------- | -------------------------------- | -------- |
| `deevy whoami [url]` | Say which Agent this terminal is | `--json` |

## Commands by group

Each description is the one the command's `--help` prints. `gates list --mine` asks for the Gates waiting
on a Human, so it answers an Agent with none; an Agent finds its own with `--run-id`.

### gates

| Command                         | What it does                                                                 | Flags                                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deevy gates get <requestId>`   | What has been ruled on a Gate, for an Agent waiting or a Human reading       | —                                                                                                                                                                      |
| `deevy gates list`              | Gates in this Workspace: open ones, or the ones waiting on you               | `--mine`<br>`--run-id <string>`<br>`--issue-id <string>`<br>`--status <open \| approved \| rejected \| superseded>`<br>`--project-slug <string>`<br>`--limit <number>` |
| `deevy gates open <gate> [url]` | Open a Gate's ruling screen in a browser                                     | `--no-browser`                                                                                                                                                         |
| `deevy gates request <runId>`   | Ask the Humans to let this Run past a Checkpoint, with what you intend to do | `--checkpoint <string>` (required)<br>`--proposal <string>` (required)<br>`--links <json>`, repeatable                                                                 |

### health

| Command             | What it does   | Flags |
| ------------------- | -------------- | ----- |
| `deevy health ping` | Liveness check | —     |

### inbox

| Command                 | What it does                                           | Flags                                                        |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| `deevy inbox list`      | The Notifications waiting for this Agent, newest first | `--unread-only`<br>`--before <number>`<br>`--limit <number>` |
| `deevy inbox mark-read` | Mark some of this Agent's Notifications read           | `--ids <string>`, repeatable (required)                      |

### issues

| Command                    | What it does                                                | Flags                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deevy issues get <issue>` | One record by id, URL or the tracker's key, with its family | —                                                                                                                                                                                                                                                                                                                |
| `deevy issues list`        | The records deevy has projected, newest change first        | `--project-slug <string>`<br>`--q <string>`<br>`--cursor <string>`<br>`--state <open \| closed>`<br>`--state-name <string>`<br>`--assignee-member-id <string>`<br>`--assignee-kind <human \| agent>`<br>`--unassigned`<br>`--sponsor-member-id <string>`<br>`--label <string>`<br>`--open`<br>`--limit <number>` |

### links

| Command                       | What it does                                                     | Flags                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `deevy links add <issue>`     | Point an Issue at a pull request, a commit, a branch, or any URL | `--url <string>` (required)<br>`--title <string>`<br>`--kind <pull_request \| commit \| branch \| url>`<br>`--run-id <string>` |
| `deevy links list <issue>`    | What an Issue points at                                          | —                                                                                                                              |
| `deevy links remove <linkId>` | Stop an Issue pointing at something                              | —                                                                                                                              |

### me

| Command        | What it does                                                                                       | Flags |
| -------------- | -------------------------------------------------------------------------------------------------- | ----- |
| `deevy me get` | Who is asking: the signed-in Human or the Agent whose key it is, its Member row, and the Workspace | —     |

### projects

| Command                     | What it does                                                           | Flags                |
| --------------------------- | ---------------------------------------------------------------------- | -------------------- |
| `deevy projects get <slug>` | One Project by its slug: where its Issues come from and who works them | —                    |
| `deevy projects list`       | The Projects in this Workspace, and what each is bound to              | `--include-archived` |

### runs

| Command                            | What it does                                                                 | Flags                                                                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deevy runs finish <runId>`        | End your Run, completed or failed, with a summary of what happened           | `--status <completed \| failed>` (required)<br>`--summary <string>` (required)                                                                                                                  |
| `deevy runs get <runId>`           | One Run with its Activity feed in the order it happened                      | —                                                                                                                                                                                               |
| `deevy runs list`                  | Runs on an Issue or by an Agent, newest first, from a cursor                 | `--issue <string>`<br>`--agent-member-id <string>`<br>`--mine`<br>`--status <pending \| active \| awaiting_input \| completed \| failed \| stale>`<br>`--before <string>`<br>`--limit <number>` |
| `deevy runs post-activity <runId>` | Post one Activity to your Run: a thought, an action, a response, or an error | `--kind <thought \| action \| response \| error>` (required)<br>`--body <string>` (required)<br>`--payload <json>`                                                                              |
| `deevy runs start <issue>`         | Begin a Run on an Issue, pending until the Agent posts its first Activity    | —                                                                                                                                                                                               |
