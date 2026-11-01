---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/sockets": minor
"@deevy/web": minor
"@deevy/server": minor
"@deevy/hosted": minor
---

You can connect a tool deevy has no Socket for, such as Jira, Asana or a tracker of your own. Choose **Connect another tool** under **Settings › Sockets** and give it a name. deevy shows the address to deliver to and a webhook secret, once. An adapter you write, such as a script, a small service or an n8n flow, posts what happens in the tool to that address in deevy's own format, `{ "events": [...] }`, signed the way deevy signs its webhooks. From there its records are routed and open Runs like any tracker's. docs.deevy.dev/tools/generic/ has the format, a signing script and an n8n flow. This Socket is available in production and on deevy Cloud. It differs from the others in two ways. deevy writes nothing in that tool. And a `/approve` or `/reject` sent through it never counts, because whoever holds the secret writes everything a delivery says, its author included. Such a Ruling is recorded as `gate.ruling_refused` with the reason `unvouched`, and a Gate on one of its records is ruled on in deevy or in Slack.

Every `gate.*` Event now names the record its Gate is on, as its tool knows it: `payload.issueExternalId`, `payload.issueKey` and `payload.issueUrl`, plus `payload.issueSocketId`, the Socket the record is in. That covers `gate.requested`, `gate.approval`, `gate.approved`, `gate.rejected`, `gate.superseded` and `gate.ruling_refused`. A webhook receiver can now say something on the record without asking deevy which one it is. Events written before the upgrade don't carry these fields.

Linear, GitLab, Notion and Slack are now marked **Preview** in Settings and on their pages on docs.deevy.dev. deevy is built and tested against each one's recorded deliveries, but hasn't yet been tried against the tool itself. Nothing about how they work has changed. `sockets.providers` (`GET /api/sockets/providers`) now returns `walked` for each tool, which is false for one that is a Preview. It also lists `generic`, with `webhookSecretFrom: "deevy"`, a new value meaning only deevy makes that Socket's secret. `sockets.connect` now returns that secret as `webhookSecret` for such a Socket, and `null` for every other tool, as before. Such a Socket takes no secret typed in: `sockets.connect` and `sockets.update` refuse a `webhookSecret` for it, and `sockets.rotate` mints a new one.

The stub Socket, which is for development only, now signs its deliveries with deevy's own `deevy-signature: t=<unix>,v1=<hex>` header. It used to use `stub-signature`, which is gone, so a script that posts to a stubbed deployment has to sign the new way. If you build your own Socket module: `createComment` may now return `null` when the tool takes no comments, a module may declare `vouches: false` so that no Ruling through it counts, and it may declare `walked`. If you call `applyInbound` yourself, it now requires `vouches`. `signPayload` and `verifySignature` are exported from `@deevy/core/sockets`.

When a GitLab Socket is connected, the dialog now asks for an account with **Reporter**. It used to say **Developer**, from when deevy pushed code.
