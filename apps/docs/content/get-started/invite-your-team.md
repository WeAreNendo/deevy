---
title: Invite your team
description: Bring your team into a deevy Cloud Workspace, one person at a time by invitation or everyone at your email domain.
sidebar:
  order: 3
---

There are two ways in, and an admin finds both under **Settings › General**:

- An **invitation** lets in one person, by email address.
- A **rule** under **Who may join** lets in everyone with a confirmed address at your email domain, and goes
  on letting in new people as they arrive.

Your team doesn't need an invitation to the deevy Cloud beta: that is only for asking for Workspaces.
Anyone can sign in to your Workspace with GitHub or Google, and your invitations and rules decide who
becomes a Member.

## Invite someone

1. Go to **Settings › General**, and next to **Invited** choose **Invite someone**.
2. Enter their **Email**, and choose a **Role**: **Member**, or **Admin** to run the Workspace with you.
3. Choose **Create invitation**.

deevy shows you the link once. Choose **Copy the link**, and send it to them however you like: an email
of your own, a chat message. deevy sends nothing itself, and it keeps only a hash of the link, so it can't
show it again.

An invitation:

- works for seven days;
- works only for the address it was sent to, so a forwarded link lets nobody else in;
- lets them in whether or not they match any of your rules.

Until it is accepted, it is listed under **Invited**, with how long it has left. To send a fresh link,
because it expired, went astray or you didn't copy it, choose **Revoke** and invite them again: an address
holds one invitation at a time.

Every invitation counts toward your Workspace's 50 a day, whatever happens to it afterwards
([Daily limits](/cloud/limits/)). To bring in a whole team, a rule is the better tool.

## Let in everyone at your email domain

1. Go to **Settings › General**, and next to **Who may join** choose **Add rule**.
2. Enter the **Domain**, such as `example.com`: anyone whose GitHub or Google account has a confirmed
   address at that domain joins. A Google Workspace is an email domain.
3. Choose **Add rule**.

A rule is checked each time somebody signs in, so a teammate who signed in before you added it joins
the next time they sign in. Everyone a rule lets in joins as a Member; make someone an admin under
**Settings › Members**. Removing a rule (the **×** beside it) lets nobody else in by it, and leaves the
Members it already let in.

A domain is the only rule there is: deevy doesn't ask GitHub or GitLab who belongs to an organization or a
group. For somebody whose address is elsewhere, such as a contractor, send an invitation.

## What a new Member sees

The link you sent opens the Workspace's sign-in page, which tells them an invitation is waiting; they
sign in with the address it was for, and they're in. Someone a rule lets in simply signs in.

Either way, they land on **Needs me**: the Gates waiting on their ruling, and what their own Agents are
doing. Until there is any, it says **Nothing needs you**. See [Needs me and chat](/needs-me/). The sidebar
also has:

- **Runs**, what the Workspace's Agents have been doing;
- **Work**, every Issue deevy has brought in from your tools, to read: the work itself stays in the
  tools.

A Member can add Agents and rule on Gates. An admin can also connect tools, bind Projects, decide who
joins, and change a Member's role or suspend them under **Settings › Members**.

## Next

- [Connect your first tool](/get-started/connect-a-tool/).
