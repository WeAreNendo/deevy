---
title: Sending email
description: Choose the service a self-hosted deevy sends email through, from Resend or Amazon SES to your own SMTP server, and check it with a test email.
sidebar:
  order: 6
---

deevy emails a Human when something waits on them, a team address when a Notification is routed to it,
and a person you invite. It sends through a service you already use. Until you set one up, deevy emails
nobody, and the inbox and Slack work as before. [Email](/notifications/email/) describes what is sent and
to whom.

## Choose a sender

| Sender                   | `DEEVY_EMAIL_SENDER` | Runs on | What it needs                                                                   |
| ------------------------ | -------------------- | ------- | ------------------------------------------------------------------------------- |
| Resend                   | `resend`             | Both    | `RESEND_API_KEY`, with the From's domain verified in Resend                     |
| Postmark                 | `postmark`           | Both    | `POSTMARK_SERVER_TOKEN`, with the From verified as a sender signature           |
| SendGrid                 | `sendgrid`           | Both    | `SENDGRID_API_KEY` with Mail Send, with the From verified as a sender or domain |
| Mailgun                  | `mailgun`            | Both    | `MAILGUN_API_KEY` and `MAILGUN_DOMAIN`, the sending domain                      |
| Amazon SES               | `ses`                | Both    | `AWS_SES_REGION`, `AWS_SES_ACCESS_KEY_ID` and `AWS_SES_SECRET_ACCESS_KEY`       |
| SMTP server              | `smtp`               | Docker  | `SMTP_URL`, your mail server or a provider's relay                              |
| Cloudflare Email Service | `cloudflare`         | Workers | The `EMAIL` binding                                                             |

Whichever you choose, also set `DEEVY_EMAIL_FROM`, the address deevy sends as, such as
`deevy <deevy@example.com>`, on a domain your sender has verified.

For example, on the Docker image:

```bash
DEEVY_EMAIL_SENDER=resend
DEEVY_EMAIL_FROM=deevy <deevy@example.com>
RESEND_API_KEY=re_...
```

On a Worker, put the key in with `wrangler secret put RESEND_API_KEY`, and the other two as secrets or
`vars` the same way.

A sender set up halfway, such as `DEEVY_EMAIL_SENDER` with no key, stops the Docker image at startup with
a message naming what is missing. A Worker stays up, sends nothing, and says what is missing under
**Settings › Email**.

### Each sender's details

- **Postmark** sends on the `outbound` message stream, its transactional one. Set
  `POSTMARK_MESSAGE_STREAM` to use another.
- **Mailgun** uses its US region. Set `MAILGUN_REGION=eu` for a domain in Mailgun's EU region.
- **Amazon SES** needs an IAM key that may `ses:SendEmail` and nothing else, the From verified in that
  region, and the account out of the SES sandbox to reach anyone who isn't verified too. deevy signs the
  requests itself.
- **SMTP** takes one URL with the credentials in it: `smtps://user:password@smtp.example.com:465`, or
  `smtp://user:password@smtp.example.com:587`, which upgrades to TLS with STARTTLS. A Worker can't speak
  SMTP, so this sender is for the Docker image only.

### Cloudflare Email Service

On a Worker, deevy can send through Cloudflare's own email service. It is in beta, and reaching an address
not verified on your Cloudflare account needs the Workers Paid plan.

1. In `apps/web/wrangler.jsonc`, uncomment the `send_email` binding:

   ```jsonc
   "send_email": [{ "name": "EMAIL" }],
   ```

2. Build, check and deploy again, as in [Deploy to Cloudflare Workers](/self-hosting/cloudflare-workers/).
3. Set `DEEVY_EMAIL_SENDER=cloudflare` and `DEEVY_EMAIL_FROM`.

## Make sure it arrives

**The From's domain decides whether email arrives.** Publish the SPF and DKIM records your sender gives
you, and a DMARC record for the domain. Without them, most email ends in spam or nowhere, and nothing in
deevy can fix that.

Then send yourself one: under **Settings › Email**, choose **Send a test email**. deevy mails you, the
admin, and says what the sender answered, which is how you find a wrong key or an unverified domain before
a Gate does.

When a sender refuses an email for good, for a bad key, an unverified domain or a suppressed address,
deevy gives up on it at once and records why, in the sender's own words, in **Settings › Event log**. A
throttle or an outage is retried for about a quarter of an hour.

## Choose it in Settings instead

An admin can set the sender under **Settings › Email**, in **Set the sender here**: choose the **Sender**,
fill in **From** and its key, and **Save**. That choice overrides the environment's until they choose
**Use the environment's sender**.

A key saved there is sealed with `DEEVY_SECRET` and never shown again, so saving one needs `DEEVY_SECRET`
set. If `DEEVY_SECRET` changes, deevy can no longer open the saved key and asks for it again.

## When it goes out

Email goes out with deevy's background work: within a minute on a Worker, and every
`DEEVY_SWEEP_INTERVAL_SECONDS` on the Docker image. An email about a Gate that has been ruled on, or a
question that has been answered, by the time its turn comes is not sent, because an email can't be changed
afterwards.

Without a sender, what would have been emailed is dropped rather than kept, so setting one up next week
doesn't send a week of stale Gates at once. Invitations are emailed only when both a sender and
`DEEVY_SECRET` are set; the invitation's link is shown to whoever created it either way.
