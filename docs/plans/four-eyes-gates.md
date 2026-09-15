# Four-eyes Gates: vertical slices

Breakdown of the first item taken off PLAN.md's after-v1 list, 2026-09-06. Vocabulary is
[CONTEXT.md](../../CONTEXT.md); the two deferrals this closes are M1's and M2's, "four-eyes Gates;
requester-cannot-approve". It is done when a Gate can ask for more than one Human, can refuse the Human who
put the Issue there, says on the Issue how far along it is, and cannot be configured into a state nobody can
get out of.

Four slices, in dependency order. Each is one PR on `main` and carries its own tests.

Why this and why now. A Gate is the bound ADR-0014 says does not depend on getting any of the others exactly
right, and the last two spikes leaned on it harder: an Agent now runs four different CLIs and pushes where it
likes, so the Gate is the only place a Human still stands between a proposal and a decision. It currently
takes one approval from anyone, including the person who asked for it.

## What is already there

Most of the machinery exists and this adds to it rather than reworking it.

- `gates.approve` and `gates.reject` are `sessionOnly` and call `assertHuman`, so an Agent cannot rule
  ([ADR-0004](../adr/0004-agents-never-approve-gates.md)) and neither can a delegated credential
  ([ADR-0010](../adr/0010-a-delegated-credential-cannot-decide-a-gate.md)). Nothing here weakens either.
- `gate_decision` already records one row per ruling with the Member and the time, which is what counting
  distinct approvals needs.
- `gate_approver` already names who may decide a Gate, and `workflow.update` already writes that list.
- `issue.stateEnteredAt` is already set on every move, which is the line between "approvals for this visit to
  the Gate" and approvals from a previous one.
- `resumeGateRuns` already carries a ruling back to whatever Run stopped at the Gate, and
  `runs_request_approval` already answers `awaiting` until there is one.
- **`gateRecipients` in `notifications.ts` already computes the eligibility this plan needs**: the named
  approvers when there are any, otherwise every Human of the Workspace, less the suspended and less the
  actor. It is written there because the inbox needed it first, and it is the same arithmetic every slice
  below asks for.

And one thing that is there and is in the way. `gates.reject` calls `previousState`, which returns the Gate
itself when there is nowhere further back, and then **skips `enterState`** — so a rejection in the first
State records the decision and leaves `stateEnteredAt` untouched. The default template Gates on _leaving_
Intent, and Intent is the first State, so this is not an edge case reached by an unusual Workflow.

## Decisions taken

- **The threshold is per Gate, and the default is one.** `approvalsRequired` on the State, defaulting to 1,
  so every existing Workflow keeps behaving exactly as it does. A Workspace that wants two eyes on the Plan
  Gate and one on the Spec Gate says so per State.
- **Approvals are counted per visit, not per Issue, and a visit begins at the later of two things.** Distinct
  Humans who approved this State since `max(issue.stateEnteredAt, the last rejection of this
(issue, state))`. Counting from `stateEnteredAt` alone was the first draft of this rule and it is wrong in
  the case that matters: a rejection in the first State moves nothing and stamps nothing, so approvals given
  before it would survive it, and a Gate a Human had just rejected would open on the next click. Reading the
  last ruling costs one query in `gates.approve`, needs no column and no change to `gates.reject`, and
  keeps `stateEnteredAt` meaning what it says everywhere else it is read. **Only a rejection begins a
  visit**: an approval is a `gate_decision` too, so a rule that restarted on any ruling would restart on
  every approval and no Gate could count past one. Building slice 1 is what found that.
- **One rejection ends it, however many approvals are wanted.** Deliberately asymmetric: consensus is for
  letting something through, and anyone who sees a reason to stop has seen enough. A Gate that needed two
  rejections would let one reviewer's objection be outvoted, which is not what a Gate is for.
- **A partial approval is its own Event.** `gate.approval` per Human, carrying how many are still wanted;
  `gate.approved` only when the last one lands and the Issue actually leaves. Every existing consumer of
  `gate.approved` — the Run resume, the timeline, the webhooks — keeps meaning what it meant, and nothing
  that reads the log has to learn a new shape to stay correct.
- **The requester is the Human who put the Issue in the Gate, one hop.** Read from the Event log: the actor
  on the move that brought it here, and when that actor is an Agent, its Sponsor. That is PLAN.md's own rule
  for accountability — the accountable Human is the triggering Human, or the Sponsor when an Agent triggered
  it — applied to the question of who should not be the one to wave it through.
