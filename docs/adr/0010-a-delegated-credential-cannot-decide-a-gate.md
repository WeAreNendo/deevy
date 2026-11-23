# A delegated credential cannot decide a Gate

> Amended by [ADR-0035](./0035-only-agents-speak-mcp.md): no delegated credential is minted any more, and a
> key stands only for an Agent, so `sessionOnly` went with the credentials it refused. The rule stands for
> any that comes back.

Amends [ADR-0004](./0004-agents-never-approve-gates.md), which says an Agent never approves a Gate. M2 built
that rule as `assertHuman`, a check on the Member's kind, and then found it was not the whole rule. Once deevy
mints OAuth access tokens for a Human's own MCP client (ADR-0007), a Gate decision arriving from an agent loop
is a decision by a Human Member: `member.kind` is `human`, `assertHuman` passes, and the thing that pressed
Approve is a model holding that Human's credential. The rule ADR-0004 meant to state is not about what kind of
Member decides, it is about who is present when the decision is made.

So the operation registry gained `sessionOnly: true`, carried by `gates.approve` and `gates.reject` and
nothing else. It is checked in the same middleware as the `public | session | member | admin` ladder, against
the `Principal` resolved once per request: a cookie principal passes, an `api_key` or `oauth` principal is
refused with "Only a Human signed in to deevy can do that". A Gate is decided by a Human signed in to deevy,
in a browser, or not at all. The Agent still recommends in its Run summary, and an Agent that reaches a Gate
mid-Run hands the Human a URL and stops (`runs.requestApproval`); the decision itself never travels back
through the protocol that asked for it.

## Considered options

- **Leave it at `member.kind`.** The check ADR-0004 already described, and the one M2 shipped first. It
  refuses every Agent and no delegated credential, so the proposer-approver separation holds only as long as
  no Human connects an MCP client — which is a feature deevy ships. Rejected.
- **A scope the token does not carry.** OAuth scopes ride on the principal and are enforced by nothing in v1
  (docs/plans/m2.md), so this would be a rule written where nothing reads it, and it would break the moment a
  client asked for the scope and a Human granted it without reading the consent screen. Rejected.
- **`sessionOnly` on the operation.** Chosen. The refusal is about the credential, not the request, so it
  belongs in the middleware beside the auth rule, where it runs before the handler and before the Issue is
  even loaded.

## Consequences

- A Human who wants to approve a Gate opens deevy. That is the point, and it is the one thing their MCP client
  cannot do for them; everything else it can.
- `sessionOnly` is sayable on any operation, not only Gates. `oauthClients.revoke` is the other candidate
  shape — a delegated credential revoking the credentials beside it — and it is kept out of MCP instead.
- It is proved against a real token, not a stub: `packages/core/tests/oauth.test.ts` runs the authorization
  code flow, mints an access token for a Human Member, shows `/api/me` answering as that Human, and shows
  `POST /api/issues/DEV-1/gate/approve` with the same bearer coming back 403.
