---
title: Webhooks
description: Subscribe a URL to your Workspace's Events. What each POST carries, how to verify its signature, and how deevy retries a delivery that fails.
sidebar:
  order: 1
---

A webhook tells a URL of yours that something happened in your Workspace, as it happens: a record routed to
an Agent, a Run waiting at a Gate, a Gate approved. It is how an Agent's runtime hears about new work without
asking, and how anything else of yours follows along.

Each POST is one [Event](/concepts/events/), signed with a secret only you and deevy know.

## Subscribe a URL

You need to be an admin.

1. Open **Settings › Webhooks**.
2. Enter the **URL**. It must be `https`.
3. Under **Event kinds**, list the kinds you want, separated by commas, such as `run.*, issue.assigned`.
   Leave it empty for every kind.
4. Enter a **Secret** of at least 16 characters, or choose **Generate**.
5. Choose **Subscribe**.
6. Copy the secret now and keep it where your receiver can read it. deevy never shows it again, not on this
   page, not through the API, not in the Event log.

A kind is exact, such as `gate.approved`, or a whole family, such as `run.*` for everything that happens to a
Run.

The list shows each subscription's URL, its kinds and whether it is on. **Switch off** stops sending to it
and keeps it; **Switch on** starts again; **Remove** deletes it.

Through the [API](/api/), a subscription can also be narrowed to one Project. If you lose a secret, set a new
one there; the old one stops working.

### An Agent's own webhook

An Agent can have a URL of its own, for its runtime. You need to be the Agent's Sponsor or an admin.

1. Open **Settings › Agents** and choose the Agent.
2. Under **Webhook**, enter the **Webhook URL**. It must be `https`.
3. Enter a **Signing secret** of at least 16 characters, or choose **Generate**.
4. Choose **Start deliveries**.
5. Copy the secret now and give it to whatever receives the deliveries. deevy never shows it again.

To move the deliveries, enter a new URL and choose **Save**; leave the secret empty to keep the one it signs
with, or enter a new one to replace it. **Stop deliveries** stops them, and setting a URL again starts them,
with a secret. The [CLI](/mcp-and-cli/cli/) does the same with `deevy agents update`.

An Agent's webhook is sent only what the Agent may see: the Events of the Projects it was granted. Nothing
from a Project it was not granted reaches it, and neither does anything that belongs to the Workspace rather
than to a Project, such as Members, invitations and tools. Its Sponsor also sees it under
**Settings › Webhooks**, and can switch it off or remove it there.

An Agent without a webhook still finds its work: it asks every so often, over MCP or the API. See
[Your own harness](/agents/your-own-harness/).

## What deevy sends

A `POST` with a JSON body, which is the Event itself and nothing else:

```json
{
  "seq": 4182,
  "kind": "issue.assigned",
  "workspaceId": "ws_q8d2k4m7x1pz",
  "projectId": "proj_k3xr8v2m9qpw",
  "subjectType": "issue",
  "subjectId": "iss_7f2m4q9x1bza",
  "actorMemberId": null,
  "payload": { "from": null, "to": "mem_b5n8r2w6t0yc", "byRouting": true },
  "createdAt": "2026-10-16T09:12:44.512Z"
}
```

`seq` is the Event's place in your Workspace's log. `actorMemberId` is the Member who did it, or `null` when
deevy did it or it came from one of your tools; a Ruling from a tool names the Human whose account it was.
What `payload` holds depends on the kind.

And three headers:

| Header            | What it is                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `deevy-signature` | `t=<unix seconds>,v1=<hex>`: the signature, below.                                       |
| `deevy-delivery`  | This delivery's id. Every retry of it carries the same one, so use it to ignore repeats. |
| `deevy-event`     | The Event's `seq`, the same number as in the body.                                       |

### The kinds an Agent's loop usually wants

| Kind                             | When                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `issue.assigned`                 | A record was routed to a Member. `payload.to` is who.                                                                                 |
| `comment.created`                | Somebody commented on a record. `payload.mentionedMemberIds` is whom it names: a reply to what an Agent asked on the record names it. |
| `run.started`                    | A Run started.                                                                                                                        |
| `run.awaiting_input`             | A Run is waiting at a Gate. `payload.gateRequestId` is which.                                                                         |
| `run.answered`                   | The Gate a Run waited at was decided, and the Run carries on.                                                                         |
| `run.completed`, `run.failed`    | A Run ended.                                                                                                                          |
| `gate.requested`                 | An Agent asked at a Gate.                                                                                                             |
| `gate.approval`                  | A Gate got one approval, and still wants more.                                                                                        |
| `gate.approved`, `gate.rejected` | A Gate was decided.                                                                                                                   |

[The Event log](/concepts/events/) lists the other families.

## Verify the signature

Check every POST before you act on it. The `deevy-signature` header is `t=<unix seconds>,v1=<hex>`, where
`v1` is an HMAC-SHA256, in hex, of the string `<t>.<body>`, keyed with your secret.

1. Read `t` and `v1` from the header.
2. Refuse it if `t` is more than five minutes from your own clock. The timestamp is inside what is signed, so
   an old POST cannot be replayed with a new one.
3. Compute the HMAC of `t`, a full stop, and the **raw body exactly as you received it**. Parse the JSON only
   afterwards: parsing it and writing it out again changes the bytes, and the signature will not match.
4. Compare it with `v1` in constant time.

In Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, header, rawBody, now = Date.now()) {
  const fields = new Map(header.split(",").map((part) => part.trim().split("=", 2)));
  const t = Number(fields.get("t"));
  const v1 = fields.get("v1") ?? "";
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 5 * 60) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return v1.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

In Python:

```python
import hashlib
import hmac
import time


def verify(secret: str, header: str, raw_body: bytes) -> bool:
    fields = dict(part.strip().split("=", 1) for part in header.split(",") if "=" in part)
    try:
        t = int(fields["t"])
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > 5 * 60:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, fields.get("v1", ""))
```

## When a delivery fails

Answer with any `2xx` status to say you have it. Anything else, or no answer at all, is a failure, and deevy
tries again: eight attempts in all, waiting ten seconds after the first failure and twice as long after each
one after that, with a little jitter. The longest wait is about ten minutes, and the whole window about
twenty. After the eighth, deevy gives up and records a `webhook.exhausted` Event, so a receiver that is down
for longer than that should look for its work when it comes back rather than wait to be told again.

Nothing is lost if deevy restarts in the middle: what each URL is owed is written down when the Event is, and
sent from there.

**Deliveries**, beside a subscription in **Settings › Webhooks**, lists what it was sent lately: the Event's
kind, how it went, such as **Delivered (200)** or **Failed** with the status and the reason your receiver
gave, and how many attempts it took. **Redeliver** sends one again from the start, with the same
`deevy-delivery` id, so a receiver that ignores repeats will ignore one it already handled.

:::note[deevy Cloud]
A delivery goes out as soon as its Event is written.
:::

:::note[Self-hosted]
Deliveries go out on deevy's background pass: every `DEEVY_SWEEP_INTERVAL_SECONDS` (60 by default) for the
Docker image, and every minute on a Cloudflare Worker, or at once where the Worker has a Queue. See
[Configuration](/self-hosting/configuration/).
:::
