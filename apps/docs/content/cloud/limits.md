---
title: Daily limits
description: How many invitations and emails a deevy Cloud Workspace can send in a day during the beta, and what happens when it reaches the limit.
sidebar:
  order: 3
---

During the beta, each Workspace can, in any 24 hours:

| What             | How many |
| ---------------- | -------- |
| Invitations made | 50       |
| Emails sent      | 500      |

Every Workspace on deevy Cloud sends its email through one shared sender, whose allowance and reputation
belong to everybody. The limits keep one team's invitations from hurting everyone else's email.

A day here is the last 24 hours, rolling, not a calendar day: there is no midnight when the count goes
back to nought. Notifications in the inbox and in Slack count toward neither limit.

## Invitations

Every invitation counts the moment it is made, whether it is emailed, accepted or revoked afterwards.
At 50, **Create invitation** is refused with a message saying when you can invite somebody again, such
as:

> This Workspace can make 50 invitations a day, and has. You can invite somebody again in about 3 hours.

To bring in a whole team, add a rule under **Who may join** instead: your email domain or your GitHub
organization lets in everyone who matches it, and rules aren't limited
([Invite your team](/get-started/invite-your-team/)).

## Emails

What counts is every email your Workspace sends somebody: a Human's Notifications by email, what goes to
a team address, and invitations. It counts them through a sender of your own, too, if an admin set one
under **Settings › Email**. An email sent the moment an admin asks for it, such as **Send a test email**
or the confirmation a new team address gets, doesn't count.

At 500, nothing is lost or given up on. What is owed waits, and goes out as the 24 hours roll on and
there is room again.

An admin sees where the Workspace stands under **Settings › Email**: how many emails went in the last
24 hours and, once it is at the limit, how many are waiting and when the next can go.

## Today's counts in the console

In the deevy Cloud console, under **Your Workspaces**, choose **Manage** on your Workspace. Its **Usage**
shows **Invitations today** and **Emails today**, each against its limit, beside its Humans, Agents,
Sockets and **Runs this month**. "Today" there is the same last 24 hours the limits count.
