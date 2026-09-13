# Agent-to-agent delegation through sub-issues: vertical slices

Breakdown of the next item off [PLAN.md](../PLAN.md)'s after-v1 list, decided 2026-09-13. Vocabulary is
[CONTEXT.md](../../CONTEXT.md). It is done when an Agent can cut work it was given into sub-issues, hand each
to the Agent that should do it, stop cleanly rather than sitting and waiting, and be woken when the last of
them closes — and when none of that can open two hundred Issues while nobody is watching.

Five slices, in dependency order. Each is one PR on `main` and carries its own tests.

Why this and why now. An Agent's unit of work is an Issue, and its memory is a Run. Both are finite: a Run is
one attempt ([ADR-0016](../adr/0016-a-run-is-an-agents-and-the-registry-says-which-way-an-operation-faces.md))
and a session has a context window. Work larger than one of those has nowhere to go. The Agent either writes
a plan into a Document and waits for a Human to transcribe it into Issues, or it does the whole thing in one
Run and hands a Gate a diff too large for the Human to actually read — which is the failure the four-eyes
work just spent four slices trying to prevent. Sub-issues are the unit that makes a large piece of work into
several small reviewable ones, and the parent Issue is the memory between them. That is deevy's thesis
stated in the small: the tracker is the shared state, not the chat log.

## What is already there

More than it looks like, which is why this plan is five slices and not ten.

- **`issue.parentId` exists**, `issues.create` takes `parentKey` and `issues.update` can reparent. Both are
  `agents: true`, so an Agent can already open a child Issue.
- **`issues.get` already returns children**, through `issueWith` in `operations/shared.ts`, and
  `IssueDetailSchema` already has the field.
- **`isSelfOrDescendant`** (`packages/core/src/issues.ts`) already refuses a cycle on reparent, walking the
  parent chain with a `seen` set.
- **A parent must be in the same Project**, refused in both `create` and `update`. That stays (below).
- **`triggersFor`** (`packages/core/src/triggers.ts`) already turns an assignment or a mention into a Run,
  already refuses to let a `run.*` Event start anything, and already holds the "at most one open Run per
  (issue, agent)" rule that is this plan's second recursion guard.
- **`workflow_state.category`** is `backlog | active | done`, and `done` is what closes an Issue and sets
  `closedAt`. That is the definition of "a child finished" — this plan invents no second one.
- **`workspace.update` exists**, and Settings › Workspace is a screen, so the ceilings have somewhere to live.
- **`run.trigger`** is already an enum of five, so a sixth is a migration and not a new concept.

And three things that are there and are in the way.

1. **Creating an Issue with an Assignee appends no `issue.assigned`.** `issues.create` appends
   `issue.created` and nothing else, so nothing starts the assignee's Run and nothing reaches their inbox.
   Delegation today needs create-then-assign, two calls, with a window in between where the Issue is
   assigned to nobody. Slice 1 is mostly this.
2. **Nothing knows a parent is waiting.** There is no relationship between a parent's Run and its children's,
   and nothing happens to the parent when they close.
3. **There is no ceiling on anything.** `isSelfOrDescendant` prevents a cycle and nothing else: no depth cap,
   no cap on children, no cap on a tree. Better Auth's rate limiting is explicitly off for Agents
   (`packages/core/src/auth.ts`), because rate limits were put at the edge. An Agent that decides a task has
   forty parts can open forty Issues, each of which opens a Run.

## Decisions taken

2026-09-13, with Matt.

- **Cost and time accounting per Run ships first**, as its own plan and its own pull request. Delegation is a
  multiplier on spend, and shipping a multiplier before the thing it multiplies can be measured is how you
  find out about it from a bill. It also makes the first real decomposition legible: what a tree of forty
  Issues actually cost is a number somebody can look at rather than a feeling.
