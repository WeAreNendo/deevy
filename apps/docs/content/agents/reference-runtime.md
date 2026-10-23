---
title: The reference runtime
description: Run deevy's reference agent runtime with Docker, so an Agent picks up the records routed to it and works them with Claude Code, OpenCode, Cursor or Copilot.
sidebar:
  order: 2
---

deevy never runs an Agent. The reference runtime is the thing on the other side: a small service you run,
which holds one Agent's API key, asks your Workspace what that Agent has been given, and works each Run with
a coding-agent CLI. It reaches deevy over the same API and MCP endpoint as anything else, so it works the
same against a Workspace on deevy Cloud or a deevy you host.

You do not have to run it. A Workspace with no runtime is one where the Humans do the work, and
[your own harness](/agents/your-own-harness/) can take its place.

## Choose an image

There is one image per coding agent, `ghcr.io/wearenendo/deevy-agent`, for `linux/amd64` and `linux/arm64`:

| Coding agent       | Tag           | What it needs to work                                                                    |
| ------------------ | ------------- | ---------------------------------------------------------------------------------------- |
| Claude Code        | `claude-code` | `ANTHROPIC_API_KEY`                                                                      |
| OpenCode           | `opencode`    | The key for the model provider you use, such as `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`  |
| Cursor CLI         | `cursor`      | `CURSOR_API_KEY`, from cursor.com. The desktop app's sign-in is not shared with the CLI. |
| GitHub Copilot CLI | `copilot`     | `COPILOT_GITHUB_TOKEN`                                                                   |

`latest` is Claude Code. Each tag moves with every release; to pin one, use the version in front of it, such
as `0.11.2-claude-code`.

For Copilot, make `COPILOT_GITHUB_TOKEN` a fine-grained token with the **Copilot Requests** permission and no
repository permission. The coding agent's shell runs with it, so a token that can push is a push nothing
in the runtime can stop.

## Before you start

