---
title: GitHub
description: Connect GitHub as a GitHub App deevy writes for you, install it on your repositories, and bind a Project to one for its issues and its code.
sidebar:
  order: 2
---

A GitHub Socket is a GitHub App, and it covers both halves of a Project: the repository's issues are its
records, and the same repository is where its Agents push and where deevy opens their pull requests. deevy
writes the App's settings for you, so GitHub makes it and hands its credentials back without anybody copying
a private key out of a browser.

## Create the GitHub App

You need to be an admin in deevy, signed in to GitHub in the same browser.

1. In deevy, go to **Settings › Sockets** and choose **Connect GitHub**.
2. Give it a **Name**, such as `acme on GitHub`. GitHub names the App with it, and deevy names the Socket.
   GitHub App names are unique across GitHub, so pick one that is yours.
3. If the repositories belong to an organization, put its login on GitHub in **Organization**, such as
   `acme`. Leave it empty for repositories on your own account. See
   [For an organization's repositories](#for-an-organizations-repositories).
4. Choose **Create the App on GitHub**, then **Continue on GitHub**.
5. GitHub shows the App it is about to make, with its webhook already pointed at your Workspace and the
   permissions below. Create it.
6. GitHub sends you straight on to install it. Choose the repositories deevy should work, and install.
7. GitHub sends you back to the Socket's page in deevy, which lists where the App is installed under
   **Where it is installed**.

Create the App within an hour of choosing **Create the App on GitHub**. deevy refuses a return from GitHub
that took longer, and you start again.

An App installed nowhere sees no repository, so nothing can be bound to it. To add repositories later, choose
**Install it on more repositories** on the Socket's page.

### What the App asks for

| Permission    | Access         | Why                                                               |
| ------------- | -------------- | ----------------------------------------------------------------- |
| Issues        | Read and write | To read records, comment on them, label them and open sub-issues. |
| Contents      | Read and write | So an Agent's Run can clone the repository and push a branch.     |
| Pull requests | Read and write | So deevy can open the pull request for a Run.                     |
| Metadata      | Read           | GitHub requires it.                                               |

It listens for issues, issue comments, sub-issues, labels and repositories. It is private, so only the
account that owns it can install it: your own, or the organization you named.

## For an organization's repositories

GitHub installs a private App only on the account that owns it. An App made on your own account can never
be installed on an organization's repositories, so for those the App has to belong to the organization:
put the organization's login in **Organization** when you create it.

- **Making the App there** takes an owner of the organization, or one of its GitHub App managers.
- **Installing it** on the organization's repositories takes an owner of the organization, or a repository
  admin for the repositories they administer, unless the organization's owners have turned that off.

The App then belongs to the organization, in its settings on GitHub under **Developer settings › GitHub
Apps**, where its owners and App managers can change it.

### An App the organization already has

An organization that makes its Apps centrally can make one by hand and paste it into deevy:

1. In the organization's settings on GitHub, under **Developer settings › GitHub Apps**, create a GitHub App
   with the permissions in the table above, subscribed to the **Issues**, **Issue comment**, **Sub issues**,
   **Label** and **Repository** events. Give its webhook a secret you generate, and any HTTPS address for
   now. Generate a private key.
2. In deevy, choose **Connect GitHub**, then **Paste an App you already have**.
3. Fill in the **Name** deevy should call the Socket, the App's **App id**, its **Private key** (the whole
   `.pem` file GitHub gave you) and its **Webhook secret**, and choose **Connect**. deevy checks the key with
   GitHub before it keeps it.
4. On the Socket's page, under **Where it delivers**, choose **Point GitHub at this address**. deevy sets the
   App's webhook to your Workspace's address itself.
5. Install the App on the organization's repositories from the App's own page on GitHub, if it isn't
   already. GitHub tells deevy, and the Socket's page lists the organization under **Where it is
   installed**. Where the App was installed before you pasted it, it is listed there as soon as you
   connect it.

An App has one webhook address, so use one App for one Socket.

## Bind a Project to a repository

1. Go to **Settings › Projects** and choose **Bind a Project**.
2. Choose the GitHub Socket as the **Tool**, and a repository as the **Container**.
3. Leave **Its code is here too, so its Agents push to it** ticked, unless the code lives in another
   repository.
4. Name the Project, and choose **Bind it**.

A Run starts from the repository's default branch. The Project's **Repository** and **Base branch**
change either later, or point the code at a different repository than the issues.

## Hand an issue to an Agent

GitHub cannot assign an issue to an App, so there are three ways to give one to deevy:

- **Label it** `agent:<handle>`, such as `agent:planner`, for an Agent granted the Project.
- **Mention the App and the Agent** in a comment. The App's handle is the name the Socket list shows after
  **as**, without `[bot]`: `@acme-on-github planner, try again` starts a Run for `planner`, unless the
  Project has **Route by mention** turned off.
- **Set the Project's Default Agent**, which takes any open issue nobody named.

## What deevy writes on GitHub

Everything deevy writes is by the App's own account, named after the App, such as `acme-on-github[bot]` for
an App called "acme on GitHub". A comment about a Gate or a Run ends with the Agent and the Run it came
from; a comment an Agent writes itself ends with its handle.

- **Comments**, as the Project's **Mirror** says: a Gate asking for a Ruling, with the Proposal and how to
  rule; each Ruling; and with **Runs as well**, each Run starting, finishing or failing. See
  [Connecting your tools](/tools/overview/#what-deevy-writes-back).
- **The `deevy:awaiting-approval` label** while a Gate waits. GitHub creates it the first time deevy uses it.
- **Sub-issues**, which an Agent opens as GitHub's own sub-issues of the issue it is working.
- **Pull requests**, opened through the App from the branch a Run pushed, saying `Closes <the issue's URL>`
  so that merging closes the issue, and naming the Agent and the Run.

A Run clones the repository with a token GitHub mints for the App's installation, which reaches every
repository the App is installed on there and lasts an hour. deevy keeps it for that hour, so a Run resumed
after a Gate is handed the same token while it lasts. The [reference runtime](/agents/reference-runtime/)
keeps the token to itself, so the coding agent working the Run never holds it.

## Rule from GitHub

A Human can approve or reject a Gate by commenting `/approve` or `/reject <why>` on the issue. If you sign
in to deevy with GitHub, your comments already count as you; otherwise, link your GitHub account under
**Settings › Identities**. See [Ruling from your tools](/gates/ruling-from-your-tools/).

## Sign in with GitHub, in an organization that restricts apps

A Workspace can let in everybody in a GitHub organization: an admin adds a **GitHub organization** rule
under **Settings › General**, in **Who may join**. For that, deevy has to be able to see who belongs to the
organization when they sign in with GitHub.

An organization that restricts OAuth App access has to approve deevy first. An owner of the organization
does it once, in the organization's settings on GitHub under **Third-party access**. Until then the rule
lets nobody in, and an invitation still works.

:::note[deevy Cloud]
The app to approve is deevy's own sign-in app, which every Workspace on deevy Cloud signs in through.
:::

:::note[Self-hosted]
The app to approve is the GitHub OAuth App you set your deevy up with, which asks for the `read:org` scope
for exactly this. See [Sign-in providers](/self-hosting/sign-in-providers/).
:::

## Change the webhook secret

deevy checks every delivery against the App's webhook secret. To change it, go to the Socket's page and,
under **What it signs with**, either:

- **Type a new one on GitHub.** Set a new webhook secret in the App's settings on GitHub, paste the same
  value into **New secret from GitHub**, and choose **Use the new secret**. deevy keeps accepting the old
  one for a day, so you can change the two in either order.
- **Mint one in deevy.** Choose **Mint a webhook secret**. deevy shows the new one once; paste it into the
  App's settings on GitHub. deevy keeps accepting the old one for a day, so nothing GitHub sends in between
  is refused.

## When your deevy's address changes

The App's webhook is registered against your Workspace's address. If that address changes, choose **Point
GitHub at this address** on the Socket's page, and deevy tells GitHub where to deliver from now on.

:::note[deevy Cloud]
A Workspace's address on deevy Cloud never changes, so you will not need this.
:::

:::note[Self-hosted]
deevy builds the address from its `BETTER_AUTH_URL`. A GitHub Enterprise Server, or GHE.com, works too:
set `DEEVY_GITHUB_API` to its API root, then make the App there and paste it, as in
[An App the organization already has](#an-app-the-organization-already-has): deevy cannot make it there
for you, so **Connect GitHub** offers only the paste. Its accounts are not github.com's, and deevy has no
way to link one to a Human, so a `/approve` there rules nothing: rule in deevy, or from Slack.
:::

## Disconnect

On the Socket's page, choose **Disconnect**, then **Disconnect it**. deevy drops the App's credentials and
stops taking its deliveries; the issues it projected and the Runs on them stay readable. The App itself is
still on GitHub: uninstall or delete it there if you no longer want it.