- **A parent does not wait. It finishes, and the last child wakes it.** The delegating Run ends cleanly with
  a summary of what it handed over; when the last child closes, that starts a fresh Run on the parent. The
  alternative — a `blocked` status and a Run resumed with its context — was refused because a held-open Run
  is a held-open session with a cost and a timeout, and the stale sweep would have to learn that blocked is
  not silent. The price of the decision is real and is stated rather than hidden: the parent's Agent starts
  cold and rebuilds its picture from the tracker. That is the thesis working, and it is also work it does
  every time.
- **The Agent that opened the children is the one that is woken**, if it is still an Agent, not suspended,
  and still granted the Project. A grant withdrawn between delegating and finishing is a case that will
  happen; the answer is to start nothing and let the parent be a Human's, visibly, rather than to guess at a
  substitute.
- **Fan-out is bounded by counts, per Workspace**: children per Issue, delegation depth, and open descendants
  in one tree. Counts rather than spend because a count is predictable and an Agent can plan against it,
  where a spend limit that trips halfway through leaves half a tree done and nothing saying which half.
- **The ceilings bind Agents and not Humans.** A Human opening two hundred Issues by hand is not the failure
  mode this is for, and a limit that stops one is a support ticket.
- **A ceiling that trips is an Event, not only an error.** `delegation.refused`, on the parent. An Agent that
  hits a limit will note it and do something else, and the Sponsor needs to know the shape of the work was
  decided by a number rather than by the Agent.
- **A child lives in its parent's Project**, which is what `issues.create` already enforces. Both Agents
  already need that Project to see the work, and a child elsewhere raises whose Workflow it follows and whose
  Gates rule on it — questions worth answering when somebody actually needs them and not before.
- **A Gate on a parent with open children is not blocked.** The ruling card says how many are open and the
  Human decides. Nothing an Agent proposes ships without a Human deciding it did
  ([ADR-0014](../adr/0014-an-agents-input-is-untrusted-and-its-tools-are-not.md)); this informs that Human
  rather than overruling them. A Workspace that wants the harder rule can have it later, as a Workflow
  setting, once somebody has wanted it.
- **Notifications are rolled up.** One line per parent per wave for the delegating Agent's Sponsor, not one
  per child. Forty sub-issues that make somebody's inbox useless have cost more than they bought, and the
  Human at the end of the Gates is the one thing this whole design depends on still working.

## Deferred

A blocking relationship between siblings ("this one cannot start until that one lands") — the ordering here
is a parent waiting on all of its children, and nothing finer. A child in another Project. A spend ceiling.
An Agent delegating to a Human, which is assignment and already works, but which nothing in this plan makes
pleasant. Automatic decomposition: nothing here decides _how_ an Agent should cut work up, only what happens
when it does. Any change to who may rule a Gate: still a Human, still in a browser, still not an Agent
([ADR-0004](../adr/0004-agents-never-approve-gates.md),
[ADR-0010](../adr/0010-a-delegated-credential-cannot-decide-a-gate.md)).

## Conventions every slice follows

The milestone conventions hold. This plan restates the ones it leans on hardest and adds the first, which is
not negotiable in any slice below.

1. **Every change is written test-first, and the test is watched failing before the code exists.** Not
   "tests are written for it" — the red comes first, and it is read. This is a plan about a machine that
   starts other machines; the failure modes are recursion, double-triggering and fan-out, and every one of
   them is invisible in a passing test that was written afterwards to match what the code already did. A
   test that has never failed has proved nothing. Where a slice says "acceptance test", that test exists and
   fails before its slice is implemented, and the pull request says what the failure looked like. Two of this
   plan's bugs are already known to be findable this way: the two-Run case in slice 1 and the wake-up loop in
   slice 3.
2. Schema in `packages/db/src/schema/<area>.ts`, relations merged in `relations.ts`, migration generated with
   `vp run db#generate`, `NOT NULL` hand-patched onto text primary keys, `vp run db#check:migrations` green.
3. Operations through `defineOperation` in their area's module; `NOT_FOUND`, `CONFLICT`, `FORBIDDEN` and
   `BAD_REQUEST` with messages in CONTEXT.md vocabulary. `vp run core#snapshot:openapi` and
   `vp run core#snapshot:mcp-tools` committed whenever an input or output changes.
