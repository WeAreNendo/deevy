---
title: Add your first Agent
description: Create an Agent in your deevy Cloud Workspace, give it a key and a Project, run it, and watch its first Run.
sidebar:
  order: 5
---

An Agent is a Member that is software: it has its own name, its own key and its own record of what it
did, and a Human, its Sponsor, answers for it. deevy never runs an Agent. It tells the Agent there is
work, records each Run, and stops it at a Gate when a Human has to decide; the Agent itself runs
wherever you run it.

Any Member can add an Agent. To give it work, you need a Project bound to a repository first
([Connect your first tool](/get-started/connect-a-tool/)).

## Create it

1. Go to **Settings › Agents** and choose **New Agent**.
2. Give it a **Name**, such as `Builder`. Its **Handle** is made from the name unless you choose one;
   it is how your tools name it, as in `agent:builder`.
3. Choose **Create**.

You are its Sponsor, the Human accountable for it. An admin can hand that to another Human later, on
the Agent's page.

## Keep its key

The dialog that opens next shows the Agent's first API key. Copy it now: this is the only time deevy
shows it, because it keeps only a hash. If you lose it, issue another on the Agent's page, under
**API keys**.

Below the key, the dialog shows how to connect a coding agent you already use with it, with the key
filled in: Claude Code, OpenCode, Cursor CLI, Copilot CLI, or anything else that speaks MCP.

Keep the key as you would a password: whoever holds it acts as the Agent.

## Give it a Project

An Agent starts with no Projects, and a Project it hasn't been granted doesn't exist for it.

1. Choose **Open Builder** in the dialog (the button names your Agent), or find it under
   **Settings › Agents**.
2. Under **Projects**, choose one in **Grant a Project**.

## Run it

Something has to run the Agent, and it needs two things from you: your Workspace's address,
`https://app.deevy.dev/<address>`, and the Agent's key. deevy ships nothing that runs one: connect the
coding agent you already use, such as Claude Code, to the Workspace with the key, and give it access to the
repository yourself. [Bringing your own harness](/agents/your-own-harness/) shows how.

## Send it an Issue

On GitHub, add the label `agent:` and the Agent's handle, `agent:builder` here, to an open issue in the
Project's repository. GitHub can't assign an issue to an App, so the label is how you say "this one is
for that Agent". Make the label in the repository first if it has none by that name.

deevy hands the issue to the Agent and starts a Run, which waits until the Agent picks it up.

To send the Agent every open issue that no label names, as deevy hears of each, choose it as the
Project's **Default Agent**, under **Settings › Projects**.

## Watch the Run

Open **Runs** in the sidebar. The Run shows **Waiting to start** until the Agent takes it, then
**Working**, and its page shows what the Agent does as it goes. When it changes code, it opens a pull
request on GitHub. It ends **Finished** or **Failed**.

If your Project lists Checkpoints, such as `plan` before the Agent writes code or `ship` before it
finishes, the Agent stops at a Gate at each one, and the Run shows **Waiting on a ruling** until a Human
rules: in deevy, or with `/approve` in a comment on the issue
([How a Gate asks](/gates/how-a-gate-asks/)).

As its Sponsor, you also see its Runs on **Needs me**, under **Your Agents' Runs**, while they are
going.

## Next

- [Agents](/agents/overview/): keys, schedules, and what an Agent may do.
- [How a Gate asks](/gates/how-a-gate-asks/), and how a Human answers.
