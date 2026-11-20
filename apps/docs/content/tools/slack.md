---
title: Slack
description: Create deevy's Slack app from its manifest, and post a Project's Gates in a channel, each with a link to rule on it in deevy.
sidebar:
  order: 6
  badge:
    text: Preview
    variant: caution
---

:::caution[Preview]
deevy's Slack Socket is built and tested against Slack's recorded answers, and has not yet been tried
against Slack itself. Settings says **Preview** beside it until it has.
:::

A Slack Socket is a Slack app made from deevy's manifest. It holds no records, so no Project takes its
records from it. It is where deevy announces: a Project bound to a channel posts each of its Gates there,
with a link to rule on it in deevy. deevy only posts. Slack sends deevy nothing, so there is no address to
give Slack and no secret to keep.

## Create the app and connect it

You need to be an admin in deevy, and able to install apps in your Slack workspace.

1. In deevy, go to **Settings › Sockets** and choose **Connect Slack**.
2. Give it a **Name**, such as `Acme's Slack`. The dialog shows the **App manifest**.
3. Choose **Copy the manifest**.
4. In Slack, choose [Create New App](https://api.slack.com/apps?new_app=1), then **From a manifest**, pick
   your Slack workspace, and paste the manifest.
5. Install the app to your Slack workspace.
6. Back in deevy, paste the **Bot User OAuth Token**, which starts `xoxb-` and is under **OAuth &
   Permissions** in the app's settings.
7. Choose **Connect**.

deevy asks Slack who the token belongs to. A user's token, rather than the app's, is refused, because deevy
would post as that person.

### What the app asks for

| Scope           | Why                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `chat:write`    | To post a Gate with a link to rule on it in deevy, and change the message when somebody rules. |
| `channels:read` | To list the public channels the app is in, for a Project's **Chat**.                           |
| `groups:read`   | To list the private channels the app is in, likewise.                                          |

Nothing about people, no command and no interactivity: deevy only posts.

### An app made from an earlier manifest

An app made from an earlier manifest goes on posting as it did. You can tidy it in the app's settings in
Slack:

- **Interactivity and the `/deevy` command.** deevy takes nothing from Slack now, so turn off
  **Interactivity & Shortcuts**, remove the `/deevy` command under **Slash Commands**, and remove the
  `commands` scope, then reinstall the app. Until you do, a click on a button of a message deevy posted
  earlier rules nothing, and the message loses its buttons the next time deevy changes it.
- **`im:write` in place of `channels:read` and `groups:read`.** Such an app still posts, but a Project's
  **Chat** can't list its channels and asks for the channel's id instead. To pick from the list, add
  `channels:read` and `groups:read` under **OAuth & Permissions**, then reinstall the app. deevy doesn't
  use `im:write`, so you can remove it.

## Post a Project's Gates in a channel

Each Project chooses its own channel, under **Chat** in its settings.

1. In Slack, invite the app to the channel: `/invite @deevy`.
2. In deevy, go to **Settings › Projects**, open the Project, and under **Chat** choose your Slack Socket in
   **Post Gates in**.
3. Choose the **Channel** from the list, or choose **Type its id…** and paste the channel's id from its
   details in Slack, such as `C0123ABCD`.
4. Choose **Save and say hello**.

deevy posts a line in the channel to prove it can, and binds the channel only if Slack takes it. When Slack
refuses, deevy says so with Slack's own code: a channel the app was not invited to answers that deevy is not
in that channel, and to `/invite @deevy` there. See
[Post a Project's Gates in a chat channel](/needs-me/#post-a-projects-gates-in-a-chat-channel).

## What the channel sees

A Gate arrives in the Project's channel as one message, with its Proposal, its count and **Rule on it in
deevy**, a link to the Gate's page. Whoever may rule opens it, signs in to deevy if they aren't already, and
rules there. Nothing in Slack rules: the message has no buttons, and deevy reads nothing anybody writes in
the channel.

When somebody rules, deevy changes the same message to say so, and once the Gate is decided its link says
**Open it in deevy**. See [What the message looks like](/needs-me/#what-the-message-looks-like).

The Socket's page has no delivery address, no secret and no list of deliveries, since Slack never sends deevy
anything. **Settings › Sockets** says **Posts here** beside it.

:::note[Self-hosted]
Each message links to your deevy at its `BETTER_AUTH_URL`, and deevy posts only once that is set. Slack
never calls deevy, so a deevy Slack cannot reach, on a laptop or behind a firewall, posts its Gates all the
same.
:::

## Disconnect

On the Socket's page, choose **Disconnect**, then **Disconnect it**. deevy drops the token, and every
Project that posted its Gates through it posts nowhere from then on, which its history says. Delete the app
in Slack if you no longer want it.