4. Every write appends its Event through `appendEvent` in the same handler.
5. **A new `EventKind` has four consumers, not one**, and a slice is not done until all four read well: the
   sets in `notifications.ts`, `lib/event-text.ts` in the SPA, the Event log's What column, and the webhook
   subscribers who will receive a kind they did not ask for.
6. **Anything that walks the Issue tree is counted against the statement budget.** D1 caps the statements one
   invocation may run and `packages/core/tests/budget.test.ts` is the ratchet. A walk whose length is not
   bounded by a ceiling does not ship.
7. Core tests through `createRouterClient(router, { context })` with the `memberContext` helper; SPA tests
   against the mocked client in `apps/web/tests/stub-client.ts`.
8. **A rule about delegation is tested with two Agents.** One Agent cannot prove a rule about a handoff, and
   a test that fakes the second proves the fake.
9. `vp check` clean, `vp run -r test` green, `vp run web#build:workers` then `vp run web#check:workers`
   green, a changeset written for somebody upgrading deevy.

Sizes are t-shirt estimates for one developer plus agents: S under a day, M two to three days, L a week.

## Dependency order

```
main
└─ 0 Cost and time accounting per Run          its own plan, ships first
   └─ 1 A child an Agent can actually hand over
      ├─ 2 A fan-out has a bottom
      └─ 3 The parent wakes when the last child closes
         └─ 4 A tree you can see, and an inbox that survives it   needs 1 through 3
            5 Docs, the ADR, and the release                      needs 1 through 4
```

Slices 2 and 3 are independent of one another once 1 is in. Built in either order they are the same work;
built 2 first, slice 3's tests get a bounded tree to walk for free, which is the small reason to prefer it.

---

## Slice 1: A child an Agent can actually hand over (S)

**Goal.** One call opens a sub-issue, assigns it to another Agent, and starts that Agent's Run.

**Core.**

- `issues.create` appends `issue.assigned` beside `issue.created` when `assigneeMemberId` is given. The
  Events go in that order, so the log reads as it happens and `triggersFor` sees the Issue exist before it
  sees it assigned.
- `issue.created`'s payload carries `parentKey` where there is one, so the Activity reads "opened DEV-41
  under DEV-5" rather than leaving the reader to click.
- Nothing else changes. `parentKey`, the same-Project rule and the cycle guard are already there.

**The thing that will go wrong, and the test that has to be red first.** Both `issue.created` and
`issue.assigned` now go through `appendEvent`'s tail in one request. `issue.created` runs `stateRule`, which
starts a Run when the first State names a trigger Agent; `issue.assigned` runs `startRuns`. On a Project
whose first State names the same Agent the caller assigned to, both want a Run. The "at most one open Run per
(issue, agent)" rule is what stops the second, and it has never been exercised from two different triggers in
one request. **Write that test first**: a Project whose first State names `builder`, an Issue created
assigned to `builder`, and exactly one Run afterwards.

**What this changes for a Human, which is not a side effect.** Creating an Issue already assigned to somebody
now tells them. It did not before — the assignment was silent until somebody re-assigned it — and that was a
bug rather than a feature. It is named here because it changes the inbox of every Workspace that upgrades,
and it belongs in the changeset in those words.

**Acceptance test.** `planner` creates an Issue under DEV-5 assigned to `builder`. The Issue has the parent;
`issue.created` and `issue.assigned` are both in the log, in that order, with `planner` as the actor; exactly
one Run exists, it belongs to `builder`, its trigger is `assignment`, and `builder`'s Sponsor has one
notification. The same call with no assignee opens no Run at all.

---

## Slice 2: A fan-out has a bottom (M)

**Goal.** An Agent cannot open more Issues than the Workspace allows, and the Workspace's admin can see and
change what that is.

**Schema.** `workspace` gains three integers, not null, with defaults that a Workspace which upgrades keeps
without deciding anything: `max_children_per_issue` (20), `max_delegation_depth` (3),
`max_open_descendants` (50). Conservative on purpose — twenty children is a large decomposition and three
deep is a plan, not a pyramid — and every one of them is a number an admin can raise.

