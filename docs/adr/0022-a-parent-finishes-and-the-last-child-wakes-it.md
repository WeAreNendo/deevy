# A parent finishes, and the last sub-issue wakes it

An Agent's unit of work is an Issue and its memory is a Run. Both are finite: a Run is one attempt
([ADR-0016](./0016-a-run-is-an-agents-and-the-registry-says-which-way-an-operation-faces.md)) and a session
has a context window. Work larger than either had nowhere to go. An Agent could write a decomposition into a
Document and wait for a Human to type it back in as Issues, or it could do the whole thing in one Run and
hand a Gate a change too large for a Human to actually read — which is the failure the four-eyes work
([ADR-0020](./0020-a-gate-may-want-more-than-one-human-and-may-exclude-the-one-who-asked.md)) spent four
slices trying to prevent, since review quality is a function of diff size.

The parent column and the cycle guard were already there; an Agent could already open an Issue under another
one. What was not there was any of the machinery that makes that a handover rather than a gesture. This
records the choices that are expensive to reverse.

## The decision

**A parent does not wait. It finishes, and the last sub-issue closing wakes it.** The delegating Run ends
cleanly with a summary of what it handed over. When the last child enters a `done` State, deevy starts a
fresh Run on the parent with the `children_done` trigger, and the Agent rebuilds its picture from the
tracker — the sub-issues, their Documents, their Runs' summaries, all of which it can already read.

The alternative was a `blocked` status and a Run resumed with its context. It was refused because a
held-open Run is a held-open session: a cost, a timeout, and a stale sweep that would have to learn that
blocked is not silent. The price of the choice made instead is real and is not hidden — the Agent starts
cold every time and does the work of reconstructing. That is the thesis working rather than a defect (the
tracker is the shared state, not the chat log), and it is also work.

**The Agent woken is the one that opened the sub-issues, and only where they agree on one.** Two Agents
having each opened some of a parent's children is not a case this knows how to pick a winner in, and guessing
would start a Run on work nobody asked that Agent for. A suspended Agent, or one whose grant on the parent's
Project was withdrawn while the work was being done, wakes nothing. In every one of those cases
`issue.children_closed` is still appended, so a parent whose sub-issues are finished is visibly a Human's
rather than silently nobody's.

**Fan-out is bounded by counts, per Workspace, and they bind Agents only.** Three numbers on the Workspace:
sub-issues per Issue, levels deep, and open descendants in one tree. Counts rather than spend, because a
count is predictable and an Agent can plan against it, where a spend limit that trips halfway through leaves
half a tree done and nothing that says which half. They bind Agents and not Humans: somebody opening two
hundred Issues by hand is not the failure mode this exists for, and a limit that stops them is a support
ticket. The ceilings are checked in two recursive queries rather than by walking the tree a row at a time. That is the
one piece of raw SQL in `packages/core` and it earns the exception: `issues.create` is the busiest write deevy
has, the walks put it over D1's fifty-statement cap on the deepest tree the defaults allow, and the cost grew
with a ceiling the Settings screen invites an admin to raise. `budget.test.ts` holds both — the count, and
that raising the depth does not change it.

A ceiling that trips appends `delegation.refused`. It is the only Event deevy writes about something that
did not happen, and it earns that: an Agent which hits a limit notes it and does something else, so without
the Event the Sponsor never learns that the shape of the work was decided by a number rather than by the
Agent.

**One open Run per (Issue, Agent) is the database's rule, not a convention.** Every path that starts a Run
reads first and inserts second, which is only sound single-threaded — and this feature makes the unsound case
ordinary, because two sub-issues of one parent finishing at the same moment is how a fan-out usually ends. A
partial unique index holds it; losing that race is not an error, it means somebody else already started the
Run this one was going to. The Event that says the sub-issues are finished is appended by whichever request
actually woke the parent, so one ending is one line.

**A sub-issue may live in any Project its Agent was granted, and follows that Project's Workflow.** Work has
dependencies that run across Projects — the piece that has to land in the API before the piece in the app can
— and a parent link that stopped at the boundary did not remove the dependency, it moved it onto a Human
writing it down twice. An Issue has always followed the Workflow of the Project it is in, and nothing here is
a reason to invent a second rule. What an Agent may delegate across is what an admin granted it, which
`requireProject` already enforces and which needs no new setting.

**A parent a caller cannot see is hidden from them, and still stops them moving the Issue.** Hiding it is the
house rule: an ungranted Project reads as "No such Project" rather than as a refusal
(`docs/plans/m2.md`). The exception is reparenting, which is refused with a message that admits a tree exists
without naming it. This is the one place that rule is bent, and it is bent because hiding the parent _and_
allowing the move would let an Agent quietly lift an Issue out of a tree it was never shown — a worse outcome
than knowing some tree is there.

**A Gate on a parent with open sub-issues is told, not blocked.** The ruling card says how many are still
open and the Human rules or does not. Nothing an Agent proposes ships without a Human deciding it did
([ADR-0014](./0014-an-agents-input-is-untrusted-and-its-tools-are-not.md)); this informs that Human rather
than overruling them. A Workspace that wants the harder rule can have it as a Workflow setting when somebody
wants it.

**A wave of sub-issues is one line in an inbox.** `issue.created` derives a Notification for every Human a
Gate concerns, so six sub-issues opened at once were six rows each for everybody. Delegation is its own
Notification kind now, addressed to the Sponsor of the Agent that opened them and rolled up to one line per
parent while that line is unread. A sub-issue assigned to a Human still reaches that Human directly, because
a rollup is for the wave and never for somebody's own work. A feature that makes an inbox useless has cost
more than it bought, and the Human at the end of the Gates is what this whole design depends on.

## Why not the alternatives

**A blocking relationship between siblings** — "this one cannot start until that one lands" — is not here.
The ordering this records is a parent waiting on all of its children and nothing finer. Sibling ordering is a
real want and a different feature; building it into the wake-up would have made both harder to reason about.

**A spend ceiling** was refused for now, and cost and time accounting per Run ships before this so the first
real fan-out can be costed rather than guessed at. When there are numbers, a spend ceiling can be argued for
on evidence.

**A Human approving the decomposition before any sub-issue exists** — a Gate for fan-out — was the safest
option and was refused: it means delegation cannot happen while nobody is watching, which removes most of the
point of an Agent that works overnight.

## The cost, stated

An Agent that starts cold on every wake-up and pays to rebuild its picture. Three numbers an admin has to
have an opinion about, whose defaults (20, 3, 50) are guesses until somebody's first real decomposition says
otherwise. A tree spread over two Projects that sits on two boards, in two Workflows, with two sets of Gates,
and is whole only on its parent's page. And one bent rule about what an ungranted Project may reveal, written
down here so that the next person to read it knows it was bent on purpose.

The plan is `docs/plans/sub-issue-delegation.md`, built in six slices, each one test-first.
