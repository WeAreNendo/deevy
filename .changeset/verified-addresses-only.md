---
"@deevy/core": patch
---

**An address now counts only when the sign-in provider verified it.** Signing in with the `DEEVY_ADMIN_EMAIL` address makes you the admin, and an `email_domain` allowlist rule admits you, only when the provider vouched for that address. Otherwise a provider that lets somebody put any address on an account, such as an OpenID Connect IdP that omits `email_verified`, would let a stranger claim the admin's address or an allowed domain. A sign-in with an unverified address can still accept an invitation, and GitHub organization and GitLab group rules are unaffected, since neither depends on the address.