**Core.**

- `delegationDepth(db, issueId)` walks the parent chain. It is bounded by `max_delegation_depth + 1` reads
  because anything deeper is already refused, which is what keeps it inside the statement budget.
- `openDescendants(db, rootId)` counts the Issues under a root that are not in a `done` State, breadth-first,
  bounded by the ceiling: it stops counting at the limit, because the only question is whether the limit is
  passed and the exact number beyond it is nobody's business.
- `issues.create` and `issues.update` (when reparenting) refuse past any of the three **when the caller is an
  Agent**. `BAD_REQUEST`, with a message naming which limit and both numbers: "DEV-5 already has 20 children,
  which is this Workspace's limit. Finish some before opening more."
- A refusal appends **`delegation.refused`** on the parent Issue, carrying the limit, the number and the
  Agent. This is the one Event in the plan that records something not happening, and it earns it: an Agent
  that hits a ceiling will say so in its Run and then do something else, and the Sponsor needs to know the
  shape of the work was decided by a limit rather than by the Agent.
- `workspace.update` takes the three, refuses zero or negative, and appends the `workspace.updated` Event it
  already appends.

**SPA.** Settings › Workspace gains the three fields with their explanations, in the voice the rest of that
page uses. An admin-only screen, as it already is.

**Acceptance test.** A Workspace with `max_children_per_issue` of 2: an Agent opens two children and the
third is refused, naming both numbers, with `delegation.refused` in the log and no Issue created. A **Human**
opens a third and it is created, because the ceilings bind Agents. Depth: with a limit of 2, a grandchild is
created and a great-grandchild is refused. Open descendants: with a limit of 3, closing a child makes room
for another. `budget.test.ts` gains a case for the create path with a parent, and the count is asserted
exactly, as that file does.

---

## Slice 3: The parent wakes when the last child closes (L)

**Goal.** An Agent that delegated can stop. When the last child closes, the parent gets a new Run, and the
Agent picks the work back up from what the tracker says.

This is the slice the feature is actually for, and it is the one with a loop in it.

**Schema.** `run.trigger` gains `children_done`. `run_triggers` is an enum in `packages/db/src/schema/run.ts`
and a migration.

**Core, in `triggers.ts`.**

- On `issue.moved` and `gate.approved`, if the Issue has now entered a State whose `category` is `done`, and
  it has a parent: count the parent's other children that are not `done`. If any, nothing happens. If none,
  append **`issue.children_closed`** on the parent and start a Run on it with trigger `children_done`.
- **Whose Run.** The Agent that opened the children — `issue.createdBy` on the children, which will be one
  Agent in every case this plan is about. It must still be an Agent, not suspended, and still granted the
  parent's Project; a grant taken away between delegating and finishing is a real case and the answer is to
  start nothing. Where there is no such Agent the Event is still appended and the parent is a Human's problem,
  visibly.
- The Run's Agent reads the children through `issues.get`, which already returns them. **No new operation.**
  If an Agent needs to know what its children concluded, that is what their Documents and their Runs' summaries
  are for, and both are already readable.

**The three ways this loops, and the tests that have to be red first.**

1. **A parent that is itself a child.** A tree two deep closes bottom-up: the grandchild closes, wakes the
   child's Agent, that Run closes the child, which closes the last child of the parent, which wakes again.
   That is correct and must be tested as correct — one wake per level, no more.
2. **A parent already closed.** An Issue in a `done` State does not wake, whatever happens beneath it.
   Without this, closing a child of a finished epic starts a Run on work nobody asked for.
3. **A second wake for the same wave.** `triggersFor` returns Events that go through the tail again, and the
   Run it starts appends `run.*` Events which start nothing. The guard is the existing "at most one open Run
   per (issue, agent)" rule plus the `done` check above. **Write the test that reopens and recloses a child
   and asserts the parent has exactly one Run.**

A rejection is not a close. A child sent back at a Gate has not entered a `done` State, so nothing wakes,
which is the behaviour the Gate's own tests already assume.

