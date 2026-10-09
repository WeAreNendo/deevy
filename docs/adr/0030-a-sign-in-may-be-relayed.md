# A sign-in may be relayed

Hosted Workspaces live at `app.deevy.dev/<slug>` ([ADR-0028](./0028-a-hosted-workspace-is-a-durable-object.md),
[ADR-0029](./0029-a-deployment-may-live-under-a-path.md)), and every one of them signs Humans in with the
same GitHub, Google, Microsoft, GitLab, Linear, Slack and Atlassian Apps — the platform's, because a team
must not have to register an OAuth App to sign in. A provider's App holds one callback URL, or a short list
it matches exactly. A Workspace's own callback is `app.deevy.dev/<slug>/api/auth/callback/<provider>`, one
per Workspace, which no App can hold. This records how they share one.

## The decision

**One callback, the relay's, is registered with every provider, and the relay only redirects.** A deevy
behind a relay (`DEEVY_SIGN_IN_RELAY_URL`, `packages/core/src/sign-in-relay.ts`) names the relay's
`/callback/<provider>` as its `redirect_uri` when it starts a sign-in or a link and again when it exchanges
the code, as OAuth requires, and wraps its own `state` with its own Better Auth URL, signed with a secret it
shares with the relay. The provider sends the browser to the relay with that state; the relay checks the
signature and that the deevy named is one it was told about (`DEEVY_SIGN_IN_RELAY_ALLOW`), and sends the
browser there with everything the provider sent and the deevy's own state put back. The deevy then finishes
the sign-in exactly as it would without a relay: it finds its state, checks the state cookie this browser
carries, exchanges the code with its own client secret, and admits the Human through `admit()`.

The relay never exchanges a code and never sees a token. A code delivered to a deevy that did not start the
sign-in finds no state there and signs nobody in. A deevy's own OpenID Connect IdP, and a GitLab instance
that is not gitlab.com, are never relayed: their Apps are registered with the deevy itself.

A hosted Workspace's relay is `app.deevy.dev/auth`, served by the hosted Worker. Any deployment can be one
for others (`/relay/callback/<provider>` under its path), which is how the tests run it, and how an operator
with several deployments could share one set of Apps.

## Why not the alternatives

**Better Auth's `oAuthProxy`.** Built for this, and close: but the relay exchanges the code with the
provider's secret and hands the profile and the tokens to the deevy in the URL, encrypted with one secret
every deevy holds, so whoever holds it can forge a signed-in profile for any address at any of them. Its
`redirect_uri` is also built from the deevy's own base path, which differs per Workspace under a path, so
Google's exact match fails; it does not relay `/link-social`; and in 1.7.3 it would relay a Workspace's own
OIDC IdP. Refused.

**A callback per Workspace.** GitHub matches a subdirectory of its callback, so `app.deevy.dev/` would
cover every Workspace; Google, Microsoft and Atlassian match exactly and hold a bounded list. Refused: the
platform would sign in with some providers and not others.

**Sign in at the console, then hand the Workspace a session.** One sign-in for every Workspace, which is
"one account across Workspaces" — deferred in ADR-0028, because it moves identity out of the Workspace's
database. Refused for now.

## The cost, stated

- Every deevy behind the relay holds the platform's client secrets, to exchange its own codes. In the hosted
  Worker they are one Worker's secrets already; a self-hosted operator sharing Apps across deployments
  shares their secrets across them.
- The relay secret signs where a code may be sent. Whoever holds it can send a sign-in's callback to any
  deevy the relay allows — where it still fails the state check — but nowhere else: the allowed list is the
  relay's, not the state's.
- An error that Better Auth reports from the callback lands where the request's base URL says, which is the
  relay's. The SPA passes absolute callback and error URLs, so a failed sign-in or link comes back to the
  Workspace.
