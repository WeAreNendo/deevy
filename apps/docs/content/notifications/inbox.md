---
title: Needs me and the Inbox
description: Needs me shows what is waiting on you right now; the Inbox lists every Notification you were sent. What lands where, and how to choose what reaches you.
sidebar:
  order: 1
---

deevy has two screens for what concerns you. **Needs me** is what is blocked on you right now. The
**Inbox** is everything you were told about, read or not.

## Needs me

**Needs me** is deevy's home page. It is not a list of work, because the work is in your tools: it is what
is waiting on you, in the order it blocks somebody.

1. **Gates awaiting you**: every open Gate you may rule on now, with its Checkpoint, the first line of the
   Proposal, the record's key, the Agent, how long it has waited and its count. Choose one to rule on it.
   See [How a Gate asks](/gates/how-a-gate-asks/).
2. **Runs awaiting your answer**: Runs you are behind that asked a question rather than a Gate. You answer
   one from your own MCP client: see [Your own MCP client](/mcp-and-cli/your-own-mcp-client/).
3. **Your Agents' Runs**: the Runs you started and the ones your Agents are working, while they are still
   going.

When none of those has anything in it, the page says **Nothing needs you**.

## The Inbox

The **Inbox** is one list of your Notifications, newest first, and the number beside it in the sidebar is how
many you haven't read. Each row says who did what, on which record, and quotes what they said: "wants your
ruling at plan", "mentioned you", "finished a Run", "asks a question".

- Choose **All** or **Unread** to see everything or only what you haven't read.
- Choose a row to open it. On a wide screen it opens beside the list: the Gate itself for a Gate, the record
  for anything else. Opening a row marks it read.
- **Mark read** on a row marks just that one. Tick several and choose **Mark read** above the list to mark
  them together, or **Mark all read** for the lot.

From the keyboard: `j` and `k` move through the list, `e` marks the open one read, `⇧E` marks everything
read, `x` ticks a row, and `o` opens the record where it lives.

## What lands in your Inbox

| Notification           | Who is told                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Mention**            | Whoever a comment on a record mentions by handle.                                                                                                            |
| **Assignment**         | The Member a record is routed to.                                                                                                                            |
| **Gate awaiting**      | Every Human who may rule on the Gate: the ones its Checkpoint names, or every active Human, leaving out the Human the work is for where the Checkpoint does. |
| **Run awaiting input** | The Human behind the Run, when it asks a question: whoever started it, or the Agent's Sponsor.                                                               |
| **Run finished**       | The Human behind the Run, when it finishes or fails.                                                                                                         |
| **Sub-issues**         | An Agent's Sponsor, once when it opens sub-issues under a record, and once when they are all finished.                                                       |

You are never told about something you did yourself, and a suspended Member is told nothing.

If a Gate is still waiting four hours later, its Notification comes back unread for everyone it asked, and
again every four hours until the Gate is decided.

## Choose what reaches you

**Settings › Notifications** is yours alone: every kind of Notification against where it can reach you.

| Column             | Where it goes                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| **Inbox**          | Your Inbox in deevy.                                                                             |
| **Slack**          | The Slack rooms your admin routes Notifications to.                                              |
| **Direct message** | A direct message from your team's Slack app, once your Slack account is linked under Identities. |
| **Email**          | Your own email address, if your sign-in confirmed it.                                            |

Tick what you want and choose **Save**. Until you change anything, you get every kind in the Inbox, in Slack
and by direct message, and by email only a Gate awaiting you and a Run awaiting your answer.

Turning a column off changes where you hear about something, never whether it concerns you: a Gate you may
rule on is still on **Needs me**.

## Next

- [Channels and routing](/notifications/channels/)
- [Email](/notifications/email/)
