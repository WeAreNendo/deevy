---
title: The CLI
description: Install deevy's command-line tool, sign in to your Workspace as yourself or as an Agent, and work with records, Runs and Gates from a terminal.
sidebar:
  order: 2
---

`deevy` is deevy from a terminal. It does what the API does, as whoever it is signed in as: you, after you
sign in through your browser, or an Agent, when you give it the Agent's key. Every command and flag is in the
[CLI reference](/reference/cli/).

## Install it

You need Node.js 22.18 or later.

```bash
npm install -g @deevy/cli
```

Or run it without installing, as `npx @deevy/cli`. The CLI's version is deevy's own.

## Sign in

1. Run `deevy login` with your Workspace's URL:

   ```bash
   deevy login https://app.deevy.dev/acme
   ```

2. Your browser opens on deevy. Sign in if you are not already, and approve **Let deevy CLI act as you?**
   with **Allow**.
3. The terminal says **Signed in**, and where it kept the token.

Finish within five minutes, in a browser on the same machine: the CLI waits for deevy to send the browser
back to it there. If no browser opens, `deevy login` prints the address to open; `--no-browser` prints it
without trying.

:::note[deevy Cloud]
Use your Workspace's whole address, `https://app.deevy.dev/<address>`. Each Workspace is signed in to on its
own, and signing in to a second one leaves the first signed in.
:::

:::note[Self-hosted]
Use your deevy's URL, with its path if it lives under one. A deevy on your own machine is fine:
`deevy login localhost:3000` signs in to `http://localhost:3000`.
:::

To stop typing the URL, set it once:

```bash
export DEEVY_URL=https://app.deevy.dev/acme
```

Every command then talks to that Workspace. To point one command elsewhere, give `login`, `logout`,
`whoami`, `gates open` and `events watch` the URL as their last argument, and any other command
`--deevy-url <url>`.

## Check who you are

```bash
deevy whoami
```

It says who the terminal is, your role, which Workspace answered, and whether it is acting as you or as an
Agent.

## Sign out

```bash
deevy logout
```

This forgets the token on this machine. The CLI stays listed under **Settings › MCP clients** until you choose
**Revoke** there; signing out cannot do that for you, because revoking needs you in deevy's own pages.

## Act as an Agent

Put an Agent's API key in `DEEVY_API_KEY`, and the CLI acts as that Agent instead of you, which is what a
script wants:

```bash
export DEEVY_API_KEY=deevy_sk_…
deevy whoami
```

The key wins over a token you signed in with, and `deevy whoami` says so. An Agent may do less than you, so
some commands are refused while the key is set; unset it to be yourself again. See
[What an Agent may do](/agents/permissions/).

## Things to do

**Find a record:**

```bash
deevy issues list --project-slug web --state open
deevy issues get ENG-12
```

A record is named by its id, its URL, or the tracker's key, such as `ENG-12` or `acme/web#42`. Its
conversation is the tracker's: read it, and comment, there.

**See what Agents did on it:**

```bash
deevy runs list --issue ENG-12
deevy runs get run_k3xr8v2m9qpw
```

**Find the Gates waiting on you, and open one:**

```bash
deevy gates list --mine
deevy gates open ENG-12
```

`gates open` takes a Gate's id, or the key of the record waiting at one, and opens its ruling screen in your
browser. A Gate is ruled there, by a Human, and never from the CLI.

**Read your inbox:**

```bash
deevy inbox list --unread-only
```

**Follow what happens, as it happens:**

```bash
deevy events watch
```

Each Event prints as it arrives. Stop it with Ctrl-C; `--after <seq>` picks up after the Event with that
number.

**Issue a key for an Agent you sponsor:**

```bash
deevy agents list
deevy agents keys issue mem_k3xr8v2m9qpw --name ci
```

The key is printed this once.

## Read the answers

A list prints as a table, and a single thing as its fields. Add `--json` to any command for deevy's exact
answer, for a script:

```bash
deevy runs list --issue ENG-12 --json
```

## What it cannot do

Some things are for a Human present in deevy's own pages, and the CLI says so rather than trying:

- `gates approve` and `gates reject`. A Gate is ruled in a browser, whatever the CLI is signed in as. Use
  `deevy gates open`.
- `oauth-clients list` and `oauth-clients revoke`. A credential you delegated cannot list or revoke the
  consents that delegated it.
- `email` commands, and linking an account with `identities begin`, `identities peek` or `identities link`.

## When the CLI and your Workspace disagree

A CLI newer than your Workspace asks the Workspace what it can do, and names a command the Workspace does not
have yet rather than failing at it. A CLI older than your Workspace lacks the commands it has gained since;
update it with `npm install -g @deevy/cli`.
