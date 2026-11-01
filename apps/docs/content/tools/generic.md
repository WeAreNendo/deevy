---
title: Any other tool
description: Connect a tool deevy has no Socket for, such as Jira or a tracker of your own, through an adapter that posts deevy's own format, signed with a secret deevy makes.
sidebar:
  order: 7
---

A generic Socket is for a tool deevy has no Socket of its own for: Jira, Asana, a tracker your team built.
deevy never talks to the tool. An adapter of yours, such as a short script, a small service or an n8n flow,
hears what happens in the tool, says it in deevy's format and posts it to the Socket's address, signed with a
secret deevy made for it. From there a record is a record: deevy keeps it, hands it to an Agent by its label
or a mention, and opens a Run, as it does for GitHub.

It differs from the tools deevy knows in two ways:

- **deevy writes nothing in the tool.** When an Agent asks at a Gate, and when the Gate gets an approval or
  is decided, deevy says so as an Event on your [webhooks](/webhooks/), naming the record as the tool knows
  it. Your adapter can say it in the tool, or leave it in deevy.
- **A Ruling through it never counts.** Whoever holds the secret writes everything a delivery says, its
  author included, so deevy cannot know that the Human who replied `/approve` is who the delivery names.
  deevy records the refusal and rules nothing. A Gate on one of its records is ruled on in deevy, or with a
  button in [Slack](/tools/slack/).

## Connect it

You need to be an admin.

1. Go to **Settings › Sockets** and choose **Connect another tool**.
2. Give it a **Name**, such as `Acme's Jira`, and choose **Connect**.
3. deevy shows the **URL** your adapter posts to and the **Webhook secret** it signs with. Copy the secret
   now and keep it where the adapter can read it: this is the only time deevy shows it.

To change the secret, choose **Mint a webhook secret** on the Socket's page. deevy shows the new one once,
and keeps taking the old one for a day, so the adapter can change over after.

