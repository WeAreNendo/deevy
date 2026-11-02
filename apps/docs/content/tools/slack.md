---
title: Slack
description: Create deevy's Slack app from its manifest, post a Project's Gates in a channel, and approve or reject them with a button.
sidebar:
  order: 6
  badge:
    text: Preview
    variant: caution
---

:::caution[Preview]
deevy's Slack Socket is built and tested against Slack's recorded deliveries, and has not yet been tried
against Slack itself. Settings says **Preview** beside it until it has.
:::

A Slack Socket is a Slack app made from deevy's manifest. It holds no records, so no Project takes its
records from it. It is where deevy asks: a Project bound to a channel posts each of its Gates there, with
**Approve** and **Reject** buttons.

## Create the app and connect it

You need to be an admin in deevy, and able to install apps in your Slack workspace.

1. In deevy, go to **Settings › Sockets** and choose **Connect Slack**.
2. Give it a **Name**, such as `Acme's Slack`, and choose **Show the app manifest**. deevy starts the
   Socket and shows the manifest with your Workspace's own address already in it.
3. Choose **Copy the manifest**.
4. In Slack, choose [Create New App](https://api.slack.com/apps?new_app=1), then **From a manifest**, pick
   your Slack workspace, and paste the manifest.
5. Install the app to your Slack workspace.
6. Back in deevy, paste the **Bot User OAuth Token**, which starts `xoxb-` and is under **OAuth &
   Permissions** in the app's settings, and the **Signing Secret**, which is under **Basic Information**.
7. Choose **Connect**.

deevy asks Slack who the token belongs to. A user's token, rather than the app's, is refused, because deevy
would post as that person.

### What the app asks for

| Scope           | Why                                                                                |
| --------------- | ---------------------------------------------------------------------------------- |
| `chat:write`    | To post a Gate with **Approve** and **Reject**, and change it when somebody rules. |
| `channels:read` | To list the public channels the app is in, for a Project's **Chat**.               |
| `groups:read`   | To list the private channels the app is in, likewise.                              |
| `commands`      | For `/deevy link`, which is how a Human links their Slack account.                 |

Nothing about people: a click already says who clicked.

An app made from an earlier manifest asks for `im:write` instead of `channels:read` and `groups:read`. It
still posts, but a Project's **Chat** can't list its channels and asks for the channel's id instead. To pick
from the list, add `channels:read` and `groups:read` under **OAuth & Permissions** in the app's settings,
then reinstall the app to your Slack workspace. deevy no longer uses `im:write`, so you can remove it.

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

## Rule from Slack

A Gate arrives in the Project's channel as one message, with its Proposal and three buttons: **Approve**,
**Reject** and **Open in deevy**. **Approve** rules at once; **Reject** asks why first. When anybody rules, in Slack, in deevy or in the tracker, deevy changes the message to say so:
the click is answered straight away and the message a moment later.

A click counts only for a Slack account deevy can place as a Member:

- **If you sign in to deevy with Slack**, to the same Slack workspace, your clicks already count as you.
- **Otherwise, link your account once.** Click a button before you are linked, or type `/deevy link` in
  Slack, and Slack shows you a code only you can see. In deevy, go to **Settings › Identities**, enter it
  under **Link with a code** in **Code from Slack**, and choose **Check the code**. deevy names the account
  the code would link; if it is yours, choose to link it. A code lasts ten minutes.

A click that rules nothing, from an account not linked yet or one the Checkpoint's rules refuse, is answered
privately: only the person who clicked sees why, and the message stays as it was.

A guest from another Slack workspace in a shared channel links the same way. See
[Ruling from your tools](/gates/ruling-from-your-tools/).

## Rotate the signing secret

Slack makes the signing secret, and takes none that deevy could make, so you rotate it in Slack and give
deevy the new one:

1. In the app's settings in Slack, under **Basic Information**, regenerate the **Signing Secret** and copy
   it.
2. In deevy, open the Socket's page under **Settings › Sockets**. Under **What it signs with**, paste it
   into **New secret from Slack** and choose **Use the new secret**.

deevy keeps accepting the old secret for a day, so you can change the two in either order.

The [CLI](/mcp-and-cli/cli/) does the same, with the Socket's id from its page's address:

```bash
deevy sockets update <socket id> --webhook-secret <the new signing secret>
```

Slack signs every request with a timestamp, and deevy refuses one more than five minutes from its own clock.

:::note[deevy Cloud]
The manifest carries your Workspace's own address, `https://app.deevy.dev/<address>/hooks/…`, which Slack
can always reach.
:::

:::note[Self-hosted]
The manifest carries an address built from your deevy's `BETTER_AUTH_URL`. A deevy Slack cannot reach can
still post to Slack, but never hears a click or a `/deevy link`.
:::

## Disconnect

On the Socket's page, choose **Disconnect**, then **Disconnect it**. deevy drops the token and stops taking
Slack's requests, and every Project that posted its Gates through it posts nowhere from then on, which its
history says. Delete the app in Slack if you no longer want it.
