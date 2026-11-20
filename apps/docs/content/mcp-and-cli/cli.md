---
title: The CLI
description: Install deevy's command-line tool, give it an Agent's key, and work as that Agent from a terminal or a script, with records, Runs and Gates.
sidebar:
  order: 2
---

`deevy` is deevy from a terminal, for an Agent. It acts as the Agent whose API key you give it, which is what
a script, a CI job or a loop of your own wants. You, as a Human, work in deevy's own pages, in your tracker
and in your chat channel. Every command and flag is in the [CLI reference](/reference/cli/).

## Install it

You need Node.js 22.18 or later.

```bash
npm install -g @deevy/cli
```

Or run it without installing, as `npx @deevy/cli`. The CLI's version is deevy's own.

## Give it an Agent's key

The CLI acts as whichever Agent's key is in `DEEVY_API_KEY`. A key is issued by the Agent's Sponsor, on the
Agent's page under **Settings › Agents**; see [Add an Agent](/get-started/add-an-agent/).

```bash
export DEEVY_API_KEY=deevy_sk_…
export DEEVY_URL=https://app.deevy.dev/acme
deevy whoami
```

`deevy whoami` names the Agent and the Workspace that answered. Without a key, it says how to get one, and
every other command stops before it asks deevy. A key that is not an Agent's is refused.

:::note[deevy Cloud]
Use your Workspace's whole address, `https://app.deevy.dev/<address>`.
:::

:::note[Self-hosted]
Use your deevy's URL, with its path if it lives under one. A deevy on your own machine is fine:
`localhost:3000` means `http://localhost:3000`.
:::

`DEEVY_URL` points every command at one Workspace. To point one command elsewhere, give `whoami` and
`gates open` the URL as their last argument, and any other command `--deevy-url <url>`.

Keep the key out of anything you commit: whoever holds it acts as the Agent.

## Things to do

**Find a record:**

```bash
deevy issues list --project-slug web --state open
deevy issues get ENG-12
```

A record is named by its id, its URL, or the tracker's key, such as `ENG-12` or `acme/web#42`. Its
conversation is the tracker's: read it, and comment, there, with the Agent's own access to that tool.

**Read the Agent's inbox:**

```bash
deevy inbox list --unread-only
```

The inbox is what was routed to the Agent, the comments that mention it, and the Rulings on its Gates.

**Work a Run:**

```bash
deevy runs start ENG-12
deevy runs post-activity run_k3xr8v2m9qpw --kind action --body "Ran the test suite"
deevy runs finish run_k3xr8v2m9qpw --status completed --summary "Fixed the rounding in the basket total"
```

**Ask at a Gate, and put it in front of a Human:**

```bash
deevy gates request run_k3xr8v2m9qpw --checkpoint ship --proposal "Merge the fix"
deevy gates open ENG-12 --no-browser
```

`gates open` takes a Gate's id, or the key of the record waiting at one, and prints the address of its
ruling screen. A Gate is ruled there, by a Human signed in, and never with a key.

**Point the record at what the Agent made:**

```bash
deevy links add ENG-12 --url https://github.com/acme/web/pull/7 --kind pull_request
```

## Read the answers

A list prints as a table, and a single thing as its fields. Add `--json` to any command for deevy's exact
answer, for a script:

```bash
deevy runs list --issue ENG-12 --json
```

## What it does not do

The CLI has a command for every operation an Agent may call, and for nothing else. Sponsoring an Agent,
issuing its key, connecting a tool, binding a Project and ruling on a Gate are a Human's, in deevy's own
pages. See [What an Agent may do](/agents/permissions/).

## When the CLI and your Workspace disagree

A CLI newer than your Workspace asks the Workspace what it can do, and names a command the Workspace does not
have yet rather than failing at it. A CLI older than your Workspace lacks the commands it has gained since;
update it with `npm install -g @deevy/cli`.
