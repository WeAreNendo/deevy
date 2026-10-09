# Email: Notifications and invitations by email, in vertical slices

The next item on [PLAN.md](../PLAN.md)'s "After Sockets" list, chosen by Matt on 2026-10-08 over budgets,
per-Agent identities, Jira and Asana, private Projects and Postgres. Vocabulary is
[CONTEXT.md](../../CONTEXT.md). It is done when a Human can be told by email what waits on them, at the
address their sign-in provider verified, and turn each kind on or off; when an admin can route Notifications
to a team address the way a Slack room is routed today; when an invitation can be emailed to the address it
is for; and when an operator can send all of it through whichever service they already have — Cloudflare
Email Service, Resend, Postmark, SendGrid, Mailgun, Amazon SES or an SMTP server — on either deployment
where that service can run.

Eight slices, in dependency order. Each is one PR on `main` and carries its own tests.

**Status: done, 2026-10-09**, in eight stacked pull requests (#124, #125, #127, #128, #129, #130, #131 and
the one this record lands in). What each slice found is under "What it found", at the end.

Why this and why now. A Gate is where a Run stops until a Human rules, and today the Human hears about it in
deevy's inbox, in a Slack room, or by Slack direct message. A Human who is in neither all day — the
reviewer on another team, the founder on a phone, the Sponsor who checks in twice a week — finds out when
they next open deevy, and the Agent waits that long. Email is the one Channel everybody already reads. It
is also what an invitation has been missing since sign-in shipped: today an admin copies a link and passes
it on by hand.

## What is already there

- **The outbox.** Every Notification that leaves deevy is a `delivery` row derived in the tail of
  `appendEvent` (`deriveNotifications`, `packages/core/src/notifications.ts`), rendered from its Event at
  send time, and sent by a sweep in `work.ts` that claims rows without a transaction, backs off, and
  retires what cannot be sent. Slack rooms (`slack`, `chat`), Slack direct messages (`chat_dm`), webhooks
  and tracker mirrors (`socket`) all share it. Email is two more targets.
- **Routing.** `routeEvent` decides, per Event, who is told and where: the inbox, the rooms the Workspace's
  routing rules name, and each Human's direct messages, filtered through their `notification_preference`
  row per kind. A room is `channel`; a rule is `routing_rule`. Both take a new kind without a new shape.
- **A Gate already has a message.** `sockets/chat-out.ts` builds a `ChatGateMessage` — the record's key and
  URL, the Checkpoint, the Proposal, the Agent, the arithmetic, the link to `/gates/<id>` — for Slack. An
  email is the same facts in another format.
- **Sealed secrets.** `secrets.ts` seals a credential under `DEEVY_SECRET`, as every Socket's are, and
  signs a short-lived state (`signState`), which is what an unsubscribe link needs.
- **Pluggable providers.** The core holds a port and never a provider; the two entries build a registry and
  pass it to `createApp` (`sockets`). A provider module is tested against recorded responses with an
  injected `fetch`. Email follows the same pattern.
