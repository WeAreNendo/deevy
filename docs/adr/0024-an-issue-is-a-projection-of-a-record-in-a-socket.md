# An Issue is a projection of a record in a Socket

deevy v1 was a tracker with an agent layer on top: its own Issues with keys, a Workflow of States and
Gates per Project, Documents materialised from templates and edited live, Labels, Teams, comments, a
board, and beside them the part that was actually new — an Agent with its own identity and a Sponsor
([ADR-0001](./0001-agents-are-first-class-members.md)), a Run a Human can read
([ADR-0016](./0016-a-run-is-an-agents-and-the-registry-says-which-way-an-operation-faces.md)), a Gate an
Agent cannot pass ([ADR-0004](./0004-agents-never-approve-gates.md)), and an Event log that says who did
what. A team that keeps its work in Linear or GitHub and its plans in Notion was being asked to move all of
it into deevy, or to keep two of everything, to get the part it wanted. That is a heavy layer, and it is
not the product.

This records the decision to take the tracker out, and the choices inside that decision which are
expensive to reverse. The plan is `docs/plans/sockets.md`.

## The decision

**An Issue lives outside deevy, always, and deevy holds a projection of it.** A **Socket** is one connected
external tool under one identity — a GitHub App, a Linear app, a GitLab application, a Notion integration,
a Slack app. An Issue is a row that mirrors a record in a tracker Socket: its URL, its key as the tracker
writes it, its title, body and state as the tracker last said them, refreshed by the tracker's signed
webhooks and by a bounded poll. deevy authors none of it. There is no issue editor, no board, no key of
deevy's own; `DEV-42` is gone and `acme/deevy#42` is what a Human reads. The alternative that kept a
stripped built-in tracker for the team with none was refused: it is the same layer in a smaller coat, and
everyone with a repository already has GitHub Issues.

**The URL is the canonical handle and the key is an alias.** Every operation that names an Issue takes one
string and resolves an id, a URL or a key, refusing with both candidates when two Sockets know a record by
the same key. The URL is what a Human pastes and what a webhook carries, and it is unambiguous by
construction.

**A Run still points at deevy's row.** `run.issueId` stays a non-null foreign key to the projection, with
its cascade and the partial unique index that holds "one open Run per Issue and Agent". A Run is deevy's
own record of an attempt on deevy's own row; a projection is never deleted except by a deliberate purge,
so the cascade is not exercised in ordinary operation and every join that reads a Run keeps its shape. A
loose external reference would have put a null branch into each of them for a case that does not arise.

**One identity per Socket, and a routing rule picks the Agent.** The tracker sees one "deevy" App. Which
Agent gets a record is a label `agent:<handle>`, a mention `@deevy <handle>`, or the Project's default
Agent, and a routed record appends the same `issue.assigned` Event that has always opened a Run. Every
comment deevy writes is signed with the Agent's name and the Run's id, because the tracker shows the App as
the author. Per-Agent identities, where a provider makes them cheap, are a later item the port leaves room
for; they are not what a team should have to register to start.

**A Project is a binding, not a container.** It names the Socket and container its Issues come from, the
Socket and repository its code goes to, optionally where its documents are read from, its default Agent,
its routing rule, its Checkpoints and how much deevy says back. What an Agent may see is still a grant on a
Project ([ADR-0011](./0011-agents-are-default-denied-per-operation.md)).

**Documents and the Workflow go, and a Gate is a request on a Run.** A Run asks to pass a **Checkpoint** —
`plan`, `ship`, or any name the Project's policy lists — with a **Proposal** in markdown and links. The
Human rules on that text. The Proposal is immutable on its request; a changed Proposal is a new request. A
visit is a request: approvals count on one, a rejection ends it, asking again is the next visit. That is
[ADR-0020](./0020-a-gate-may-want-more-than-one-human-and-may-exclude-the-one-who-asked.md)'s arithmetic
with the two timestamps it was keyed on gone, and its policy — how many, whether the one who asked counts,
who may — moved from a workflow State onto the Project's Checkpoint. The requester is the Human behind the
Run: the one who triggered it, or the Sponsor when an Agent did. Where the team keeps plans afterwards is
the Agent's job and a link; deevy's job is to have held the question.

