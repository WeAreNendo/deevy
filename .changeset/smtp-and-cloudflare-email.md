---
"@deevy/adapters": minor
"@deevy/email": minor
"@deevy/server": minor
"@deevy/web": minor
---

**Two more ways to send email, each where it can run.**

- **SMTP, on the Docker image.** Set `DEEVY_EMAIL_SENDER=smtp` and `SMTP_URL`, such as `smtps://user:password@mail.example.com:465`, or `smtp://…:587`, which upgrades with STARTTLS. You can also choose "SMTP server" under Settings › Email. A server's 5xx refusal is given up on in its own words; a 4xx, or a server that doesn't answer, is tried again.
- **Cloudflare Email Service, on Workers.** Uncomment the `send_email` binding named `EMAIL` in `wrangler.jsonc` and set `DEEVY_EMAIL_SENDER=cloudflare`. No third-party account or key is needed. It is a Cloudflare beta, and reaching an address that isn't verified on your account needs the Workers Paid plan. On an instance served over plain http, emails go without the one-click unsubscribe header, which Cloudflare refuses there; the footer link still works.

A sender a deployment can't run (SMTP on Workers, Cloudflare on Docker) is refused with the reason, under Settings › Email and at startup.
