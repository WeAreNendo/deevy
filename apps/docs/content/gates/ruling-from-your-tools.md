---
title: Ruling from the tracker or Slack
description: Approve or reject a Gate with /approve in a comment on GitHub, Linear, GitLab or Notion, or with the buttons in Slack, once deevy knows the account is yours.
sidebar:
  order: 3
---

You don't have to open deevy to rule on a Gate. Where your team already reads the work, you can approve or
reject it there: with a comment on the record, or with a button in Slack. It is the same Ruling as one made
in deevy, under the same Checkpoint's rules, and the Gate records where it came from.

## With a comment on the record

When a Gate asks, deevy comments on the record with the Proposal and these instructions, if the Project
mirrors Gates. Reply on the record:

```text
/approve
```

or

```text
/reject The migration needs to run before the deploy, not after.
```

- The command is the **first line** of your comment. Anything after `/approve` or `/reject`, on that line or
  below it, is your note. On a rejection, it is what the Agent reads to know what to change.
- A comment that only mentions `/approve` somewhere else is just a comment.
- It rules on the newest Gate waiting on that record.
- The Checkpoint's rules are the same as in deevy. Where it wants somebody other than the Human the work is
  for, and that is you, `/reject` counts and `/approve` gets a reply saying you may still reject it.

You can rule this way even where the Project's **Mirror** is set to **Nothing**, but then deevy says nothing
back. Otherwise it answers on the record either way. A Ruling that counts is followed by deevy's comment
saying where the count stands, such as "Approved: 1 of 2, still waiting". One that rules nothing gets a
reply saying why: the
account isn't linked to anybody in deevy yet (with a link to **Settings › Identities**), nothing on the
record is waiting, or the Checkpoint's own reason, in the same words the Gate's page would use. Comments from
automated accounts, deevy's own included, rule nothing and get no reply.

## With the buttons in Slack

A Gate posted to a room in your team's Slack app, or sent to you as a direct message, comes with
**Approve** and **Reject**. **Reject** asks you why before it sends. The buttons follow the Checkpoint's
rules, so the Human the work is for, where the Checkpoint leaves them out, can reject with them but not
approve. The message changes when anybody rules,
in Slack, in deevy or on the tracker, so the room always shows where the Gate stands. See
[Channels and routing](/notifications/channels/) for sending Gates to a room.

## Your account has to be yours

A comment or a click counts only when deevy can prove which Human made it. It never goes by a display name
or a login, which can be renamed and reused: it matches the tool's own account id against one of your
[Identities](/concepts/humans-and-agents/#identities).

| Tool   | Your account counts when                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub | You sign in to deevy with GitHub, or link GitHub under **Settings › Identities**.                                                                                                           |
| Linear | You sign in to deevy with Linear, with an account in the Socket's Linear workspace, or choose **Link Linear** under **Settings › Identities** and consent on Linear's own page.             |
| GitLab | You sign in to deevy with that GitLab, or link GitLab under **Settings › Identities**. A comment by a project or group access token's account rules nothing.                                |
| Slack  | You sign in to deevy with Slack, to the Socket's Slack team, or link Slack with a code (below).                                                                                             |
| Notion | Notion has no account to link. A comment counts only when an admin turns on **Take a verified address as proof** on the Socket's page, and Notion reports an address you verified in deevy. |

A Ruling proved only by an email address is weaker than an account, so the Gate's page marks it
"(email)".

### Link an account

Open **Settings › Identities** while signed in to deevy:

- Under **Link an account**, choose **Link GitHub**, **Link Linear** or whichever your Workspace offers, and
  approve it on the tool's page. Where you already sign in with a tool, the page says your comments there
  already count.
- For Slack, click **Approve** or **Reject** before you're linked, or type `/deevy link` in Slack. Slack shows
  you a code that only you can see. Enter it under **Link with a code** within ten minutes, choose
  **Check the code**, make sure the account it names is yours, and choose **Link @you to me** (with your
  Slack name).

The table at the top of **Settings › Identities** lists the accounts deevy has linked to you, and how it
knows each is yours. The account you sign in with already counts, and joins the table the first time it
rules. **Unlink** stops one ruling as you, and it stays unlinked until you choose **Link again**.

## When the tool has to reach deevy

A comment and a Slack click only ever reach deevy as the tool's own delivery to it. A record changing still
arrives without one, a little late, but a `/approve` does not.

:::note[deevy Cloud]
Your Workspace is always reachable, so this just works.
:::

:::note[Self-hosted]
Your deevy needs a public HTTPS address the tools can post to. Without one, rule in deevy instead. See
[Connecting your tools](/tools/overview/).
:::

## Next

- [How a Gate asks](/gates/how-a-gate-asks/)
- [Slack](/tools/slack/)
