# A sign-in vouches inside the workspace it was to

Amends [ADR-0025](./0025-the-forge-may-vouch-for-the-human-who-rules.md), which let a sign-in to deevy
vouch for a Human ruling from github.com or a GitLab instance and refused to make Linear or Slack sign-in
providers for that purpose, and leaves its two doors, its conditions and its hole as they were.

Linear and Slack became sign-in providers anyway, for their own sake: a team that lives in them wanted to
sign in with them (2026-09-26, behind "More ways to sign in"). Better Auth's `account` row for such a
sign-in carries the provider's own user id — Linear's viewer id, Slack's `https://slack.com/user_id` —
which is the same id a Linear comment or a Slack click carries. So the question ADR-0025 answered for
GitHub came back for these two: does signing in to deevy with that account make its comments and clicks
yours? This records the answer.

## The decision

**Yes, inside the workspace the sign-in was to, and only there.** Both tools scope an account to one
workspace, unlike github.com, where one account is one person everywhere:

- A Linear user id is one workspace's: Linear's `User` belongs to one organization, a person in two
  workspaces is two users, and signing in picks one. The ids are UUIDs, so a Linear Socket's comment by the id a Human signed in with
  can only be that Human in that Socket's workspace. The Linear Socket names `linear` as its sign-in
  provider, and the match is the proof, as on github.com.
- A Slack user id is issued within a team, and Sign in with Slack names a user by two claims, the user id
  and the team id. The id token Slack's token endpoint hands over at sign-in names the team (`https://slack.com/team_id`), and Better Auth keeps
  it on the `account` row. The Slack Socket names `slack` as its sign-in provider together with that claim
  and its own team id; a sign-in counts only when its kept id token says the same team. No id token, one
  that cannot be read, or another team, and the sign-in vouches for nobody. A click from a guest of another
  team in a shared channel, which carries the guest's own team, never counts by sign-in either.

What the match finds is written down as an Identity with `verified_by: "sign_in"`, as ADR-0025 does for
GitHub, so the Human sees it on Settings › Identities and can take it back.

**Signing in is not offered as the way to link these.** Settings › Identities offers "Link GitHub" by
signing in with GitHub, because a GitHub account is the same everywhere. A Linear or Slack sign-in could be
to another workspace than the Socket's, so those keep the links ADR-0025 gave them — Linear's own consent
page, which is the Socket's workspace, and Slack's code, delivered to that user alone. A Socket's scope says
so (`IdentityScope.linkBySignIn: false`).

## What it protects against, and what it does not

It protects against an id from one workspace standing for a person in another: a Linear id cannot, being a
UUID, and a Slack id is held against the team its sign-in was to and the team the clicker is from. It adds
nothing to ADR-0025's hole: a program holding the Human's own Linear or Slack session rules as them, as it
did once they linked.

The id token is read without checking its signature. It came from Slack's token endpoint over TLS, in
exchange for a code and the client secret, and was written by the server that asked for it; nothing but
the database could change it after, and whoever can write the database can write a `member_identity` row
as easily.

## Why not the alternatives

**Leave the sign-ins out of rulings.** A Human who signed in with Slack would click Approve and be handed a
code to link the account they are signed in with. Refused: it asks the Human to prove what deevy already
holds proof of.

**Trust a Slack sign-in's user id without the team.** Slack ids look unique in practice, but Slack names a
user by the pair, and Slack Connect puts other teams' users on the same buttons. Refused.

**Store the team as an Identity at sign-in.** A database hook could write a `member_identity` row for every
Slack or Linear sign-in. It would link accounts to Workspaces with no Socket for them, before anyone ruled,
where ADR-0025 writes an Identity down the first time an account rules. Refused.

## The cost, stated

The sign-in's team lives in an id token rather than a column, so a Slack account row without one never
vouches and its Human is asked for the code. So is one whose sign-in named another team than the Socket's
— two workspaces of an Enterprise Grid, say. Both fail closed, and one code fixes either.
