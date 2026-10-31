---
title: Notion
description: Connect a Notion workspace through an internal connection, and bind a Project to a database's rows.
sidebar:
  order: 5
---

A Notion Socket is one Notion workspace, reached through an internal connection you make there. A database
can be a Project's tracker, with each row a record. An Agent that reads your other pages, or writes in
Notion, does it with Notion access of its own, such as Notion's MCP server, not through deevy.

deevy sees only what you share with the connection, and the pages under it. That is Notion's rule.

## Make the connection in Notion

You need to be an owner of the Notion workspace to use Notion's Developer portal.

1. In Notion's [Developer portal](https://app.notion.com/developers/connections), choose **Build ›
   Internal connections › Create a new connection**, and call it `deevy`. Every comment deevy writes in
   Notion is by that name.
2. On its **Configuration** tab, give it **read content**, **read comments**, **insert comments** and
   **user information with email addresses**. deevy reads a row back when Notion says it changed, and
   comments on it when a Gate waits and when it is ruled on.
3. Copy its **installation access token**, which starts `ntn_`.

Use the connection's token, not a personal access token. A personal token acts as the person who made it,
so deevy would write as them and take their comments, a `/approve` included, for its own. deevy refuses one.

## Connect Notion

1. In deevy, go to **Settings › Sockets** and choose **Connect Notion**.
2. Give it a **Name**, such as `Acme's Notion`.
3. Paste the **Installation access token**, and choose **Connect**.

deevy asks Notion who the connection is. A token Notion refuses is not stored. When it works, deevy says
**Connected as** and the connection's name, and shows the Socket's address for the webhook.

## Share what deevy should read

In Notion, give the connection each database deevy should take records from. Either:

- on the connection's **Content access** tab, choose **Edit access**; or
- on the database itself, choose **••• › Connections › Add connection**.

## Subscribe to changes

1. On the connection's **Webhooks** tab in Notion, choose **Create a subscription**.
2. Paste the Socket's address, which deevy showed after connecting and the Socket's page shows under
   **Where it delivers**.
3. Choose API version 2025-09-03 or later, and these events: page created, properties updated, content
   updated, moved, deleted and undeleted, and comment created.
4. Notion sends deevy a verification token. On the Socket's page in deevy, under **Verifying the webhook**,
   choose **Show the token**, and paste it into Notion's **Verify**.

The first delivery signed with that token settles it, and the Socket's page says Notion has verified the
webhook. Nothing unsigned replaces the token after that.

## Bind a Project to a database

1. Go to **Settings › Projects** and choose **Bind a Project**.
2. Choose the Notion Socket as the **Tool**, and a data source, one table of a database, as the
   **Container**.
3. Name the Project, and choose **Bind it**.

deevy reads what each row means from the data source's own properties:

| In the data source                             | deevy reads it as                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| The first **status** property                  | The row's state. Statuses in its **Complete** group count as closed.                      |
| The first **multi-select** property            | Labels, so an option `agent:<handle>` hands the row to that Agent.                        |
| The first **people** property                  | Assignees. The connection itself among them hands the row to the Project's default Agent. |
| A relation to its own rows named like a parent | The row's parent, as Notion's sub-items are.                                              |
| An **ID** property, where there is one         | The key a Human types, such as `TASK-12`.                                                 |

A row in the trash is closed.

Notion's deliveries name what changed and carry none of it, so deevy reads each row back when it is told.
Notion holds no code: an Agent that should push reaches its repository with access you give it.

## Hand a row to an Agent

- **Add the option** `agent:<handle>`, such as `agent:planner`, to the row's multi-select, for an Agent
  granted the Project.
- **Add the connection** to the row's people property, and the Project's **Default Agent** takes it.
- **Set the Project's Default Agent**, which takes any open row nobody named.

## What deevy writes in Notion

deevy writes about Gates and nothing else, as comments on the row by the connection: one when an Agent asks
at a Gate, with the Proposal and how to rule; one for each approval and for the decision; and a reply to a
`/approve` or `/reject` that ruled nothing. See
[Connecting your tools](/tools/overview/#what-deevy-writes-back).

deevy changes no property and opens no row. An Agent that opens a sub-item does it in Notion with its own
access; where the data source has a parent relation, deevy links the new row to its parent by it.

## Rule from Notion

Notion has no account a Human can link to deevy, so the only proof of who wrote a comment is the address
Notion reports for its author. An admin decides whether that is enough: on the Socket's page, under **Who
commented**, turn on **Take a verified address as proof**.

With it on, a `/approve` or `/reject <why>` comment counts as the Member whose verified address in deevy
matches, and the Gate's page marks every Ruling made that way "(email)". With it off, a comment in
Notion rules nothing. See [Ruling from your tools](/gates/ruling-from-your-tools/).

:::note[deevy Cloud]
The Socket's address is under your Workspace's own address, `https://app.deevy.dev/<address>/hooks/…`,
which Notion can always reach.
:::

:::note[Self-hosted]
The Socket's address is built from your deevy's `BETTER_AUTH_URL`, and Notion has to reach it over HTTPS.
If the address changes, create a new subscription in Notion to the new one.
:::

## Disconnect

On the Socket's page, choose **Disconnect**, then **Disconnect it**. deevy drops the token and stops taking
Notion's deliveries; the rows it projected and the Runs on them stay readable. Delete the connection in
Notion's Developer portal if you no longer want it.
