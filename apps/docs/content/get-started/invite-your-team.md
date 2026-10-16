---
title: Invite your team
description: Bring your team into a deevy Cloud Workspace, one person at a time by invitation or everyone who matches a rule.
sidebar:
  order: 3
---

There are two ways in, and an admin finds both under **Settings › General**:

- An **invitation** lets in one person, by email address.
- A **rule** under **Who may join** lets in everyone who matches it, such as your email domain or your
  GitHub organization, and goes on letting in new people as they arrive.

Your team doesn't need an invitation to the deevy Cloud beta: that is only for asking for Workspaces.
Anyone can sign in to your Workspace with GitHub or Google, and your invitations and rules decide who
becomes a Member.

## Invite someone

1. Go to **Settings › General**, and next to **Invited** choose **Invite someone**.
2. Enter their **Email**, and choose a **Role**: **Member**, or **Admin** to run the Workspace with you.
3. Choose **Create invitation**.

deevy emails them the link, from `notifications@mail.deevy.dev`, and also shows it to you once, in case
you'd rather send it yourself. Copy it then if you want it: deevy keeps only a hash of it, so it can't
show it again.

An invitation:

- works for seven days;
- works only for the address it was sent to, so a forwarded link lets nobody else in;
- lets them in whether or not they match any of your rules.

Until it is accepted, it is listed under **Invited**, with how long it has left and whether the email
went. To send a fresh link, because it expired or went astray, choose **Revoke** and invite them again:
an address holds one invitation at a time.

Every invitation counts toward your Workspace's 50 a day, whatever happens to it afterwards
([Daily limits](/cloud/limits/)). To bring in a whole team, a rule is the better tool.

## Let in everyone who matches a rule

1. Go to **Settings › General**, and next to **Who may join** choose **Add rule**.
2. Under **Match on**, choose one:
   - **Email domain**, such as `example.com`: anyone whose GitHub or Google account has a confirmed
     address at that domain. A Google Workspace is an email domain.
   - **GitHub organization**, by its login, such as `acme`: anyone who signs in with GitHub and belongs
     to it.
3. Choose **Add rule**.

A rule is checked each time somebody signs in, so a teammate who signed in before you added it joins
the next time they sign in. Everyone a rule lets in joins as a Member; make someone an admin under
**Settings › Members**. Removing a rule (the **×** beside it) lets nobody else in by it, and leaves the
Members it already let in.

:::note[An organization that restricts apps]
If your GitHub organization restricts which OAuth apps may see it, deevy can't tell who belongs to it
until one of its owners approves deevy, once, in the organization's settings on GitHub under
**Third-party access**. Until then the rule lets nobody in; invitations still work.
:::

There is no GitLab group rule on deevy Cloud: it would match only people who sign in with GitLab, and
deevy Cloud doesn't offer GitLab sign-in. For a team that works in GitLab, use an email domain or
invitations.

## What a new Member sees

An invitation arrives as an email saying who invited them to which Workspace, with an **Accept the
invitation** button. It opens the Workspace's sign-in page, which tells them an invitation is waiting;
they sign in with the address it was sent to, and they're in. Someone a rule lets in simply signs in.

Either way, they land on **Needs me**: the Gates waiting on their ruling, the Runs waiting on their
answer, and what their own Agents are doing. Until there is any, it says **Nothing needs you**. The
sidebar also has:

- **Inbox**, their Notifications ([The inbox](/notifications/inbox/));
- **Runs**, what the Workspace's Agents have been doing;
- **Work**, every Issue deevy has brought in from your tools, to read: the work itself stays in the
  tools.

Under **Settings**, in the **You** group, each Member chooses how they're told
(**Notifications**), links their accounts on your tools so they can rule from there (**Identities**),
and connects their own MCP client, such as Claude Code (**MCP clients**).

A Member can add Agents and rule on Gates. An admin can also connect tools, bind Projects, decide who
joins, and change a Member's role or suspend them under **Settings › Members**.

## Next

- [Connect your first tool](/get-started/connect-a-tool/).
