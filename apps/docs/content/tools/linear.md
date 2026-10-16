---
title: Linear
description: Connect a Linear workspace through an OAuth application of your own, bind a Project to a team, and let people assign issues to deevy.
sidebar:
  order: 3
---

A Linear Socket is one Linear workspace, reached through an OAuth application you make there. deevy acts as
the application itself, not as whoever connected it, so every comment and label it writes is the
application's. A Project is bound to one Linear team, and that team's issues are its records.

## Connect Linear

You need to be an admin in deevy, and able to create an OAuth application in Linear.

1. In deevy, go to **Settings › Sockets** and choose **Connect Linear**.
2. Give it a **Name**, such as `Acme on Linear`, and choose **Show the addresses**. deevy starts the
   Socket so it can show you the three addresses Linear needs, with their real values.
3. In Linear, open **Settings › API › New OAuth application**. Call the application `deevy`: that is the
   name every comment deevy writes appears under.
4. Under **Callback URLs**, paste both addresses deevy shows under **Callback URLs**, one per line. The
   first is where people come back after linking their Linear account, the second where an admin comes
   back after installing deevy as an agent.
5. Turn on **Client credentials**. This is how deevy works as the application: it mints its own token from
   the client ID and secret whenever it needs one.
6. Turn on webhooks, paste the **Webhook URL** deevy shows, and choose **Issues** and **Comments**. Leave
   agent session events off; deevy does not answer them.
7. Save the application in Linear, then paste its **Client ID**, **Client secret** and **Webhook signing
   secret** into deevy, and choose **Connect**.

deevy asks Linear who it is there, and in which workspace. A credential Linear does not accept is refused
with Linear's own words, and nothing is stored. When it works, deevy says **Connected as** and the
application's name.

A Socket you started and did not finish stays on the Sockets page as **Not connected yet**. Disconnect it
there and start again.

## Let people assign issues to deevy

With the Socket connected, a label already hands an issue to an Agent. To let people assign an issue to
deevy in Linear as well, a Linear admin installs deevy as an agent, once:

1. Choose **Install deevy as an agent**, right after connecting or on the Socket's page under
   **Assigning issues to deevy**.
2. Linear shows its own install page. Approve it, and Linear sends you back to deevy.

After that, assigning an issue to deevy in Linear makes the application the issue's delegate, and the
Human who assigned it stays its assignee. The Project's **Default Agent** takes the issue. A Project with
no default Agent routes nothing this way; a label still works.

## Bind a Project to a team

1. Go to **Settings › Projects** and choose **Bind a Project**.
2. Choose the Linear Socket as the **Tool**, and a team as the **Container**. Teams are listed by name and
   key, such as `Engineering (ENG)`.
3. Name the Project, and choose **Bind it**.

Linear holds no code, so set the Project's **Repository** to a GitHub or GitLab repository if its Agents
should push. Without one, they read, plan and comment.

## Hand an issue to an Agent

- **Label it** `agent:<handle>`, such as `agent:planner`, for an Agent granted the Project. deevy reads the
  label by its name.
- **Assign it to deevy**, once deevy is installed as an agent, and the Project's **Default Agent** takes it.
- **Set the Project's Default Agent**, which takes any open issue nobody named.

An issue in a workflow state of type completed or canceled is closed in deevy, whatever the team named the
state. So is a deleted issue.

## What deevy writes in Linear

- **Comments**, as the Project's **Mirror** says: a Gate asking for a Ruling, each Ruling, and with **Runs as
  well**, each Run starting, finishing or failing. With **Runs as well**, deevy also comments when an Agent
  opens a pull request, because Linear cannot see a repository by itself. See
  [Connecting your tools](/tools/overview/#what-deevy-writes-back).
- **The `deevy:awaiting-approval` label** while a Gate waits. deevy makes it in the team the first time it
  needs it.
- **Sub-issues**, which an Agent opens as Linear's own sub-issues of the issue it is working.

Linear signs each delivery with the moment it sent it, and deevy refuses one more than a minute old.

## Rule from Linear

A Human can approve or reject a Gate by commenting `/approve` or `/reject <why>` on the issue. If you sign
in to deevy with Linear, with an account in the Socket's Linear workspace, your comments already count as
you. Otherwise link it once: under **Settings › Identities**, choose **Link Linear** and consent on Linear's
own page. An account in a different Linear workspace is refused. See
[Ruling from your tools](/gates/ruling-from-your-tools/).

## Rotate the client secret

Rotating the application's client secret in Linear ends every token deevy made with the old one. Connect
the Socket again with the new secret.

:::note[deevy Cloud]
The addresses deevy shows are under your Workspace's own address, `https://app.deevy.dev/<address>/…`. The
OAuth application is yours, in your Linear workspace, and nobody else's Workspace uses it.
:::

:::note[Self-hosted]
The addresses are built from your deevy's `BETTER_AUTH_URL`, and Linear has to reach the webhook over
HTTPS. If your deevy's address changes, paste the new webhook URL and callback URLs into the application in
Linear again. Until then deevy asks Linear what changed, but hears no new comment.
:::

## Disconnect

On the Socket's page, choose **Disconnect**, then **Disconnect it**. deevy drops the client secret and stops
taking Linear's deliveries; the issues it projected and the Runs on them stay readable. Delete the OAuth
application in Linear if you no longer want it.
