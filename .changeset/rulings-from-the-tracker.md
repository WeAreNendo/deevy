---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/sockets": minor
---

Approve or reject a Gate from the tracker. A Human who comments `/approve` or `/reject <why>` on the record
where deevy asked for the ruling rules exactly as the button in deevy does — the same Checkpoint policy, the
same refusals in the same words — and the Gate records that the Ruling came through the tool.

It counts only when deevy can prove who wrote the comment, by the tool's own account id and never by a
login: the account a Human signs in to deevy with (a GitHub sign-in rules from github.com with no extra
step), an account they linked under the new **Settings › Identities**, or — only on a Socket where an admin
turned on `identityByEmail` — an address they verified. A comment deevy cannot place, one the Checkpoint
refuses, and one on a record with nothing waiting are answered on the record; a bot's comment is ignored.
Settings › Identities lists the accounts that rule as you and lets you unlink one, which stays unlinked
until you link it again.

Upgrading changes one sign-in behaviour: a signed-in Human can now link a second account whose address
differs from theirs (Better Auth's `allowDifferentEmails`). It applies only to that explicit link from a
signed-in session; signing in on an address another Human holds still links nothing.

New: the `member_identity` table (applied by the migrator), the `identities.list`, `identities.revoke` and
`identities.restore` operations, `identityByEmail` on `sockets.update`, `verifiedBy` on a Gate's decisions,
and the `gate.ruling_refused`, `identity.linked` and `identity.revoked` Events.
