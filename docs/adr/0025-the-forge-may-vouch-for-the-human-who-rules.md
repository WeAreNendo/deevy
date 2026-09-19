# The forge may vouch for the Human who rules

Amends [ADR-0010](./0010-a-delegated-credential-cannot-decide-a-gate.md), which says a delegated
credential cannot decide a Gate, and leaves [ADR-0004](./0004-agents-never-approve-gates.md), which says
an Agent never does, untouched.

Once an Issue is a projection of a record in a Socket
([ADR-0024](./0024-an-issue-is-a-projection-of-a-record-in-a-socket.md)), the Human who should rule on a
Gate is reading the Agent's Proposal as a comment on their GitHub issue or as a message in Slack, and the
one thing they cannot do there is rule. ADR-0010 had them open deevy in a browser for that, and it was
right to at the time: the credentials it was ruling out were the ones deevy minted and handed to a program.
This records the two doors that open beside the browser, the conditions on each, and the hole that stays.

## What ADR-0010 was about

It was written as "a Gate is decided by a Human signed in to deevy, in a browser, or not at all", and the
browser was the means rather than the rule. The rule was that somebody deevy can vouch for is present when
the decision is made. An API key or an OAuth access token can be spent by a program with no Human present,
which is why `sessionOnly` refuses them, and that does not change: `gates.approve` and `gates.reject`
keep `sessionOnly`, the registry's `authorize` keeps refusing an `api_key` or `oauth` principal, and the
API, MCP and CLI doors are exactly as they were.

## The decision

**A Ruling from outside deevy is accepted when two parties vouch for the Human, and neither of them is a
program holding a credential deevy issued.**

The external system vouches for the person: a GitHub `issue_comment` arrives signed with the webhook
secret only GitHub and this Socket hold, from a session GitHub authenticated, carrying a user id GitHub
assigned; a Slack `block_actions` arrives signed with the app's signing secret within a five-minute window,
carrying a user id Slack assigned. deevy vouches for the mapping: a `member_identity` row binding that
provider, that instance and that user id to one Member, created either because the Human signed in to
deevy with that same provider (Better Auth's `account` row already carries the id), or because the Human,
while signed in to deevy, completed a link — an OAuth round trip in user scope for Linear, a single-use
ten-minute code that Slack delivered to that user alone and deevy redeems only from a signed-in session. A
display name or a login is never matched on: both are renamable and reassignable, and `external_login` is
kept for display only.

**The same function rules.** `recordRuling` is the one policy function behind every door: the browser calls
it with `via: "web"`, the tracker's inbound handler with `via: "socket"` and the comment's id, the Slack
Socket with `via: "slack"` and the message's channel and timestamp. It asserts a Human, refuses a suspended
Member, checks the named approvers, applies the requester exclusion and the four-eyes arithmetic
([ADR-0020](./0020-a-gate-may-want-more-than-one-human-and-may-exclude-the-one-who-asked.md)), and appends
the same Events. A refusal on the tracker is the reply comment, in the words the web card uses. Every
decision records `via`, and every place a Ruling is shown says where it came from.

**The hooks door is beside the registry, not through it.** An inbound delivery is not an operation and
does not build a principal; it is verified, deduplicated and applied by the Socket's handler, and the
ruling it carries reaches `recordRuling` with a Member the identity table named. `sessionOnly` is not
weakened, widened or bypassed: it still describes what a credential deevy minted may do.

**Conditions, each enforced in code and named here.** The signature verified over the raw body. The
delivery id new: GitHub signs no timestamp, so replay protection is the `inbound_delivery` table and a
comment id already on a decision. The author not a bot, which is also what stops deevy's own mirrored
comment, which quotes the words, from ruling. A mapping whose `verified_by` is `sign_in`, `oauth` or
`link_code`. `email` is accepted only for Notion, only where an admin enabled it on that Socket, only
against a verified email on the deevy side, and badged "(email)" on the Ruling: Notion offers nothing
better than its user list, and the workspace admin who controls that list becomes a vouching party the
badge names.

## What it protects against, and what it does not

It protects against every credential deevy has ever issued. An Agent's key cannot rule; a Human's MCP token
cannot rule; a CLI token cannot rule; a ruling token pasted into a comment does not exist, because it
would be a delegated credential readable by every reader of the repository, which is exactly ADR-0010's
hole in a new place.

It does not protect against a program holding the Human's own GitHub or Slack account — a `gh` with their
token, an agent with their Slack session — which rules as them. ADR-0010 never protected against that
either: an agent driving the Human's browser could always click Approve, because what a Human does with
their own credentials is outside deevy's. The line deevy holds is that no credential deevy minted rules a
Gate. Who holds your GitHub account is between you and GitHub, and the Identities page says so beside
the Unlink button.

## Why not the alternatives

**Widen `sessionOnly` to accept any principal the identity table can name.** One line, and it erases the
distinction between a Human present and a program holding their token. Refused.

**Trust the commenter's login or display name.** Renamable, reassignable, and on Slack free text. Refused.

**Make Slack, Linear and Notion sign-in providers so `account` could be reused.** A button on the sign-in
page for each, `accountLinking` semantics deevy does not want, a user row a Slack login could create, and a
table keyed per provider where two GitLab hosts or two Slack workspaces would collide. Refused; the
identity table is small and says what it means.

**Accept email matching everywhere.** GitHub commenters have no reliable email in a webhook, and an
attacker with an address is cheap. Refused everywhere but Notion, with the conditions above.

## The cost, stated

A Human who rules from the tracker never sees the four-eyes arithmetic unless the reply comment states it,
so it always does. A repository admin can edit the App's comment; deevy acts on `created` and ignores
`edited`, and the request row rather than the comment is the authority. A Slack click has to be
acknowledged within three seconds on a cold Worker, so the handler writes the decision and returns and
everything Slack-facing after that is the outbox. Signing secrets rotate, and the previous one is accepted
for a day. And one more table, one more page, and one more sentence in the operator's guide about who can
hold your account.