- **A verified address.** `user.emailVerified` is what an email-domain rule already trusts (#115), so it is
  what deevy can trust to send to.

## What is in the way

- **The token of an invitation is gone once it is shown.** The `invitation` row keeps only the SHA-256 of
  its token (`schema/invitation.ts`), because the link existed in one HTTP response. An email sent later,
  from the outbox, needs the token itself.
- **Not every sender runs everywhere.** SMTP needs raw TCP and TLS, which the core cannot import
  (ADR-0006) and a Worker does not offer in any practical form. Cloudflare Email Service is a binding only
  a Worker has. The HTTP APIs — Resend, Postmark, SendGrid, Mailgun, Amazon SES — run on both.
- **Cloudflare Email Service is a beta.** Public since April 2026, and sending to an address that is not
  verified on the Cloudflare account needs the Workers Paid plan; the Worker deployment has been sized to fit
  a free account until now.
- **An address deevy did not check is a stranger's.** Linear and Atlassian never verify an address, and an
  admin can type any address into a team Channel. deevy must not become a way to mail somebody who never
  asked.
- **The cron budget.** A Worker's scheduled pass has a statement and wall-clock budget, and each sender has
  a rate limit of its own. The sweep sends a bounded batch per pass.

## Decisions taken with Matt, 2026-10-08

| Question                       | Decision                                                                                                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which services                 | **All the common ones, chosen by the operator**: Cloudflare Email Service (Workers), Resend, Postmark, SendGrid, Mailgun and Amazon SES (both deployments), and SMTP (Docker). One port, one module each.                                     |
| Who is emailed                 | **Each Human, and team addresses.** A Human's own Notifications at the address their sign-in verified, switched per kind under Settings › Notifications; and an `email` Channel an admin routes kinds to, like a Slack room.                  |
| What a Gate email says         | **A summary and a link**: who asks, at which Checkpoint, on which record, the first lines of the Proposal, and a button that opens the Gate in deevy. Approving from the email stays out of scope.                                            |
| When                           | **Right away**, one email per Notification, through the outbox with its retries. No digest.                                                                                                                                                   |
| Where the sender is configured | **Both**: the environment (`DEEVY_EMAIL_SENDER` and each service's variables, or a wrangler binding), and Settings › Email, where an admin may set or override it, its credentials sealed under `DEEVY_SECRET`. Settings wins when it is set. |
| Defaults for a Human           | **What waits on them**: a Gate awaiting them and a Run awaiting their answer are on; mentions, assignments, finished Runs and delegations are off until they turn them on.                                                                    |
| Invitations                    | **Emailed too**, whenever a sender is configured. The link is still shown once to copy, as today.                                                                                                                                             |

Reconciled in writing this:

- **Only a verified address is ever sent to.** A Human whose provider did not verify their address gets no
  personal email, and Settings › Notifications says why. A team address is sent nothing until somebody at
  it clicks a confirmation link deevy mailed it, which is the same proof for a mailbox that `emailVerified`
  is for a person.
- **Every personal email can be stopped from the email.** It carries a one-click unsubscribe
  (`List-Unsubscribe` and `List-Unsubscribe-Post`, RFC 8058) that turns off that kind for that Human, signed
  so nobody else can do it for them. Gmail and Yahoo expect it of anybody sending at volume, and it is the
  decent thing below that.
- **The invitation's token travels sealed.** The row gains the token sealed under `DEEVY_SECRET`, cleared the
  moment the email is delivered or the invitation is accepted, revoked or expires. Without `DEEVY_SECRET`
  an invitation is not emailed, and the dialog says so.

## The model

### Vocabulary (CONTEXT.md)

- **Channel** (amended) — gains "an email address", which is now, not later: a team address an admin routes
  Notifications to. A Human's own address is not a Channel, as their Slack direct messages are not; it is a
  column of their preferences.
- **Sender** — the service this instance sends email through: Cloudflare Email Service, Resend, Postmark,
  SendGrid, Mailgun, Amazon SES or an SMTP server. One per instance. _Avoid_: provider (that is sign-in's
  and a Socket's), mailer, integration, ESP.

### The port (`packages/core/src/email/port.ts`, exported as `@deevy/core/email`)

```ts
interface EmailMessage {
  from: { address: string; name?: string };
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>; // List-Unsubscribe and its Post, a Message-ID
}

type SendResult =
  | { delivered: true; id?: string }
  | { delivered: false; retry: boolean; status: number; error: string };

interface EmailSender {
  kind: SenderKind; // "cloudflare" | "resend" | "postmark" | "sendgrid" | "mailgun" | "ses" | "smtp" | "stub"
  send(message: EmailMessage): Promise<SendResult>;
}
```

A sender never throws: a refusal is a result the sweep classifies. `retry` is true for a timeout, a 429 or a
5xx, false for what will never change by waiting — a rejected address, a bad key, an unverified domain — so
the row is retired at once rather than tried six times.

The registry is built by each entry, like `socketModules()`: `emailSenders({ fetch, runtime })` from
`packages/email` (`@deevy/email`: `src/resend`, `src/postmark`, `src/sendgrid`, `src/mailgun`, `src/ses`,
`src/stub`, web-standard only), plus `smtp` from `@deevy/adapters/node` and `cloudflare` from
`@deevy/adapters/workers`. `createApp({ email })` takes it. A sender a runtime cannot offer is absent from
its registry, so choosing SMTP on a Worker is a configuration error the status page names, not a crash.

### Configuration

The environment, read by both entries (`apps/server/src/env.ts`, `apps/web/src/env.ts`):

| Variable                                                               | Meaning                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `DEEVY_EMAIL_SENDER`                                                   | `cloudflare`, `resend`, `postmark`, `sendgrid`, `mailgun`, `ses` or `smtp`.     |
| `DEEVY_EMAIL_FROM`                                                     | The From address, `deevy <deevy@example.com>`; its domain is the one to verify. |
| `RESEND_API_KEY`                                                       | Resend.                                                                         |
| `POSTMARK_SERVER_TOKEN`, `POSTMARK_MESSAGE_STREAM`                     | Postmark; the stream defaults to `outbound`.                                    |
| `SENDGRID_API_KEY`                                                     | SendGrid.                                                                       |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION`                  | Mailgun; the region is `us` (default) or `eu`.                                  |
| `AWS_SES_REGION`, `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY` | Amazon SES v2, signed with SigV4 over `crypto.subtle`.                          |
| `SMTP_URL`                                                             | `smtps://user:pass@host:465` or `smtp://…:587` (STARTTLS). Docker only.         |
| `EMAIL` binding in `wrangler.jsonc`                                    | Cloudflare Email Service (`send_email`). Workers only.                          |

Settings › Email lets an admin choose a sender and paste its credentials instead, sealed under
`DEEVY_SECRET` in a new `email_sender` row (one per Workspace). Settings wins over the environment when it
is set; clearing it falls back. The page always says which is in force and where it came from, and has a
**Send a test email** button that mails the admin.

`DEEVY_DEV_STUB_EMAIL=1` registers the `stub` sender, which keeps the last hundred messages in memory and
shows them at `/dev/email` on the Node server — refused under `NODE_ENV=production`, as the OAuth stub is —
so the `seeded` configuration and the acceptance walk can read what was sent.

### Data (`packages/db/src/schema`)

- `notification_preference.email` — boolean, nullable. Null means the kind's default: on for
  `gate_awaiting` and `run_awaiting_input`, off for the rest.
- `channel.kind` gains `email`; its `config` is `{ address, confirmedAt }`.
- `delivery.target` gains `email` (a team Channel; `targetId` is the Channel) and `email_member` (a Human;
  `targetId` and `recipientMemberId` are the Member), and `invitation` (`targetId` is the invitation).
- `email_sender` — `workspace_id` (primary key), `sender`, `from`, `config` JSON (region, domain, stream,
  SMTP host), `credentials` sealed, `updated_by`, `updated_at`.
- `invitation.sealed_token` — nullable, cleared when the email lands or the invitation stops being
  acceptable.

### What an email says (`packages/core/src/email/render.ts`)

A pure function of the Notification, the Event and the instance's address, called at send time like
`slackMessage`, returning subject, text and HTML. The HTML is one table-based layout that every client
renders, in deevy's indigo and sans-serif, with no images and no tracking pixels. Per kind:

- **A Gate awaiting you** — subject `Gate waiting: acme/deevy#42 · plan`. Body: the Agent and its Sponsor,
  the Checkpoint and its arithmetic ("1 of 2 approvals, not the one who asked"), the record with a link to
  where it lives, the first 600 characters of the Proposal as plain text, and **Open the Gate** to
  `/gates/<id>`.
- **A Run waiting for your answer** — the Agent's question, quoted, and **Answer in deevy**.
- **A mention, an assignment, a finished Run, a delegation** — the headline the inbox already uses, the
  record, and a link.
- **An invitation** — who invited them to which Workspace, the role, when it expires, and **Accept the
  invitation**.
- **A team address's confirmation** — which Workspace wants to send what here, and **Confirm this address**.

Every email ends with why it was sent and how to stop it: for a Human, the one-click unsubscribe and a link
to Settings › Notifications; for a team address, which admin routed it and that Settings › Channels is
where it stops.

### Operations

- `preferences.get` and `preferences.set` carry `email` per kind, and say whether the Human's address is one
  deevy will send to.
- `channels.create` takes `{ kind: "email", address }` and mails the confirmation; `channels.test` sends a
  test once it is confirmed. `POST /email/confirm/:token` (public, signed) confirms.
- `POST /email/unsubscribe/:token` (public, signed, RFC 8058 one-click) and `GET` for the page a click lands
  on.
- `email.status` (admin): the sender in force, its source, the From address, whether it can run on this
  runtime, and the last delivery's outcome. `email.configure`, `email.clear` and `email.test` (admin,
  `sessionOnly`, never an Agent's).
- `invitations.create` takes `send` (default true when a sender is in force) and answers whether it was
  queued. `invitations.list` says whether each was emailed and whether that landed.
- New EventKinds, each with its consumers (`event-text.ts`, the snapshots): `email.configured`,
  `email.cleared`, `channel.confirmed`, `email.exhausted` (a delivery given up on, as `webhook.exhausted`).

### The screens

- **Settings › Notifications** gains an **Email** column beside Inbox, Slack and Slack direct message, and a
  line saying where it goes ("to ada@example.com") or why it cannot ("your sign-in did not confirm your
  address").
- **Settings › Channels** offers **Add an email address**, shows a pending address as waiting for
  confirmation, and routes a confirmed one like any room.
- **Settings › Email** (admins, under Workspace) shows the sender in force and where it comes from, the
  form to set or override it, and **Send a test email**.
- **Invite** sends by email when it can, says so, and still shows the link once.

## The slices

0. **The port, the outbox and Resend** (M). `@deevy/core/email`, `packages/email` with `resend` and `stub`,
   `emailSenders()` in both entries, `DEEVY_EMAIL_SENDER`/`DEEVY_EMAIL_FROM`/`RESEND_API_KEY`, the
   `email_member` and `email` targets, `deliverDueEmails` in the sweep with its bound, `render.ts` for every
   Human kind, `/dev/email`. Acceptance: with the stub, a Gate owed to a verified Human is one email whose
   subject, Proposal excerpt and link are right; an unverified Human gets none; a retryable refusal backs off
   and a permanent one retires at once with `email.exhausted`; Resend's request is asserted exactly against
   its documented shape with an injected `fetch`; the Worker build carries no `node:` import.
1. **A Human's email** (M). `notification_preference.email` with its per-kind defaults, routing for it,
   Settings › Notifications' column and its line, the signed one-click unsubscribe and its page.
   Acceptance: defaults are on for the two waiting kinds and off for the rest; turning a kind off stops it;
   the unsubscribe POST turns off exactly that kind for exactly that Human, and a forged or expired token
   does nothing; the headers are RFC 8058's.
2. **Team addresses** (M). `channel.kind = email`, the confirmation email and endpoint, routing rules,
   `channels.test`, Settings › Channels. Acceptance: an unconfirmed address is sent nothing whatever the
   rules say; confirming makes it routable; one Event routed to it for three Humans is one email.
3. **Settings › Email** (M). `email_sender`, `email.status/configure/clear/test`, precedence over the
   environment, the page. Acceptance: a sender set in Settings is used over the environment and clearing it
   falls back; credentials appear in no output (`secrets.test.ts`'s sentinel); an Agent cannot call any of
   it; a sender this runtime cannot run is refused with the reason.
4. **Postmark, SendGrid, Mailgun and Amazon SES** (M). One module each, every request asserted against the
   service's documented shape, every documented error mapped to retry or retire. SES signs with SigV4 over
   `crypto.subtle`, checked against AWS's published signing test vectors.
5. **SMTP and Cloudflare Email Service** (M). SMTP in `@deevy/adapters/node` on nodemailer (from the
   catalog), tested against an in-process SMTP server; Cloudflare in `@deevy/adapters/workers` through the
   `send_email` binding, an optional `EMAIL` binding in `wrangler.jsonc`, tested with a stand-in binding.
   Acceptance: each is absent from the other runtime's registry and the status page says why.
6. **Invitations by email** (S). `invitation.sealed_token`, the `invitation` target, the email, the dialog
   and the list. Acceptance: inviting with a sender queues one email whose link accepts; the sealed token is
   gone once it lands and on revoke; without `DEEVY_SECRET` nothing is queued and the dialog says so; the
   link is still shown once.
7. **The record** (S). OPERATIONS.md: choosing a sender, each one's setup and DNS (SPF, DKIM, DMARC), the
   environment table, what is and is not sent; DEVELOPMENT.md: the stub; CONTEXT.md; the `deevy-ui` skill's
   test contracts; "What it found" for each slice; PLAN.md's line moved to the past.

## Conventions every slice follows

The definition of done every milestone has had: `vp check`, `vp run -r test`, `web#build:workers` and
`web#check:workers` green, a changeset for anything an upgrader sees, the OpenAPI and MCP snapshots
regenerated, a new EventKind with its consumers, every sweep pass bounded and its statements counted in
`budget.test.ts`, no credential in any output, and a sender module tested against recorded responses with
an injected `fetch`, never the network.

## Deferred

Approving or rejecting from the email itself (ADR-0025 would need a third door, and an email is a weaker
proof than a signed Slack click). Bounce and complaint webhooks from the senders, which would suppress an
address that bounced. A daily digest. An address of a Human's own choosing other than their verified sign-in
address. Editable templates. Sending as an Agent rather than as deevy.

## Risks

- **Deliverability is the operator's DNS.** An email from a domain without SPF and DKIM lands in spam or
  nowhere. Every sender documents its records; OPERATIONS.md links each, and the test email is how an
  operator finds out before a Gate does.
- **Cloudflare Email Service is a beta** and needs Workers Paid for arbitrary recipients; its interface may
  change. It is one module behind the port, and Resend runs on the same Worker on the free plan.
- **Rate limits and the cron budget.** A burst of Notifications larger than a pass's bound waits for the
  next pass rather than failing; the bound is per sender, and a 429 is a retry, not a failure.
- **A From address on somebody else's domain.** Every sender refuses an unverified From; the test email
  surfaces it as the sender's own words.
- **A team address as a way to mail strangers.** Closed by the confirmation link; an unconfirmed address is
  sent nothing, and only an admin can add one.

## What it found

Before slice 0: the base image's OpenSSL had two HIGH CVEs fixed upstream the week the plan landed, and the
image scan failed every pull request until the distroless pin moved (#122). The fixed image was checked
before it was pinned.

0. **The port, the outbox and Resend.** The outbox's claim, backoff and retirement were private to
   `work.ts`; they moved to `outbox.ts` (its own commit) so the email arm shares them without a cycle. The
   browser check on `seeded`, not the tests, found two things: Gates the seed had already ruled on were
   emailed as waiting, because an email cannot be changed afterwards as a Slack message is — so an email
   about a Gate no longer open, or a Run no longer waiting, is now not sent at all; and the Proposal was
   quoted as raw markdown, now `prose()`. Owed emails with no sender are retired rather than kept, so a
   sender configured later sends no backlog of stale Gates.
1. **A Human's email.** The unsubscribe lives under `/api`, because every deployment, the dev SPA's proxy
   included, routes `/api` to the server. `signState` gained a lifetime: a redirect's hour is no use to a
   link read weeks later. The page first lowercased the kind's headline ("a gate is waiting for a human");
   it now names the kind as Settings › Notifications does.
2. **Team addresses.** The confirmation is sent inside `channels.createEmail` rather than through the
   outbox, so the admin reads the sender's refusal at once. The request context carries the senders since.
   `resolveSender` moved to `email/sender.ts` to keep the modules acyclic, and every email now shares
   `renderPlain`. The Slack forms already had a field named "Name", so the email form asks for the address
   alone. A subject read "for deevy on deevy" when the Workspace is called deevy.
3. **Settings › Email.** It went under Agents and delivery, beside Channels and Webhooks, rather than under
   Workspace: it is delivery configuration. The browser check found the form offering the development
   stand-in, which was in force, as the sender to choose; it now starts on one that can be chosen here. The
   CLI's two ratchets — operations that need a Human in a browser, arguments only JSON can carry — each
   gained the new operations, with the reason beside them. The credential sentinel test now sets a sender
   with a sentinel key.
4. **Postmark, SendGrid, Mailgun, SES.** SigV4 over `crypto.subtle` reproduced AWS's published
   `get-vanilla` signature first time. SendGrid answers 202 with the id in a header and wants text before
   HTML; Mailgun takes a form with `h:` headers; SES names its refusal in `x-amzn-ErrorType`.
5. **SMTP and Cloudflare.** `@deevy/adapters` cannot import the core, which dev-depends on it, so the
   senders restate the message shape as `cron.ts` and `queue.ts` do, and the entries' compiler checks
   them. Cloudflare refuses a `List-Unsubscribe` that is not https, and with it the whole email, so a
   plain-http instance sends without one. CI's frozen install caught a lockfile left stale by a dependency
   added and removed between installs. nodemailer never reaches the Worker bundle.
6. **Invitations.** `InvitationSchema` is derived from the table, so the new `sealed_token` column would
   have reached every read had it not been omitted beside `tokenHash`; a test now looks for it. The subject
   doubled the name for a Workspace called deevy, as the confirmation's had.
7. **The record.** This section, OPERATIONS.md's Email section and table rows, DEVELOPMENT.md's stub,
   CONTEXT.md's Channel and Sender, PLAN.md and CLAUDE.md.

Still owed, and said in OPERATIONS.md rather than hidden: none of the seven senders has sent to a real
mailbox from deevy yet. Each is tested against its documented request and answers, SMTP against a real SMTP
server and SigV4 against AWS's vector, and the whole flow was walked on `seeded` through the stub — but the
first real send through each is still the operator's.
