# A Ruling is made in deevy

Supersedes [ADR-0025](./0025-the-forge-may-vouch-for-the-human-who-rules.md) and
[ADR-0027](./0027-a-sign-in-vouches-inside-the-workspace-it-was-to.md), and amends
[ADR-0030](./0030-a-sign-in-may-be-relayed.md). Planned in [simplify.md](../plans/simplify.md), slice 10,
as Matt rewrote it on 2026-11-20.

ADR-0025 let a Human rule where they read the Proposal: a comment starting `/approve` on the record, or a
button in Slack. For that, deevy had to know whose account on the tool was whose. That knowledge was an
Identity (`member_identity`), proved one of four ways: the account the Human signs in to deevy with, a
consent on the tool (Linear), a code typed in a Slack DM, or a verified address that an admin allowed to
count. ADR-0027 then said which sign-ins could vouch inside which workspace. Each tool needed its own
answer, and each answer had a hole. GitLab on another instance knew nobody. Notion offered only an address.
The generic Socket could vouch for nobody, since whoever holds its secret writes its author. A Slack click
had three seconds to be acknowledged.

The first plan for slice 10 closed those holes with more of the same: an OAuth consent on GitHub, GitLab,
Slack and Notion, and an OAuth client the operator registers for three of them. It was the one slice that
added to every tool instead of cutting.

## The decision

**A Gate is ruled on in deevy, and nowhere else.** The tool is told that a Gate is waiting and how it was
ruled on, and it links back. Nothing said in the tool rules.

- **A comment is a comment.** A tracker's `normalize` hands deevy issues and comments. A comment whose first
  line is `/approve` or `/reject` is projected like any other comment, and deevy answers nothing. The generic
  wire format reads an event of kind `ruling` as an event it does not take.
- **The tool links to the Gate.** The comment deevy writes when a Gate waits ends `Rule on it in deevy:` and
  the Gate's address, where it used to say what to type. The Ruling is still said back on the record, with
  its arithmetic.
- **A chat tool is told and sends nothing back.** The chat port is `post`, `update` and `listChannels`. A
  Gate's message in the Project's channel has a link to the Gate and no buttons, and it is still changed in
  place as Rulings land. The Slack app has no request URL, no interactivity and no slash command, so a Slack
  Socket holds a bot token and no signing secret (`webhookSecretFrom: "none"`). `/hooks/:socketId` answers a
  Socket without a tracker with 400.
- **A Human's accounts on the tools mean nothing to deevy.** Identities, link codes, Settings › Identities,
  `IdentityScope`, `AccountLink`, a module's `vouches`, a Socket's `identityByEmail` and the address on an
  `ExternalActor` all go. A Ruling's `via`, `socket` and `verifiedBy` leave the API, because every Ruling is
  made in deevy by a signed-in Member.
- **A Human is who they sign in as.** Sign-in is GitHub, Google, Microsoft or the deployment's own OpenID
  Connect provider. GitLab, Linear, Slack and Atlassian were sign-in providers so that a sign-in could vouch
  for a Ruling from that tool, or for a team that lives there. Neither reason holds now, so they go. Two
  sign-ins are one Human only on one verified address: Better Auth's `allowDifferentEmails` returns to its
  default, since nothing in deevy links an account on another address.
- **Who may join is an address's domain, or an invitation.** The `github_org` and `gitlab_group` allowlist
  rules read a tool's organisations through the sign-in's token. They go with their ports, and GitHub's
  sign-in no longer asks for `read:org`. A rule saved before is not listed and admits nobody.

What stays is everything a Ruling is, as ADR-0020 and ADR-0026 have it: four eyes, Approvals, an approval
standing for its record, a Ruling resuming the Run, and Needs me as the list of what waits on a Human. No
Agent rules (ADR-0004), and a delegated credential decides nothing (ADR-0010, by construction since
ADR-0035).

## How it lands

In slice 10. `sockets/rulings.ts`, `sockets/chat.ts`, `identities.ts`, `account-links.ts` and
`operations/identities.ts` go from the core. The ruling branch goes from `applyInbound`, and the
interaction handling from `/hooks`. `parseRulingCommand` goes from every tracker, the interaction blocks
from Slack's, and the account link from Linear's. The four providers go from `auth.ts`, `provider-env.ts`,
both entries, the hosted artifact, the dev OAuth stub and the sign-in card. Since at most four providers
remain, the card shows every one and its "More ways to sign in" disclosure goes. `member_identity`,
`link_code` and `gate_decision`'s `via`, `socket_id` and `external_ref` stay in the schema, read by nothing,
for slice 12 to drop.

The acceptance tests are `packages/core/tests/rule-in-deevy.test.ts` and
`packages/sockets/tests/rule-in-deevy.test.ts`. The walk (`docs/acceptance.md`) comments `/approve` from the
admin's own sign-in account, sees the Gate still wait, and rules in deevy.

## What it costs

- **A Human leaves the tool to rule.** One click on the link opens the Gate, where the Proposal, the Links
  and the four-eyes rule already are. A team that ruled by comment changes the habit. A comment that still
  starts `/approve` stays on the record, for the team, and does nothing.
- **A team that signed in with GitLab, Linear, Slack or Atlassian signs in another way.** Its Members keep
  their rows. A Member who signed in with GitLab or Slack, whose address they verified, is linked back to
  the same user by their next sign-in at that address. Linear and Atlassian never verified an address, and
  Better Auth links nothing onto an unverified row, so a Member who signed in only with one of them is not
  linked back. Slice 12 starts from an empty database, so they are invited again there.
- **An organisation or group rule stops admitting anyone.** Members who joined by one stay Members. Who
  joins next comes in by their domain or an invitation.

## Why not the alternatives

**Prove an account through each tool's consent (the first slice 10).** Four OAuth flows, three clients the
operator registers, a token per Human per tool, and a page to manage them. All of it serves the one moment
a Human could click a link instead.

**Keep Rulings from the trackers that can vouch, drop the rest.** That keeps two doors with different rules,
so a team would have to know which of its tools counts. It also keeps Identities and the sign-in providers
for the one door, and the Slack signing secret and the three-second handler for the other.