- **Excluding the requester is a separate flag from the threshold.** `excludeRequester` on the State,
  defaulting to false. They are two rules that answer different questions, they were two deferrals, and a
  Workspace may well want one without the other: two approvals from anyone, or one approval from anyone but
  the author.
- **Who could approve this Gate is one function, called four times.** `gateRecipients` becomes an exported
  `eligibleApprovers(db, { workspaceId, stateId, exclude })` and keeps deriving the inbox as it does now;
  `workflow.update` counts it, `gates.approve` checks against it, and the Issue detail reports it. This plan's
  own "what this is expected to find" names that arithmetic as the hard part, which is the argument for
  having exactly one of it rather than one per slice. **Suspension is part of it**: a suspended Human is not
  an eligible approver, at configuration time as well as in the inbox, or a threshold of three in a Workspace
  of three Humans with one suspended is unsatisfiable the moment it is saved.
- **A Gate that cannot be satisfied is refused, not discovered.** `workflow.update` counts the Humans who
  could actually approve — the named approvers or every active Human, less the requester if the flag is on —
  and refuses a threshold above it, naming the number. deevy's stated zero-config case is a solo developer,
  and the failure mode of getting this wrong is an Issue that no one can move and no error that says why.
- **A pool that shrinks later is said out loud.** Suspend a Member and a Gate can become unsatisfiable after
  the fact, which configuration-time checking cannot prevent. The Issue page says so, in place of the
  approve button, and an admin lowers the threshold. Saying it is the whole fix; guessing a new threshold is
  not.
- **deevy's surfaces gain no tool.** Ruling on a Gate is not on the MCP tool list and does not join it
  ([ADR-0016](../adr/0016-a-run-is-an-agents-and-the-registry-says-which-way-an-operation-faces.md)). What
  changes on the MCP side is only that `runs_request_approval` keeps answering `awaiting` for longer, which
  is already what it does when nobody has ruled — though not for free, which slice 1 also found: the
  operation answered from the most recent ruling since the Run asked, so the first of two approvals would
  have told a waiting Agent the Gate was approved while the Issue was still sitting in it. An approval
  answers only when the Issue actually left; a rejection answers whatever the threshold is.

## Deferred

Approval by role or by Team rather than by named Member, which wants a permission model this does not have.
A Gate that needs one approval from each of two named groups. Time-boxed approvals that expire. Delegating
your approval to somebody else while away. Any change to who may rule at all: still a Human, still in a
browser, still not an Agent.

## Conventions every slice follows

M1's eight, M2's five, M3's four, M4's four, the harness spike's 23–27 and agent-owns-git's 28–30 hold. This
adds two:

31. **A rule about distinctness is tested with two Humans.** Every test about who may approve stands up a
    second Human against a real deevy. One Member cannot prove a rule about two, and a test that fakes the
    second proves the fake.
32. **A Gate that cannot open says so where the button would be.** Not in a log, not as a generic refusal on
    click: the Issue page states the arithmetic — how many are wanted, how many Humans could give one — and
    who to ask.

Sizes are t-shirt estimates for one developer plus agents: S under a day, M two to three days, L a week.

## Dependency order

```
main
└─ 1 A Gate can ask for more than one Human
   ├─ 2 The Human who asked cannot be the one who agrees
   └─ 3 Everyone can see where a Gate stands
      4 Docs, the ADR, and the release      needs 1 through 3
```

Slices 2 and 3 are independent of one another once 1 is in, with one exception worth stating rather than
tripping over: slice 3 shows _why_ a caller may not approve, and one of those four reasons — being the
requester — does not exist until slice 2. Built in the order above, slice 3's tests cover all four. Built the
other way round, slice 3 covers three and slice 2 adds the fourth.

---

## Slice 1: A Gate can ask for more than one Human (M)