1. [Create the Agent](/agents/overview/#create-an-agent), and keep its API key.
2. [Grant it the Projects](/agents/overview/#grant-it-projects) it should work in.
3. If it should write code, set each Project's **Repository** to a GitHub or GitLab repository under
   **Settings › Projects**. deevy then gives each Run the repository, the branch to cut and a short-lived
   credential, and opens the pull request itself. With no repository, a Run reads, plans, comments and asks
   at Checkpoints, and writes no code.

## Run it

Put the Agent's key and the coding agent's credential in the environment, then start the container:

```bash
export DEEVY_AGENT_KEY=deevy_sk_…
export ANTHROPIC_API_KEY=sk-ant-…

docker run -d --name deevy-agent --restart unless-stopped \
  --cap-drop=ALL --cap-add=SETUID --cap-add=SETGID --cap-add=CHOWN --cap-add=DAC_OVERRIDE \
  -e DEEVY_URL=https://deevy.example.com \
  -e DEEVY_AGENT_KEY -e ANTHROPIC_API_KEY \
  -p 8787:8787 \
  ghcr.io/wearenendo/deevy-agent:claude-code
```

The four capabilities are exactly what it needs to run each coding agent as a user of its own, which is what
keeps the Agent's key out of that coding agent's reach. With fewer it fails at its first Run.

It checks for work every 30 seconds, backing off while there is none, and answers `GET /healthz` on port 8787.

To make one pass and stop, which is handy the first time, run it in the foreground with `--once`:

```bash
docker run --rm \
  --cap-drop=ALL --cap-add=SETUID --cap-add=SETGID --cap-add=CHOWN --cap-add=DAC_OVERRIDE \
  -e DEEVY_URL=https://deevy.example.com \
  -e DEEVY_AGENT_KEY -e ANTHROPIC_API_KEY \
  ghcr.io/wearenendo/deevy-agent:claude-code node dist/main.mjs --once
```

:::note[deevy Cloud]
Set `DEEVY_URL` to your Workspace's whole address, `https://app.deevy.dev/<address>`, with no trailing
slash. The runtime runs wherever you run it; deevy Cloud only talks to it.
:::

:::note[Self-hosted]
Set `DEEVY_URL` to your deevy's own URL. With deevy's Docker Compose file, `docker compose --profile agent
up -d` starts the runtime beside deevy and points it there; give it `DEEVY_AGENT_KEY` and the coding agent's
credential in the environment or in `.env`. It runs Claude Code unless you set `DEEVY_AGENT_IMAGE` to
another image, such as `ghcr.io/wearenendo/deevy-agent:cursor`. The settings below reach it the same way,
except the variables you name in `DEEVY_AGENT_PASS_ENV`: add each of those to the `agent` service's
`environment` as well. See [Docker](/self-hosting/docker/).
:::

## Its settings

| Variable                                                               | Default                          | What it does                                                                                                                                                                 |
| ---------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEEVY_URL`                                                            | none                             | Your Workspace's URL. Required.                                                                                                                                              |
| `DEEVY_AGENT_KEY`                                                      | none                             | The Agent's API key, and the whole of the runtime's identity. Required.                                                                                                      |
| `DEEVY_AGENT_HARNESS`                                                  | the image's coding agent         | Which coding agent works the Runs: `claude-code`, `opencode`, `cursor` or `copilot`. Each image sets it to the one it carries, so choose the image instead.                  |
| `DEEVY_AGENT_MODEL`                                                    | `claude-opus-5`                  | The model each Run uses, and the largest lever on what a Run costs. OpenCode wants `provider/model`, by default `anthropic/claude-opus-5`; Cursor takes its own model names. |
| `DEEVY_AGENT_EFFORT`                                                   | `high`                           | How hard Claude Code thinks: `low`, `medium`, `high`, `xhigh` or `max`. Claude Code only.                                                                                    |
| `DEEVY_AGENT_MAX_TURNS`                                                | 100                              | A backstop on a coding agent that will not stop. Claude Code and OpenCode.                                                                                                   |
| `DEEVY_AGENT_RUN_TIMEOUT_SECONDS`                                      | 1800                             | The longest one Run may work. It matches the half hour after which deevy calls a silent Run stale.                                                                           |
| `DEEVY_AGENT_POLL_SECONDS`                                             | 30                               | How often it asks for work. It backs off to eight times this while there is none.                                                                                            |
| `DEEVY_AGENT_PASS_ENV`                                                 | none                             | A comma-separated list of other variables the coding agent may see, for a proxy, a private registry or a custom CA. It sees nothing else.                                    |
| `DEEVY_AGENT_WEBHOOK_SECRET`                                           | none                             | The secret deevy signs this Agent's deliveries with. Without it the runtime only asks.                                                                                       |
| `DEEVY_AGENT_PORT`                                                     | 8787                             | Where it answers `/healthz` and deevy's deliveries.                                                                                                                          |
| `DEEVY_AGENT_WORKDIR`                                                  | the system's temporary directory | Where each Run's working directory is made.                                                                                                                                  |
| `DEEVY_AGENT_REPO`, `DEEVY_AGENT_GIT_TOKEN`, `DEEVY_AGENT_BASE_BRANCH` | none, none, `main`               | Together, a repository to work that no Socket holds. Leave all three unset when your Projects name a repository.                                                             |
| `DEEVY_AGENT_IMAGE`                                                    | `deevy-agent:latest`             | With deevy's Compose file, the image the runtime runs, and so its coding agent. Read by Compose, not by the runtime.                                                         |

The image sets which coding agent it runs. The `cursor` and `copilot` images refuse to start without their
credential. The `claude-code` and `opencode` images start without one, since Claude Code may already be
signed in and OpenCode's key depends on the model you choose; a Run then fails with the coding agent's own
error until you give it one.

## Tell it when there is work

Left alone, the runtime asks every 30 seconds. To have deevy tell it the moment a Run is opened for the
Agent instead, give the Agent a webhook:

1. Make the runtime reachable from your Workspace over HTTPS, at any path, for example
   `https://agent.example.com/`.
2. Open the Agent's page under **Settings › Agents**. Under **Webhook**, enter that address as the
   **Webhook URL**, enter a **Signing secret** of at least 16 characters or choose **Generate**, and choose
   **Start deliveries**. Copy the secret: deevy never shows it again.
3. Give the runtime the same secret as `DEEVY_AGENT_WEBHOOK_SECRET`.

The [CLI](/mcp-and-cli/cli/) can set the webhook instead, with the Agent's id from its page's address:

```bash
deevy agents update <agent id> --webhook-url https://agent.example.com/ --webhook-secret <the secret>
```

deevy then posts each new Event from the Agent's granted Projects to the runtime, signed, and the runtime
looks for work at once rather than at its next check. Nothing from a Project the Agent was not granted is
sent. The runtime keeps asking as well, so a delivery that never arrives costs time and never a Run; to stop
the deliveries, choose **Stop deliveries** on the Agent's page.

## What it does with a Run

The runtime works one Run at a time:

1. It finds the Agent's Runs waiting to start.
2. It makes a working directory for the Run: a fresh clone of the repository deevy names, or an empty
   directory when there is none.
3. It starts the coding agent there, connected to deevy through a proxy of its own that holds the Agent's
   key and offers only deevy's tools for an Agent. The coding agent never holds the key.
4. The coding agent reads the record and its conversation, and any page of the Project's documents it links,
   posts Activities to the Run as it goes, and stops at each Checkpoint the Project lists by asking at a
   Gate.
5. At a Gate the Run waits for a Human, and the runtime moves on. When somebody rules, deevy hands the Run
   back, and the runtime starts the coding agent again, told which way it went. After a rejection it reads
   the note and revises.
6. When the coding agent has changed files, the runtime makes sure they are committed and pushed on a branch
   named after the Run, and deevy opens the pull request through the Project's Socket, saying
   `Closes <the record's URL>`. The pull request becomes a Link on the record, carrying the Run's id.
7. The coding agent finishes the Run, with a summary a Human can act on, and the runtime reports what the
   Run spent.

Every commit is the Agent's: the clone is given its name and address. Runs that changed nothing attach
nothing.

Whatever the coding agent does, the Run does not rot. One that crashes, hangs or stops early gets an error
Activity and fails, rather than sitting silent until deevy calls it stale. A failed or stale Run can be tried
again from its page with **Try again**, by the Agent's Sponsor or an admin.

## What it spent

When a coding agent stops, the runtime reports what it used: tokens by model, with the prompt cache, and a
cost where the coding agent priced them. Claude Code and OpenCode report a cost. Cursor and Copilot report
tokens and no cost, because neither prices them in dollars. A Run resumed after a Gate reports again, and
deevy adds them up. Every screen says the cost is the client's estimate.

## What bounds it, and what does not

**A record's text is untrusted.** Its body, its comments, the pages it links and other Agents' Activities are
written by anybody who can write in your tools, and all of it reaches a coding agent that, with a
repository, has a shell. No prompt makes that safe. What bounds it is how the runtime is built:

- **The coding agent runs as a user of its own**, so it cannot read the runtime's environment: not the
  Agent's key, not a git token.
- **It sees only the environment it is given**: enough to run and to use git, its own provider credential,
  and what you name in `DEEVY_AGENT_PASS_ENV`.
- **Its tools are granted by name.** A repository's own configuration for the coding agent is removed or
  ignored, so cloning a repository changes nothing about what the coding agent may do.
- **It never holds a credential.** deevy is reached through the runtime's proxy, which adds the key and
  refuses any tool it does not grant; the repository is reached through the runtime too, which adds the git
  credential. A refused tool shows in the Run's feed as an error Activity, naming what was reached for.
- **A Gate is the last line.** An Agent can never approve one, so nothing it proposes ships without a Human
  deciding it should.

**Where an Agent can push is the reach of the credential, and nothing else.** The runtime does not stop a
coding agent pushing to any branch it can reach, force-pushing included, and a Gate governs whether a Run
goes past a Checkpoint, not a branch. Keep the reach small: a GitHub App installed only on the repositories it
works, a GitLab account that is a Developer on them and no more, and branch protection on the branches that
matter. Every branch a Run moves is an Activity in its feed.

What is not bounded: with a shell, a coding agent can run whatever the repository's own build runs, reach
the network, and spend tokens. Give the runtime a repository you would give a new contractor, and read the
pull requests.

Run with `--user`, or outside a container, the runtime has no such boundary and says so when it starts.
That is fine for trying it, not for a Workspace other people write in.

## Next

- [What an Agent may do](/agents/permissions/) in deevy, whatever runs it.
- [Sub-issues and delegation](/agents/delegation/), for an Agent that splits work up.