**deevy holds credentials now, sealed.** v1 never stored a credential for another system; the only one it
touched lived in the agent runtime's own process ([ADR-0019](./0019-the-session-is-its-own-user-and-git-goes-through-the-supervisor.md)).
A Socket is a credential by definition, so `packages/core/src/secrets.ts` seals them with AES-GCM under a
key derived from a new `DEEVY_SECRET` — not from `BETTER_AUTH_SECRET`, whose rotation signs everyone out
and must not also destroy every Socket. No sealed value appears in any output schema, and a test greps for
a sentinel to prove it. An instance with no secret cannot connect a Socket, which is the honest floor.

**The core never imports a provider.** Port types live in the core; implementations live in
`packages/sockets`, written on `fetch` and `crypto.subtle` with no `node:` import, and the two runtime
entries inject the registry through `createApp({ sockets })`. That is what keeps
[ADR-0006](./0006-runtime-agnostic-core-node-first.md) true with five more HTTP clients in the tree: the
Workers build compiles the same package, and a leak fails there as it always has.

**A clean break.** The migration history is re-baselined and the first release of this shape starts from an
empty database. Carrying Issues, Documents and comments as a read-only archive was costed and refused: it
keeps twelve tables and their screens alive to serve data nobody can act on.

## What it does not change

The four things PLAN.md says make deevy different all stand, and the fourth gains a clause: deevy never
runs agents ([ADR-0003](./0003-deevy-triggers-agents-but-never-runs-them.md)) and never owns the tracker.
An Agent has a Sponsor. An Agent never rules a Gate, on any door. The Event log is the only record. One
typed core projected to every surface ([ADR-0005](./0005-one-core-three-surfaces.md)), so the operations
this removes and adds show up on REST, MCP and the CLI without a hand-kept list. The agent runtime stays
outside the core, stays a service ([ADR-0013](./0013-the-reference-runtime-is-a-service-not-a-ci-job.md)),
keeps its harness seam ([ADR-0018](./0018-a-harness-is-a-cli-behind-the-session-seam.md)) and keeps the
credential out of the session; what changes is where it gets the repository and the token, which is now a
per-Run answer from deevy rather than its own environment. A delegated credential still never rules a Gate
([ADR-0010](./0010-a-delegated-credential-cannot-decide-a-gate.md)); the doors this opens are argued in
[ADR-0025](./0025-the-forge-may-vouch-for-the-human-who-rules.md). Delegation through sub-issues
([ADR-0022](./0022-a-parent-finishes-and-the-last-child-wakes-it.md)) keeps its ceilings, its wake-up and
its cross-Project rule; what changes is that the sub-issue is created in the tracker and deevy keeps the
tree where the tracker cannot link it.

[ADR-0021](./0021-a-document-is-live-and-markdown-is-what-it-becomes.md) is superseded: there is no
Document to be live. ADR-0020 and ADR-0022 are amended as above, semantics kept and storage moved.

## Why not the alternatives

**Sync external records into authorable Issues.** Two sources of truth to reconcile, every conflict a
support question, and the tracker's own screens still the ones people open. Refused.

**A stripped built-in tracker as one Socket among others.** Refused above. The zero-config case is a
repository with GitHub Issues, which is every repository.

**Per-Agent identities first.** The best attribution, and a GitHub App or a Linear app per Agent before a
team has run one. Refused as the default; kept as the deferred item.

**A Run that references the external record directly, with no projection row.** A left join and a null
branch in every read of a Run, the inbox, the sweeps and the ceilings, to avoid a row that costs one upsert
per delivery. Refused.

## The cost, stated

deevy stops being usable on its own: no Socket, no work. An operator registers an App per tool and pastes
or converts its credentials, and keeps `DEEVY_SECRET` with the volume. A laptop instance needs a tunnel to
receive a webhook, or lives with polling. The tracker's bot account authors every comment. The projection is
as fresh as the last delivery or poll, never fresher. Roughly 8,800 lines of production code come out and
roughly 8,000 go in, so the simplification is in concepts and in the operator's story rather than in size,
and this ADR says so rather than claiming otherwise.
