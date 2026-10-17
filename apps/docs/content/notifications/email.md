---
title: Email
description: What deevy emails you, how to choose and stop it, team addresses, and invitations by email.
sidebar:
  order: 3
---

deevy emails three things: what is waiting on you, Notifications your admin routes to a team address, and
invitations.

## Your own email

deevy emails you about what is waiting on you: a Gate you may approve, and a Run waiting for your answer. You
can choose more, or less, under **Settings › Notifications**.

deevy only ever writes to an address your sign-in confirmed. **Settings › Notifications** says which, under
the table: "Email goes to" your address. If the account you signed in with didn't confirm one, as a Linear or
an Atlassian sign-in doesn't, it says so, and the **Email** column can't be ticked.

### Choose what is emailed

1. Open **Settings › Notifications**.
2. Tick or untick each kind in the **Email** column.
3. Choose **Save**.

By default, only **Gate awaiting** and **Run awaiting input** are ticked.

A few things deevy does for you:

- **One email per thing that happened.** If one Event concerns you twice, you get one email.
- **No stale email.** An email about a Gate already ruled on, or a Run already answered, by the time it would
  go out is not sent.

### Stop an email

Every email deevy sends you has a **Stop emails like this one** link, and your mail app's own unsubscribe
works too. The link opens a page that asks first, so a mail scanner opening it changes nothing: choose
**Stop these emails** to turn that kind off. It only stops the emails; your Inbox and Slack carry on as they
were. Turn it back on under **Settings › Notifications** whenever you like.

## Team addresses

An admin can add a shared mailbox, such as your approvals list, as a Channel under **Settings › Channels**.
deevy emails it a confirmation link first and sends it nothing until somebody there confirms. From then on,
each Notification routed there is one email, whoever it concerns. To stop it, remove the Channel or its
rules. See [Channels and routing](/notifications/channels/).

## Invitations

When an admin invites somebody under **Settings › General** with **Invite someone**, deevy emails them the
link, which is good for seven days. The dialog says **Emailing the link to** their address, or why it was
not emailed, and shows you the link once either way so you can send it yourself. The invitation's row then
says **Emailed**, **Email on its way**, or **Email failed** with the reason. See
[Invite your team](/get-started/invite-your-team/).

## The sender

Admins see under **Settings › Email** which service the Workspace sends through and as what address, and
can **Send a test email** to themselves to check it arrives.

If a sending service refuses an email for good, deevy gives up on it at once and records why in the
[Event log](/concepts/events/); a busy or unavailable service is tried again for a while.

:::note[deevy Cloud]
Email comes from `notifications@mail.deevy.dev`, with nothing to set up. A Workspace may send a set number
of emails a day; **Settings › Email** shows how many have gone in the last 24 hours, and any over the limit
wait for room rather than being lost. See [Limits](/cloud/limits/).
:::

:::note[Self-hosted]
deevy emails nothing until it has a sender. Set one in the environment, or as an admin under
**Settings › Email › Set the sender here**, which takes over from the environment's until you choose
**Use the environment's sender**. Without a sender, emails deevy would have sent are dropped rather than
saved for later. See [Email](/self-hosting/email/).
:::

## Next

- [Needs me and the Inbox](/notifications/inbox/)
- [Channels and routing](/notifications/channels/)
