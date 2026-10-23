---
title: Channels and routing
description: Send Notifications to a Slack room or a team email address, and choose which kinds go where with routing rules.
sidebar:
  order: 2
---

Every Human's Notifications reach their own Inbox. **Channels** take them further, to the places your team
already watches: a Slack room, or a shared mailbox. **Routing rules** say which Notifications go to which
Channel. An admin sets up both under **Settings › Channels**.

## Add a Channel

There are three kinds.

### A Slack room, through an incoming webhook

The simplest: deevy posts a line and a link to the record, and takes no clicks back.

1. Make an [incoming webhook](https://api.slack.com/messaging/webhooks) in Slack for the room.
2. Under **Settings › Channels**, give the Channel a **Name**, such as `#deevy`, and paste the
   **Incoming webhook URL**.
3. Choose **Add Channel**.

The webhook URL works as a password, so deevy keeps it to itself: the Event log records only its host.

### A room in your Slack app

Once your Workspace has a Slack app connected, a Gate routed to a room in it arrives with **Approve** and
**Reject** on it, and the message changes when somebody rules, wherever they rule. Anything else routed
there is a line and a link, as with a webhook. See [Slack](/tools/slack/) to connect the app.

1. In Slack, invite the app to the room: `/invite @deevy`.
2. Copy the room's channel ID from its details in Slack, such as `C0123ABCD`.
3. Under **Settings › Channels**, give it a **Name**, paste the **Slack channel ID**, and choose
   **Add room**. With more than one Slack app connected, choose the **Slack app** too.

### A team email address

A shared mailbox, such as your team's approvals list.

1. Under **Settings › Channels**, enter the **Team email address** and choose **Add address**.
2. deevy emails the address a link first. Until somebody there opens it and chooses **Confirm this
   address**, the Channel says **Waiting for confirmation** and nothing is sent there.

That way an admin can never point deevy at somebody else's mailbox. See [Email](/notifications/email/).

### Test it

**Test** beside a Channel sends to it now and says what came back, so a wrong URL or a missing invitation
shows up straight away rather than when a Gate never arrives. For an address still waiting to be confirmed,
**Test** sends the confirmation again. **Remove** deletes the Channel and the rules that send to it.

## Route Notifications to it

Under **Routing**, each rule sends one kind of Notification from one Project to one Channel:

1. Choose **Add rule**.
2. Choose the **Notification**: a kind, such as **Gate awaiting**, or **Any**.
3. Choose the **Project**, or **Any**.
4. Choose the **Channel**.
5. Choose **Save routing**.

So "everything to `#deevy`" is one rule, with **Any** and **Any**, and "Gates on the `platform` Project to
`#platform`" is another. The rules are saved together.

The kinds are **Mention**, **Assignment**, **Gate awaiting**, **Run awaiting input**, **Run finished** and
**Sub-issues**. For Gates to arrive with buttons, route **Gate awaiting** to a room in your Slack app.

## How it is decided

- **Who a Notification concerns comes first**, from what happened alone. A Channel changes where people
  hear about it, never who it concerns.
- **One message per Channel.** A Channel is a room, so three Humans concerned by one Event are one message
  there, not three.
- **A Slack room respects its people.** A room gets a kind only while at least one Human it concerns keeps
  **Slack** ticked for that kind under **Settings › Notifications**.
- **A team address gets everything its rules name**, whatever anybody's own settings say: it is the admin's
  choice of mailbox.
- **Direct messages are personal.** A Human whose Slack account is linked under **Settings › Identities**
  also gets a direct message from the Slack app, unless they untick **Direct message** for that kind.
  Signing in with Slack doesn't link it on its own; the first click on **Approve** or **Reject** in a room
  does, and so does `/deevy link`.

If Slack refuses a message, deevy tries it again, and gives up after six attempts.

:::note[Self-hosted]
Slack messages link back to the record, so deevy sends them only once it knows its own URL
(`BETTER_AUTH_URL`); until then they wait. For the buttons in a Slack app's room to work, Slack has to reach
your deevy over public HTTPS. See [Configuration](/self-hosting/configuration/).
:::

## Next

- [Email](/notifications/email/)
- [Needs me and the Inbox](/notifications/inbox/)