Then [bind a Project](/tools/overview/#bind-a-project) to it. deevy cannot list what is in a tool it never
talks to, so you type the **Container**: the `scopeKey` your adapter puts on each record, such as the Jira
project key `OPS`.

## What a delivery says

A delivery is a `POST` to the Socket's URL with a JSON body holding a list of events, one or many:

```json
{ "events": [{ "kind": "issue", "scopeKey": "OPS", "issue": { "...": "..." } }] }
```

And these headers:

| Header            | What it is                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `content-type`    | `application/json`.                                                                                                                  |
| `deevy-signature` | `t=<unix seconds>,v1=<hex>`: the signature, [below](#sign-it).                                                                       |
| `deevy-delivery`  | Your id for this delivery. Send the same one again on a retry and deevy takes it once. Leave it out and every POST is a new one.     |
| `deevy-event`     | What your tool called what happened, such as `jira:issue_updated`, for the Socket's page to show. Leave it out and it says `events`. |

### A record

Send the whole record each time anything about it changes: deevy keeps what the latest event says, not what
changed.

```json
{
  "kind": "issue",
  "scopeKey": "OPS",
  "issue": {
    "externalId": "10042",
    "key": "OPS-42",
    "url": "https://acme.example/browse/OPS-42",
    "title": "Rotate the staging certificates",
    "body": "They expire on the 14th.",
    "state": "open",
    "stateName": "To Do",
    "assignees": [{ "login": "grace", "id": "u-17" }],
    "labels": ["agent:planner"],
    "updatedAt": "2026-11-01T09:12:44Z"
  },
  "actor": { "login": "grace", "id": "u-17" }
}
```

| Field                    | What it is                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `scopeKey`               | The container the record is in, which is what a Project is bound to. Required.                                                            |
| `issue.externalId`       | The tool's own id for the record, which never changes. Required.                                                                          |
| `issue.key`              | What people call it, such as `OPS-42`. Required.                                                                                          |
| `issue.url`              | Where a Human opens it: an `http` or `https` address. Required.                                                                           |
| `issue.title`            | Required.                                                                                                                                 |
| `issue.body`             | The description, or `null` for none. Left out, deevy keeps the one it has.                                                                |
| `issue.state`            | `open` or `closed`. A closed record is handed to nobody. Required.                                                                        |
| `issue.stateName`        | The tool's own word for the state, such as `In Review`. Left out, it is `state`.                                                          |
| `issue.assignees`        | The tool's assignees, each a `login` and an `id`. Left out, none.                                                                         |
| `issue.labels`           | Its labels. One with the Project's routing label, such as `agent:planner`, hands it to that Agent. Left out, none.                        |
| `issue.parentExternalId` | The `externalId` of the record this one is part of. Left out or `null`, deevy keeps the parent it has.                                    |
| `issue.delegateId`       | `"deevy"` hands it to the Project's default Agent, as assigning a Linear issue to deevy does.                                             |
| `issue.updatedAt`        | When the tool last changed it, in ISO 8601 with `Z` or an offset such as `+01:00`. An event older than the one deevy has changes nothing. |
| `actor`                  | Who did it, a `login` and an `id`, or `null`.                                                                                             |

### A comment

```json
{
  "kind": "comment",
  "issueExternalId": "10042",
  "comment": {
    "externalId": "c-7",
    "url": "https://acme.example/browse/OPS-42?comment=7",
    "body": "@deevy planner, try again with the new bucket",
    "author": { "login": "grace", "id": "u-17" },
    "createdAt": "2026-11-01T09:15:02Z"
  }
}
```

The record has to be in deevy already, so send its `issue` event first. A comment that mentions `@deevy` and
then an Agent's handle starts a Run for that Agent, unless the Project has **Route by mention** turned off.
Set `author.isBot` to `true` for an account that is not a person.

A comment whose author's `id` or `login` is `deevy` is deevy's own, coming back, and deevy drops it. If your
adapter posts what deevy announces into the tool and the tool then tells the adapter about that comment,
send it with that author or do not send it.

A comment whose first line is `/approve` or `/reject` is a Ruling, which deevy refuses here, as above. An
event of `kind` `ruling` is refused the same way.

## Sign it

`v1` is an HMAC-SHA256, in hex, of the string `<t>.<body>`, keyed with the Socket's secret, where `t` is the
time in unix seconds and the body is exactly the bytes you send. It is how deevy signs its own
[webhooks](/webhooks/#verify-the-signature), so the routine that signs what your adapter sends also checks
what deevy sends it. deevy refuses a signature more than five minutes from its own clock.

In a shell:

```sh
body='{"events":[{"kind":"issue","scopeKey":"OPS","issue":{"externalId":"10042","key":"OPS-42","url":"https://acme.example/browse/OPS-42","title":"Rotate the staging certificates","state":"open","labels":["agent:planner"],"updatedAt":"2026-11-01T09:12:44Z"}}]}'
t=$(date +%s)
v1=$(printf '%s' "$t.$body" | openssl dgst -sha256 -hmac "$SOCKET_SECRET" | sed 's/^.* //')
curl "$SOCKET_URL" -H 'content-type: application/json' -H "deevy-signature: t=$t,v1=$v1" --data-raw "$body"
```

In Node:

```js
import { createHmac, randomUUID } from "node:crypto";

export async function send(url, secret, events, deliveryId = randomUUID()) {
  const body = JSON.stringify({ events });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "deevy-signature": `t=${t},v1=${v1}`,
      "deevy-delivery": deliveryId,
    },
    body,
  });
  if (!response.ok) throw new Error(`deevy answered ${response.status}: ${await response.text()}`);
  return response.json();
}
```

## What deevy answers

| Status | When                                                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | It took the delivery. The body says `applied`, how many events changed something, and `skipped`, why each of the others did not. |
| `200`  | `{"status": "duplicate"}`: it already took a delivery with this `deevy-delivery` id, and changed nothing.                        |
| `200`  | `{"status": "paused"}`: somebody paused the Socket, and deevy took nothing. Send it again once it is resumed.                    |
| `401`  | The signature is wrong, too old, or missing. Nothing is kept: not the delivery, not a row of what it said.                       |
| `404`  | There is no such Socket, such as one you disconnected. Stop sending there.                                                       |

An event deevy cannot read is skipped with the reason, such as `Event 2 (issue) is not what deevy takes:
issue.url: Invalid URL`, and the rest of the delivery is still taken. The Socket's page lists each delivery
under **What it has said lately**, with what deevy made of it.

## An n8n flow

One flow takes what the tool says to deevy. With Jira as the tool:

1. A **Jira Trigger** node, on issue created, updated and commented, or a **Webhook** node the tool posts to.
2. A **Code** node that says it as deevy's event and makes the string to sign:

   ```js
   const issue = $json.issue;
   const body = JSON.stringify({
     events: [
       {
         kind: "issue",
         scopeKey: issue.fields.project.key,
         issue: {
           externalId: issue.id,
           key: issue.key,
           url: `https://acme.atlassian.net/browse/${issue.key}`,
           title: issue.fields.summary,
           state: issue.fields.status.statusCategory.key === "done" ? "closed" : "open",
           stateName: issue.fields.status.name,
           labels: issue.fields.labels,
           updatedAt: new Date(issue.fields.updated).toISOString(),
         },
       },
     ],
   });
   const t = Math.floor(Date.now() / 1000);
   return [{ json: { body, t, message: `${t}.${body}` } }];
   ```

3. A **Crypto** node: action **Hmac**, type **SHA256**, value `{{ $json.message }}`, property name `v1`, the
   Socket's secret, encoding **HEX**.
4. An **HTTP Request** node: method **POST** to the Socket's URL, with the header `deevy-signature` set to
   `t={{ $json.t }},v1={{ $json.v1 }}`, and a **Raw** body of type `application/json` that is
   `{{ $json.body }}`. Raw, because a body n8n writes out again from JSON is not the bytes you signed.

A second flow takes what deevy announces back to the tool. Subscribe a **Webhook** node to the `gate.*`
Events in **Settings › Webhooks**, with **Raw Body** on so you can check the signature, check it as above
with another **Crypto** node and an **If** node, then comment on the record the Event names:

| Field in `payload` | What it is                                                                       |
| ------------------ | -------------------------------------------------------------------------------- |
| `issueSocketId`    | The Socket the record is in: the last part of the address your adapter posts to. |
| `issueExternalId`  | The `externalId` you sent for the record.                                        |
| `issueKey`         | Its `key`, such as `OPS-42`.                                                     |
| `issueUrl`         | Its `url`.                                                                       |

A subscription hears every Gate in the Workspace, so let the **If** node pass only an Event whose
`issueSocketId` is your Socket's: a Gate on a GitHub issue is not one to comment on in Jira.

Where a Gate is waiting, the Event's `subjectType` is `gate` and its `subjectId` is the Gate, whose page is
`gates/<subjectId>` under your deevy's address. Link to it in what you post, since a reply in the tool counts
for nothing. A `gate.ruling_refused` on a record with no Gate waiting is about the record instead, with
`subjectType` `issue`.
