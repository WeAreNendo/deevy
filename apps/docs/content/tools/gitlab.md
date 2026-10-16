---
title: GitLab
description: Connect gitlab.com or your own GitLab with an access token, add a webhook to each project, and bind a Project to one for its issues and its code.
sidebar:
  order: 4
---

A GitLab Socket is one GitLab, gitlab.com or your own, reached as one GitLab account through its access
token. It covers both halves of a Project: a GitLab project's issues are its records, and its repository is
where Agents push and where deevy opens their merge requests. Every comment, label, branch and merge request
deevy makes is by that account.

## Choose the account deevy acts as

Before you connect, decide which GitLab account deevy works as, and make a token for it:

- a dedicated account called `deevy`, with a **personal access token**; or
- the bot account GitLab makes for a **project access token** or a **group access token**, where your GitLab
  tier offers those.

The token needs the `api` scope. Give its account **Developer** on each project deevy should work, and
nothing more: GitLab cannot narrow a token further, so the account's role is the limit on what an Agent's
Run can reach.

## Connect GitLab

1. In deevy, go to **Settings › Sockets** and choose **Connect GitLab**.
2. Give it a **Name**, such as `Acme on GitLab`.
3. Leave **GitLab URL** as `https://gitlab.com`, or change it to your own GitLab's address.
4. Paste the **Access token**, and choose **Connect**.

deevy asks GitLab who the token belongs to and what it may do. A token GitLab refuses, or one without the
`api` scope, is refused rather than stored, with GitLab's own words for why. When it works, deevy says
**Connected as** and the account's username.

## Add the webhook in GitLab

Right after connecting, deevy shows the webhook's **URL** and a **Secret token**. The secret token is shown
this once, so keep the dialog open while you add the webhook.

1. In GitLab, on each project you will bind (or on its group), open **Settings › Webhooks** and add a
   webhook.
2. Paste the **URL** and the **Secret token** deevy shows.
3. Choose **Issues events** and **Comments**, and their confidential versions too if deevy should see
   confidential issues.
4. Save it, then choose **Done** in deevy.

If you would rather GitLab signed each delivery than sent the secret with it, leave the secret token out,
generate a signing token on the webhook in GitLab, paste it into **Signing token** in deevy, and choose
**Use the signing token**. deevy then refuses a signed delivery more than five minutes old.

To change the secret token or the signing token later, go to the Socket's page and, under **What it signs
with**, either:

- **Paste one from GitLab.** Generate a new signing token on the webhook in GitLab, or type a new secret
  token there, paste the same value into **New secret from GitLab**, and choose **Use the new secret**.
  deevy keeps accepting the old one for a day, so you can change the two in either order.
- **Mint one in deevy.** Choose **Mint a webhook secret**, which is also the way back if you lose the secret
  token. deevy shows it once; paste it into each webhook as its secret token. deevy keeps accepting the old
  one for a day, so a webhook you have not changed yet still gets through.

## Bind a Project to a GitLab project

1. Go to **Settings › Projects** and choose **Bind a Project**.
2. Choose the GitLab Socket as the **Tool**, and a project as the **Container**. The list holds the projects
   the account is at least a Developer on.
3. Leave **Its code is here too, so its Agents push to it** ticked, unless the code lives elsewhere.
4. Name the Project, and choose **Bind it**.

deevy keeps the GitLab project's id, so renaming the project or moving it to another group breaks nothing.

## Hand an issue to an Agent

- **Label it** `agent:<handle>`, such as `agent:planner`, for an Agent granted the Project.
- **Mention the account and the Agent** in a comment, such as `@deevy planner, try again`.
- **Set the Project's Default Agent**, which takes any open issue nobody named.

GitLab's issues are open or closed and nothing else. A team's workflow in scoped labels is read as labels.

## What deevy writes on GitLab

- **Comments**, as the Project's **Mirror** says: a Gate asking for a Ruling, each Ruling, and with **Runs as
  well**, each Run starting, finishing or failing. See
  [Connecting your tools](/tools/overview/#what-deevy-writes-back).
- **The `deevy:awaiting-approval` label** while a Gate waits. GitLab creates it on the project the first
  time deevy uses it.
- **Sub-issues**. GitLab has no parent for an issue, so an Agent's sub-issue is a new issue related to the
  one it came from, and deevy keeps the tree itself.
- **Merge requests**, from the branch a Run pushed, saying `Closes <the issue's URL>` so that merging closes
  the issue. The branch is deleted when the merge request is merged.

A Run clones over HTTPS with the Socket's token. The [reference runtime](/agents/reference-runtime/) keeps
it to itself, so the coding agent working the Run never holds it.

## Rule from GitLab

A Human can approve or reject a Gate by commenting `/approve` or `/reject <why>` on the issue, once deevy
knows the GitLab account is theirs: by signing in to deevy with that GitLab, or by linking it under
**Settings › Identities**, which offers GitLab where your deevy signs people in with it. A comment by a
project or group access token's bot rules nothing. See
[Ruling from your tools](/gates/ruling-from-your-tools/).

:::note[deevy Cloud]
deevy Cloud does not sign people in with GitLab, so it cannot tell whose a GitLab comment is, and a
`/approve` written in GitLab rules nothing. Rule in deevy, or from Slack. Everything else on this page works
as it says.
:::

## When the token expires

GitLab's access tokens expire. When the Socket's token does, connect the Socket again with a new one.

:::note[deevy Cloud]
The webhook URL is under your Workspace's own address, `https://app.deevy.dev/<address>/hooks/…`, which
gitlab.com and any GitLab that can reach the internet can deliver to.
:::

:::note[Self-hosted]
The webhook URL is built from your deevy's `BETTER_AUTH_URL`, and your GitLab has to be able to reach it.
A Ruling from GitLab needs the GitLab your deevy signs people in with, gitlab.com or the one
`GITLAB_ISSUER` names. A Socket on any other GitLab shares no accounts with sign-in.
:::

## Disconnect

On the Socket's page, choose **Disconnect**, then **Disconnect it**. deevy drops the token and stops taking
GitLab's deliveries; the issues it projected and the Runs on them stay readable. Revoke the token and remove
the webhooks in GitLab if you no longer want them.