**Built**, as [#51](https://github.com/WeAreNendo/deevy/pull/51). The two things it found are folded into the
decisions above. The threshold has no UI until slice 3, and omitting `approvalsRequired` when saving a
Workflow leaves each Gate's number alone, so the editor as it stands cannot widen a Gate by accident.

**Goal.** A Gate configured for two approvals opens on the second distinct Human's, and not before.

**Schema.** `workflow_state.approvals_required`, integer, not null, default 1. `vp run db#generate`, then
`vp run db#check:migrations`.

**Core.**

- `eligibleApprovers` is lifted out of `notifications.ts` and exported, with `gateRecipients` becoming its
  first caller so the inbox keeps behaving exactly as it does. Suspended Humans and Agents are out of it,
  which is what it already does.
- `workflow.update` takes `approvalsRequired` per State, and refuses one greater than `eligibleApprovers` for
  that Gate. The message says both numbers.
- `gates.approve` records the decision as it does today, then counts distinct approving Members for this
  `(issueId, stateId)` since the later of `issue.stateEnteredAt` and the most recent `gate_decision` for that
  pair. `gate_decision.memberId` is nullable (`onDelete: "set null"`), and a null **counts as no approval at
  all** rather than as one anonymous approver: a deleted Member's ruling must not hold a Gate open on behalf
  of nobody. Below the threshold: append `gate.approval` carrying
  the count and the number still wanted, and stop — the Issue stays in the Gate, the Run stays
  `awaiting_input`, no State is entered and no Document is opened. At the threshold: everything the operation
  does today, unchanged, including `gate.approved` and the Run resume.
- Approving twice is refused, by the Member who already did, with a message that says how many more Humans
  are wanted rather than only that they have already approved.
- `gate.approval` joins the Event kinds that derive a `gate_awaiting` Notification, addressed to the eligible
  approvers who have not yet approved. The Human who just approved is not told about their own approval.
- **A new `EventKind` has four consumers, not one**, and the slice is not done until all four read well: the
  `gateEventKinds` set in `notifications.ts`; `lib/event-text.ts` in the SPA, which the round-2 redesign made
  the single place an Event becomes a sentence; the Event log's What column, which reads from it; and the
  webhook subscribers, who will receive a kind they did not ask for. That last one is intended and is the
  point of an append-only log — a subscriber that switches on kinds ignores it, and one that displays them
  gains a true line — but it is a new message on somebody's wire and is said here rather than discovered.

**Acceptance test.** Two Humans, a Gate wanting two: the first approval leaves the Issue in the Gate, leaves
the Run `awaiting_input`, and appends `gate.approval` and no `gate.approved`; the second moves the Issue,
appends `gate.approved`, and resumes the Run. The same Human approving twice is refused and the Issue does
not move. One rejection after one approval sends the Issue back, and coming round to the Gate again needs two
fresh approvals. **A rejection in the first State, which moves nothing**, discards the approval already
given just the same: the Human who approved before it must approve again, and one further approval from
anybody else does not open the Gate. `workflow.update` refuses three approvals in a Workspace with two Humans, naming both
numbers. A Gate left at the default of one behaves exactly as it does now, which the existing Gate tests
prove by not changing.

---

## Slice 2: The Human who asked cannot be the one who agrees (M)

**Built**, as [#52](https://github.com/WeAreNendo/deevy/pull/52). Two notes. Excluding the requester turns out
to reserve a Human from _every_ count, threshold 1 included, because which Human it will be is not known
until there is an Issue — so a Workspace of one refuses the setting outright, which is the solo-developer
case this plan said would find the off-by-one. And `tests/budget.test.ts` caught the first version adding two
statements to every Issue creation: the Gate's own columns now ride on the join that already finds it, and
both extra reads are paid only by the Gates that use them.

**Goal.** A Gate can refuse the approval of whoever put the Issue in front of it.

**Schema.** `workflow_state.exclude_requester`, integer as boolean, not null, default false.

**Core.**

- `requesterFor(issue, state)`: the actor on the Event that last moved this Issue into this State, and when
  that actor is an Agent, its Sponsor. Null when the log does not say — an Issue created straight into a Gate
  by a trigger nobody asked for — and null excludes nobody, because a rule that guesses is worse than a rule
  that abstains.
- `gates.approve` refuses that Member when the flag is on, with a message that names why rather than saying
  "forbidden": you are the one who asked for this.
- The requester becomes an `exclude` passed to `eligibleApprovers`, which is the whole of this slice's
  arithmetic: `workflow.update` refuses "two approvals, requester excluded, two Humans in the Workspace" at
  configuration time, and the Gate's Notification stops going to the requester, because both read the same
  function. Neither is a second code path.

**Acceptance test.** A Human moves an Issue into an excluding Gate and is refused their own approval, with
the reason; a second Human approves and it moves. An Agent's Run moves the Issue in: the Agent's Sponsor is
refused, and a Human who is not the Sponsor approves. With the flag off, the same person may approve, which
is today's behaviour and stays the default. The requester is not in the inbox rows the Gate derives.

---

## Slice 3: Everyone can see where a Gate stands (M)

**Built**, as [#53](https://github.com/WeAreNendo/deevy/pull/53), and it took the Workflow editor with it —
slice 1 and slice 2 were reachable only over the API until this, which is the right seam but worth saying.
Two notes. `too_few_humans` is not a refusal like the other three: the operation still accepts that approval,
because refusing it would be a rule this plan did not ask for and an admin lowering the threshold is the fix;
the panel disables the button and states the arithmetic. And an Issue's rulings turned out to be free —
the page loads them for its history already — so the visit rule became a pure function over rows the query
returned, and only the two eligibility questions cost anything.

**Goal.** A Human opening the Issue knows how many approvals are wanted, who has given one, whether they may
give one, and — when nobody can — what to do about it.

**Core.** `IssueDetailSchema` carries the Gate's standing, computed from `eligibleApprovers` and the decisions
since the visit began rather than from anything new: how many are required, the approvals given so far with
their Members and notes, whether the caller may approve, and when they may not, why — already approved, the
requester, not a named approver, or not enough Humans exist. The Run's Gate elicitation and the
`gate_awaiting` Notification say how many are still wanted, so a Human reading either knows whether their
click ends it.

**UI.** The Gate panel on the Issue page shows the count and the names, and the approve control is disabled
with the reason in place of a tooltip nobody hovers. When the pool has shrunk below the threshold, the panel
says the arithmetic and names an admin's job (convention 32). The `deevy-ui` skill's accessible names are the
contract the tests use.

**Acceptance test.** Core: the detail carries the standing for each of the four reasons a caller may not
approve. SPA, with the stubbed client: a Gate at one of two shows both the count and the approver; the
control is disabled for the requester with the reason visible; a Gate that cannot be satisfied says so.

---

## Slice 4: Docs, the ADR, and the release (S)

**Built**, as [#54](https://github.com/WeAreNendo/deevy/pull/54). Docs only, so no changeset: the three code
slices carry the release notes between them. The acceptance walk was re-run and passes on both deployments,
which is the claim that a Gate wanting one approval from anybody is untouched.

**Goal.** An operator can configure this, and the reasoning is written down where the other Gate decisions
are.

**Work.**

- **ADR-0020, "A Gate may want more than one Human, and may exclude the one who asked."** Short. Why the
  asymmetry between approval and rejection; why the requester is defined as one hop through the Sponsor; why
  an unsatisfiable Gate is refused at configuration and stated on the Issue rather than worked around; and
  what this deliberately does not become — approval by role, by Team, or by anyone who is not a Human in a
  browser.
- **OPERATIONS.md**: configuring a Gate's threshold and exclusion, what happens when a Member is suspended
  under a Gate that needed them, and the solo-developer note that the defaults leave everything as it was.
- **PLAN.md**: the after-v1 list loses the two items and gains the paragraph, the way the harness spike and
  agent-owns-git did.
- **CONTEXT.md**: a Gate's entry gains the sentence that it may want more than one ruling. The vocabulary
  itself does not change: a Gate is still a State an Issue cannot leave without a Human.
- Changeset, and the acceptance walk re-run — it rules on two Gates, so a default of one is exercised end to
  end on both deployments by work that already exists.

**Acceptance test.** `vp run agent#acceptance` passes unchanged, which is the claim that the default is
untouched. CI green. The docs test that keeps OPERATIONS.md honest about configuration still passes.

### What this is expected to find

Written before building, to be corrected after. The eligibility arithmetic will turn out to be the hard part,
not the counting: "who could approve this Gate" has four inputs — named approvers, active Humans, the
requester, and who has already approved — and every one of them can change between configuring a Gate and
opening it. The `gate.approval` Event will be the thing that makes the timeline readable, and somebody will
ask for it on the Slack Channel within a day. And the solo-developer case will be the one that catches a bug,
because a Workspace with one Human is where every off-by-one in that arithmetic shows up first.

### What it found

The arithmetic was the hard part, but not by being hard to get right — by being asked in four places. It
already existed as `gateRecipients`, written for the inbox, and the first draft of this plan had each slice
compute it again. Making it one exported function was the single most useful decision here, and it is why
slice 2 was small.

Two things were wrong in the plan as approved, and both only showed when built. The counting rule said
"since the last `gate_decision`", which restarts on every approval, so no Gate could have counted past one;
only a rejection begins a visit. And `runs_request_approval` answered from the most recent ruling since the
Run asked, so the first of two approvals would have told a waiting Agent the Gate was approved while the
Issue was still in it — nothing in the plan predicted that the MCP surface would need a change at all.

The solo-developer case did catch something, though not an off-by-one in the counting: excluding the
requester reserves a Human from _every_ count, threshold 1 included, so a Workspace of one refuses the
setting outright. And the thing nobody predicted was `tests/budget.test.ts`, which failed twice — once in
slice 2 and once in slice 3 — and each time named a query that did not need to be there. Creating an Issue
ended up costing two statements more than before this work, both of them the eligibility questions.
