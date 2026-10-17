---
title: Connect your first tool
description: Connect GitHub to your deevy Cloud Workspace as a Socket, and bind a repository to it as a Project.
sidebar:
  order: 4
---

deevy works in the tools your team already uses. Each tool you connect is a **Socket**: deevy's own
identity in that tool, which every Agent works through. A **Project** is then one container inside it,
here a GitHub repository: where its Issues come from, and where its Agents push code.

This page connects GitHub, the tool most teams start with. Linear, GitLab, Notion and Slack start from
the same place, and each has a page of its own under [Tools](/tools/overview/). You need to be an admin
of the Workspace.

## Connect GitHub

deevy connects to GitHub as a GitHub App of your own. deevy describes the App to GitHub for you, with
the permissions it needs and nothing more: issues to read and write, code and pull requests to write,
and the metadata GitHub requires. GitHub makes the App and hands its credentials straight to deevy, so
nobody copies a private key anywhere.

1. Go to **Settings › Sockets**, and under **Connect a tool** choose **Connect GitHub**.
2. Give it a **Name**, such as `acme on GitHub`. GitHub names the App after it, and deevy names the
   Socket.
3. If your repositories belong to a GitHub organization, put the organization's login in
   **Organization**, such as `acme`. Leave it empty for repositories on your own account.
4. Choose **Create the App on GitHub**, then **Continue on GitHub**.
5. On GitHub, create the App. GitHub then shows you where to install it.
6. Install it on the repositories deevy should work in. GitHub sends you back to deevy, to the Socket's
   page.

Under **Where it is installed**, the Socket's page lists where the App is installed, with a link to
install it on more repositories later. An App installed nowhere can see no repository, so there is
nothing to bind yet.

:::caution[Repositories that belong to an organization]
The App is private, and GitHub installs a private App only on the account that owns it, so for an
organization's repositories the App has to be the organization's: that is what **Organization** does.
Only an owner of the organization, or one of its GitHub App managers, can make it there, and installing
it takes an owner of the organization or an admin of the repositories it goes on. If that is not you,
ask one to connect GitHub with you. [GitHub](/tools/github/#for-an-organizations-repositories) has the details.
:::

## Bind a Project

1. Go to **Settings › Projects** and choose **Bind a Project**.
2. Under **Tool**, choose the Socket you just made.
3. Under **Container**, choose a repository. deevy asks GitHub which ones the App can see.
4. Leave **Its code is here too, so its Agents push to it** ticked if Agents should write code here.
   They then push branches to this repository and open pull requests on it, starting from its default
   branch.
5. Give the Project a **Name** (deevy suggests the repository's) and choose **Bind it**.

Nothing moves. An Issue stays a GitHub issue: deevy hears about it when something happens to it on
GitHub, such as being opened, labelled or commented on, and lists it under **Work**. What deevy has to
say, it writes back on GitHub.

## Next

- [Add your first Agent](/get-started/add-an-agent/), and hand it an issue.
- [Sockets and Projects](/concepts/sockets-and-projects/), for how the two fit together.
- [GitHub](/tools/github/), for everything else a GitHub Socket does.
