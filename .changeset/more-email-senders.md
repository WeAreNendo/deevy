---
"@deevy/email": minor
"@deevy/web": minor
---

**deevy can now send email through Postmark, SendGrid, Mailgun or Amazon SES as well as Resend**, on either deployment. Set `DEEVY_EMAIL_SENDER` to `postmark`, `sendgrid`, `mailgun` or `ses`, or choose one under Settings › Email:

- **Postmark**: `POSTMARK_SERVER_TOKEN`, and optionally `POSTMARK_MESSAGE_STREAM` (default `outbound`).
- **SendGrid**: `SENDGRID_API_KEY`.
- **Mailgun**: `MAILGUN_API_KEY` and `MAILGUN_DOMAIN`, and `MAILGUN_REGION=eu` for a domain in Mailgun's EU region.
- **Amazon SES**: `AWS_SES_REGION`, `AWS_SES_ACCESS_KEY_ID` and `AWS_SES_SECRET_ACCESS_KEY`, ideally for an IAM key that may `ses:SendEmail` and nothing else. Requests are signed in deevy itself, so it needs no AWS SDK and works on Workers.

A refusal the sender says is permanent (an unverified domain, a bad key, a suppressed recipient) is given up on at once, in the sender's own words; a throttle or an outage is tried again.