**Acceptance test.** `planner` opens three children under DEV-5 assigned to `builder` and finishes its Run.
Two children close: DEV-5 has no Run and no `issue.children_closed`. The third closes: exactly one Run opens
on DEV-5, it belongs to `planner`, its trigger is `children_done`, and `issue.children_closed` is in the log
once. Reopening the third child and closing it again does not open a second Run. A grandchild tree closes
bottom-up and wakes each parent exactly once. `planner` suspended between delegating and the last close: the
Event is appended and no Run is started.

---

## Slice 4: A tree you can see, and an inbox that survives it (M)

**Goal.** A Human can see what their Agent decided to do, in one place, without it costing them their inbox.

**Core.**

- `IssueSummarySchema`, which is what children come back as, gains the State and whether a Run is open on it.
  The Issue page cannot say anything useful about a child without those two, and it is one join.
- `deriveNotifications` **rolls up**: `issue.created` with a parent, by an Agent, does not notify per child.
  One `delegation` notification per parent per wave, addressed to the delegating Agent's Sponsor, saying how
  many were opened. A child assigned to a _Human_ still notifies that Human directly — a rollup is for the
  wave, never for somebody's own work.
- `issue.children_closed` notifies the Sponsor of the woken Agent, and nobody else.

**SPA.**

- The Issue page lists children under the parent: key, title, State, Assignee, and a mark where a Run is
  open. A line above them says who opened them and when — "planner opened 6 sub-issues".
- A child says what it is a child of, which it already does.
- **The Gate ruling card, on a parent with open children, says so**: "3 of 6 sub-issues are still open." A
  sentence, not a block. The Human rules or does not.
- `lib/event-text.ts` gains sentences for `issue.children_closed` and `delegation.refused`.

**Acceptance test.** Six children opened in one wave produce **one** inbox row for the Sponsor, not six, and
a child assigned to a Human produces that Human's own row as well. The Issue page shows six children with
their States, and the count of open ones on the Gate card. The Event log renders both new kinds as sentences
rather than as kind names. The web tests drive this through `stub-client.ts` as the SPA tests already do.

---

## Slice 5: Docs, the ADR, and the release (S)

- **ADR-0022**, "a parent finishes and the last child wakes it", recording what is expensive to reverse: that
  a Run is not held open across delegation, that the ceilings are counts and bind Agents only, that a child
  lives in its parent's Project, and that a Gate on a parent is informed rather than blocked. It says why the
  alternative — a `blocked` Run resumed with its context — was refused: a held-open Run is a held-open
  session with a cost and a timeout, and the stale sweep would have to learn that blocked is not silent.
- **PLAN.md**: the after-v1 list loses this item and gains the past-tense paragraph, in the shape the other
  milestones use.
- **CONTEXT.md**: whether "sub-issue" earns a line in the vocabulary, or whether parent and child are enough.
  The bias is enough — the fewer words the better — but it is decided here rather than left ambiguous.
- **OPERATIONS.md**: the three ceilings, their defaults, and what an admin should think about before raising
  them.
- **`apps/agent/src/instructions.md` and `docs/agent-loop.md`**: an Agent that does not know it can delegate
  will not, so the shipped instructions say when to cut work up, what the ceilings are, and that finishing
  after delegating is the correct move rather than an abandonment.
- Snapshots, the `agents.test.ts` capability list, a changeset.

### What this is expected to find

Written before the work, to be answered after it, as the last two plans did.

- Whether the wake-up Run has enough to go on. The Agent starts cold and reconstructs from the tracker; if
  that turns out to need a summary the parent wrote before it stopped, then "finish and be woken" needs one
  more piece and the plan should say so rather than the Agent guessing.
- Whether twenty, three and fifty are anywhere near right. They are guesses. The first real decomposition
  will say.
- Whether one rolled-up notification per wave is the right grain, or whether a Sponsor wants the closes too.
- Whether `delegation.refused` is read by anybody, or whether it is an Event written to be thorough. If
  nobody looks at it in a month it should go.
