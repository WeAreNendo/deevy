---
title: The Event log
description: Every change in a Workspace is an Event. A record's history, live screens, the Inbox, Slack, email, webhooks and the comments on your tracker all read the same log.
sidebar:
  order: 7
---

Everything that changes in a Workspace appends one **Event**: what changed, which Member did it, and when.
An Event is never edited or removed, and each one has a number, its `seq`, that gives its place in the log.

A change that came from one of your tools, such as a record edited on GitHub, names the account that made
it there, and no Member. A Ruling is the exception: an `/approve` in your tracker or a click in Slack names
the Human whose account it was.

## One log, read everywhere

deevy keeps no second account of what happened. Everything you see about the past is read from the Event
log:

- **A record's history**, on its page under **Work**.
- **Live screens.** Pages update as Events arrive, without a reload.
- **Notifications.** Who is told about something, in the Inbox, in Slack or by email, is worked out from the
  Event alone. See [Needs me and the Inbox](/notifications/inbox/).
- **Your tracker.** The comments deevy writes on a record are rendered from the Gate's and the Run's Events.
- **Webhooks.** A webhook delivery is the Event itself. See [Webhooks](/webhooks/).

## Reading it

**Settings › Event log** shows the log, newest first, to every Member. Invitations are the one part kept
to admins: a Member who isn't an admin doesn't see their Events, here or anywhere else the log is read.
Filter it by **Kind**, **Subject** and **Project**, and click an Event to see everything it carries.

An Event's kind is its subject and what happened to it, such as `issue.assigned`, `run.started` or
`gate.approved`. The families are:

| Family                                           | What they record                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `issue.*`                                        | A record arriving, changing, being routed to an Agent, closing or reopening                    |
| `comment.*`                                      | A comment on a record                                                                          |
| `delegation.*`                                   | A sub-issue an Agent was not allowed to open                                                   |
| `run.*`                                          | A Run starting, its Activity, waiting, being answered, finishing or failing                    |
| `gate.*`                                         | A Gate asked, approved, rejected or superseded, each approval, and a Ruling that ruled nothing |
| `workspace.*`                                    | The Workspace made, and its settings changed                                                   |
| `member.*`                                       | Members joining, changing role, suspended and reinstated                                       |
| `allowlist.*`, `invitation.*`                    | Who may join: rules added and removed, invitations made, revoked and accepted                  |
| `agent.*`                                        | Agents created, their keys issued and revoked, their Sponsor and grants changed                |
| `identity.*`                                     | An account on a tool linked to a Human, or unlinked                                            |
| `socket.*`                                       | Tools connected, changed and removed                                                           |
| `project.*`                                      | Projects bound, changed and archived                                                           |
| `channel.*`, `routing.*`, `webhook.*`, `email.*` | Where Notifications and deliveries go, and any that could not be delivered                     |

Every Member can read most of the log, so deevy keeps credentials out of it: a webhook's secret and an invitation's
link are never recorded, and a Slack incoming webhook's URL, which works as a password, appears only as its
host.

## Following it

- **A webhook** posts each Event you subscribe to as it happens. See [Webhooks](/webhooks/).
- **The CLI**: `deevy events watch` follows the log and picks up where it left off. See
  [The CLI](/mcp-and-cli/cli/).
- **The API** reads the log from any `seq` onwards, or streams it as it happens. See the
  [API reference](/api/).
