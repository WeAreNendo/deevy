---
title: Needs me and chat
description: What waits on you in deevy is the Gates you may rule on. Find them on Needs me, and have a Project post each of its Gates in a Slack channel, with a link to rule on it in deevy.
sidebar:
  order: 1
---

deevy asks you for one thing: a Ruling on a Gate. Your tracker tells you everything else about the work, as
it always has: a mention, a comment, a record assigned or closed. deevy keeps no inbox for you and sends you
no email.

A Gate you may rule on is announced in up to three places at once, and each of them leads you to the Gate's
page in deevy, where you rule:

- **Needs me**, deevy's home page.
- **The record in your tracker**, as a comment from deevy with the Gate's link. A reply there, even one
  that starts `/approve`, is only a comment, and rules nothing.
- **The Project's chat channel**, when an admin has bound one, as a message with a link to the Gate.

See [How a Gate asks](/gates/how-a-gate-asks/).

## Needs me

**Needs me** is the first page you see in deevy. It is not a list of work, because the work is in your
tools: it is what is waiting on you, and then what your Agents are doing.

1. **Gates awaiting you**: every open Gate you may approve now, with its Checkpoint, the first line of the
   Proposal, the record's key, the Agent, how long it has waited and its count, such as `0 of 2`. Choose one
   to rule on it. See [How a Gate asks](/gates/how-a-gate-asks/).
2. **Your Agents' Runs**: the Runs you started and the ones your Agents are working, while they are still
   going.

When neither has anything in it, the page says **Nothing needs you**.

A Gate leaves Needs me once you have ruled on it, or once it is decided. A Gate you may only reject, because
its Checkpoint wants somebody other than the Human the work is for and that is you, is not waiting on you,
so it isn't here either; open it from the Run or the record.

## Post a Project's Gates in a chat channel

A Project can post each of its Gates in one Slack channel, so whoever may rule sees it without opening deevy.
An admin binds the channel, once the Workspace has a [Slack Socket](/tools/slack/).

1. In Slack, add deevy's app to the channel: type `/invite @deevy` in it. deevy can't see a private channel
   at all until the app is in it.
2. In deevy, go to **Settings › Projects**, open the Project, and find **Chat**.
3. Under **Post Gates in**, choose your Slack Socket.
4. Under **Channel**, choose the channel. The list holds the channels deevy's app is in. If the one you want
   isn't there, choose **Type its id…** and paste the channel's id from its details in Slack, such as
   `C0123ABCD`.
5. Choose **Save and say hello**.

Saving posts one line in the channel first, to prove deevy can post there:

> deevy will post the Gates of Billing here, each with a link to rule on it in deevy. A Gate waits until
> somebody who may rule on it does.

Only once Slack takes that line is the channel bound. **Chat** then says which channel the Gates are posted
in, and the Project's next Gate is posted there. A Gate asked before you bound the channel isn't posted.

If Slack refuses the line, nothing is saved, and **Chat** says why in Slack's own words: `not_in_channel`
when the app isn't in the channel, `channel_not_found` when the id is wrong, `is_archived` when the channel
is archived. Put it right in Slack and save again.

Each Project posts in one channel at most, and several Projects can share one.

### When Slack lists no channels

A Slack app made before deevy asked to read channels can post, but can't list them. **Chat** then says that
Slack would not list its channels, and asks for the channel's id instead, which works just as well. To pick
from the list, add the scopes deevy now asks for to the app and reinstall it; see
[What the app asks for](/tools/slack/#what-the-app-asks-for).

### Change or stop it

To move the Gates elsewhere, choose another channel or another Slack Socket and save: deevy says hello in
the new channel first. To stop, choose **Nowhere** under **Post Gates in** and **Save**; the Project's Gates
then wait on Needs me and in the tracker. A Gate already posted keeps its message, and deevy keeps that
message up to date.

Removing a Slack Socket under **Settings › Sockets** unbinds every Project that posted through it, and each
Project's history says so. Pausing it keeps the binding, but a Gate asked while it is paused is never posted,
even after you resume it, and the **Chat** section says the tool is paused. Such a Gate still waits on Needs
me and in the tracker.

If Slack keeps refusing a Gate's message, deevy tries six times over about a quarter of an hour, then stops
and records it in the Socket's history, under **Settings › Event log**.

## What the message looks like

Each Gate is one message in the channel:

- **Waiting on a ruling at the `plan` Checkpoint**, and the record's key, linking to the record;
- the Proposal, as the Agent wrote it, cut short if it is very long;
- the count, such as **0 of 2 approvals**, the Agent that asked, and its Run;
- every Ruling so far, such as "Ada approved";
- **Rule on it in deevy**, a link to the Gate's page.

The message has no buttons, and nothing said in the channel rules: you rule on the Gate's page, signed in to
deevy, under the Checkpoint's rules. When anybody rules, deevy changes that same message rather than posting
another. Once the Gate is decided, the message says **Ruled**, with **Approved**, **Rejected** or
**Superseded by a newer Proposal**, and its link says **Open it in deevy**.

:::note[deevy Cloud]
There is nothing to set up: each message links to your Workspace's own address.
:::

:::note[Self-hosted]
Each message links back to deevy, so deevy posts in chat only once it knows its own address,
`BETTER_AUTH_URL`; until then the Gates wait to be posted. Slack never sends deevy anything, so a deevy
Slack cannot reach posts all the same. See [Configure deevy](/self-hosting/configuration/).
:::

## An Agent's inbox

An Agent does have an inbox, because that is how it hears about its work: a record routed to it, a comment
that mentions it, and the Ruling on a Gate it asked at. A Human has none, and calling it as a Human is
refused. See [Bringing your own harness](/agents/your-own-harness/#work-a-record).

## Next

- [How a Gate asks](/gates/how-a-gate-asks/)
- [Slack](/tools/slack/)
