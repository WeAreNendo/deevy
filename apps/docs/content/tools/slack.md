---
title: Slack
description: Create deevy's Slack app from its manifest, route Gates to a channel, and approve or reject them with a button.
sidebar:
  order: 6
---

A Slack Socket is a Slack app made from deevy's manifest. It holds no records, so no Project is bound to it.
It is where deevy asks: a Gate arrives in a channel with **Approve** and **Reject** buttons, and a Human
whose Slack account is linked can be told by direct message too.

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

| Scope        | Why                                                                                |
| ------------ | ---------------------------------------------------------------------------------- |
| `chat:write` | To post a Gate with **Approve** and **Reject**, and change it when somebody rules. |
| `im:write`   | To send a direct message to a Human who linked their Slack account.                |
| `commands`   | For `/deevy link`, which is how a Human links their Slack account.                 |

Nothing about people: a click already says who clicked.

## Route Gates to a channel

1. In Slack, invite the app to the channel: `/invite @deevy`.
2. Copy the channel's ID from its details in Slack. It looks like `C0123ABCD`.
3. In deevy, go to **Settings › Channels**. In the form for a room in your Slack app, which appears once
   a Slack Socket is connected, give it a **Name**, such as `#approvals`, paste the **Slack channel ID**,
   and choose **Add room**.
4. Under **Routing**, choose **Add rule**. Set **Notification** to **Gate awaiting**, choose a **Project** or
   leave it at **Any**, and choose the new **Channel**. Choose **Save routing**.
5. Choose **Test** beside the Channel to post a message there now.

When Slack refuses something, deevy says so with Slack's own code. A Test in a channel the app was not
invited to answers that deevy is not in that channel, and to `/invite @deevy` there.

See [Channels](/notifications/channels/) for the other Notifications you can route.

## Rule from Slack

A Gate arrives in the channel with its Proposal and three buttons: **Approve**, **Reject** and **Open in
deevy**. **Approve** rules at once; **Reject** asks why first. When anybody rules, in Slack, in deevy or in the tracker, deevy changes the message to say so:
the click is answered straight away and the message a moment later.

A click counts only for a Slack account deevy can place as a Member:

- **If you sign in to deevy with Slack**, to the same Slack workspace, your clicks already count as you.
- **Otherwise, link your account once.** Click a button before you are linked, or type `/deevy link` in
  Slack, and Slack shows you a code only you can see. In deevy, go to **Settings › Identities**, enter it
  under **Link with a code** in **Code from Slack**, and choose **Check the code**. deevy names the account
  the code would link; if it is yours, choose to link it. A code lasts ten minutes.

A guest from another Slack workspace in a shared channel links the same way. See
[Ruling from your tools](/gates/ruling-from-your-tools/).

## Direct messages

Once your Slack account is linked, the app also tells you by direct message when a Notification you have
turned on arrives. Choose which under **Settings › Notifications**, in the **Direct message** column.

## A channel with no app

A Slack channel can also be a Channel through an incoming webhook: under **Settings › Channels**, give it a
**Name** and its **Incoming webhook URL**, and choose **Add Channel**. deevy then posts a link to each Gate,
and there is nothing to click in Slack.

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
Slack's requests; the rooms routed to it stop receiving. Delete the app in Slack if you no longer want it.
