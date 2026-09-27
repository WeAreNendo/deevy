---
"@deevy/core": minor
"@deevy/server": minor
"@deevy/web": minor
---

**deevy can now offer Microsoft, Linear, Slack and Atlassian sign-in**, beside GitHub, Google, GitLab and your own OpenID Connect IdP. Set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` (and `MICROSOFT_TENANT_ID` to narrow the accounts it takes: `organizations`, or your tenant's id), `LINEAR_`, `SLACK_` or `ATLASSIAN_` pairs. Each one's redirect URI is `${BETTER_AUTH_URL}/api/auth/callback/<id>`.

What each provider can let in depends on whether it vouches for the address:

- **Slack** does, so an `email_domain` rule admits a Slack sign-in.
- **Microsoft** does only when the tenant sends the optional `verified_primary_email` and `verified_secondary_email` claims; `docs/OPERATIONS.md` says where to add them. Without them, a Microsoft sign-in comes in by invitation.
- **Linear and Atlassian** never do, so they come in by invitation only.

Providers are offered in the order an engineering team reaches for them: GitHub, Google, Microsoft, GitLab, Linear, Slack, Atlassian, and your own IdP last. `DEEVY_SIGN_IN_ORDER` puts the ids you name first, e.g. `oidc,github` for a company that signs in through its IdP. deevy also remembers which provider a browser signed in with last, in a cookie holding only the provider's id.
