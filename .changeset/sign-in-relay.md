---
"@deevy/server": minor
---

Several deevy deployments can share one set of sign-in provider Apps through a relay: set `DEEVY_SIGN_IN_RELAY_SECRET` on all of them, `DEEVY_SIGN_IN_RELAY_URL` on each deployment that signs in through the relay, and `DEEVY_SIGN_IN_RELAY_ALLOW` on the one that is the relay, then register `${DEEVY_SIGN_IN_RELAY_URL}/callback/<provider>` as each App's callback. The relay only redirects; each deployment still exchanges its own codes. A deployment's own OpenID Connect provider and a self-managed GitLab are never relayed. Nothing changes for a deployment that sets none of these. See "Signing in through a relay" in OPERATIONS.md.
