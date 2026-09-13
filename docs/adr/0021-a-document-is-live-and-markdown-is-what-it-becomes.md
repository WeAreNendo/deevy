# A Document is live, and markdown is what it becomes

deevy's Documents became editable where they are read: the intent, the spec and the plan have no Edit button
and no read mode, and leaving the text writes a version. That made a question that had been theoretical into
a daily one — two Members in one Document at the same time — and deevy has a version of it most tools do
not: an Agent does not wait for a Human to stop typing before it writes the spec it was asked for.

What shipped with the in-place editor was a floor, not an answer. `documents.write` takes the version the
text was read from and refuses a save that would land on top of somebody else's. Nobody's words are lost and
the loser of the race is told, which is better than silently keeping the later one — but it is a lock with a
late error message, and the Human who loses it is a Human who was typing.

This records what a live Document is, because several of the choices are expensive to change afterwards: a
second representation of text, a transport deevy did not have, a Durable Object, and a new answer to what a
version means.

## The decision

**The live text is a CRDT; markdown is what it becomes.** A Yjs document per Document, persisted, is the
truth while people are typing. Markdown is the format of every version, every read, every write an Agent
makes, and everything a Gate approves — unchanged. The CRDT is scratch between versions and can be rebuilt
from the last version's markdown, which is also the recovery path if the state is ever lost.

This is the decision that needs the most defence, because deevy already refused a second representation
once: a mention is plain `@handle` text and not a Mention node, so markdown round-trips exactly. The
difference is what the second representation is for and how long it lives. A Mention node would have been a
second representation _of a stored Document_, and every read and write would have had to cross the bridge. A
Yjs state is a second representation _of a Document being typed into_, it exists only between versions, and
nothing outside the room ever sees it. If it disappears, the Document is still every word of its last
version. The bridge is crossed once per version rather than once per read.

**Offline is why it is persisted rather than rebuilt.** A room that boots by parsing markdown and is thrown
away when the last person leaves is cheaper and loses a tab that was asleep: its edits merge into a document
identity the server no longer has, and duplicate text rather than merging. Keeping the state is what makes
"keep typing, it will merge when you are back" true.

**A version is cut by quiet, not by a button.** Thirty seconds of stillness in a room and the merged text
becomes a version. A cut within ten minutes of the previous one, by the same set of authors, amends that
version instead of adding another — unless a Gate ruling pinned it, in which case it is never touched again.
A Publish button was the alternative and was rejected: it makes a version a deliberate act, which is
tidier, and it means a Document can drift a long way from its last version and a Gate can approve text
nobody published.

**A version has authors, plural.** `document_version_author`, the same shape as the ruling's version pin.
When two Members' keystrokes are in a version, the log says "Ada and Planner wrote spec v4" — the byline on
the Documents pane already reads that way across versions, and a single `authorMemberId` would credit
whoever happened to pause last for a paragraph somebody else wrote.

**An Agent never joins the room.** It reads markdown and writes markdown, as it does today. `documents.get`
returns the live text with an opaque `basis` describing the state it was read at; `documents.write` echoes
that back, and the server merges what the Agent _changed_ — the difference between the basis text and the
body it submitted — onto the live text, rather than pasting a whole body over a paragraph a Human is in.
`documents.writeSection` addresses a heading instead, which merges by construction and reads better in the
log.

The alternative was a CRDT client in the runtime, and it would have been a worse Agent API for a better
demo: every harness would need a stateful session to write a Document, and `documents.write` is the simplest
tool deevy offers.

**So the room says who wrote, on the Agent's behalf.** An Agent gets no caret, because there is nothing to
follow: its write arrives as a block, and a cursor for something that is not there would be a lie. What it
gets is a line — "Planner just wrote this" — in the Document's header for as long as the change is still a
surprise. It rides on awareness, which is the right place for it: ephemeral, never a version, gone when the
room closes. A Human whose paragraphs changed under their hands is owed an explanation, and this is the whole
of it.

**A conflict refuses the Agent, never the Human.** When the merge genuinely collides — the same lines
changed on both sides — the write is refused with `CONFLICT` naming the section, and the Agent re-reads and
tries again. Asymmetric on purpose. The live room is for typing and the API is merge-or-retry; re-reading is
the thing an Agent is good at and a Human is not, and a person should never have a sentence rewritten under
their cursor by a machine.

**The room is a websocket, and it is the one thing outside the registry.** Every operation deevy has is
request/response or a server-sent stream, and [ADR-0009](./0009-orpc-2-beta-as-operation-layer.md) says no
oRPC procedure is built outside the registry. A websocket upgrade is neither shape, so the room mounts as
its own route on the same Hono app, with the same session, the same Member and the same authorization the
Document's own operations apply. It is not an operation and does not pretend to be one: nothing is called
over it but Yjs updates and awareness.

**One room implementation, both runtimes.** `@hocuspocus/server` 4.7 runs on `crossws`, which has a
Cloudflare adapter with Durable Object and hibernation support, so Node and Workers run the same room behind
`packages/adapters` rather than two implementations that drift. The Worker deployment therefore needs a
Durable Object binding, and Durable Objects need a paid Workers plan: co-editing is a documented prerequisite
of that deployment rather than something that silently half-works.

**A Gate does not freeze its Document, but it does not collect approvals of different words.** The ruling
still pins the version it approved and the Issue still says when the text has moved since. What changes is
the four-eyes case: when a Document changes while its Issue sits at a Gate with approvals already given
toward the threshold, those approvals are cleared and an Event says why. Two Humans approving two different
texts is precisely what a Gate wanting two Humans exists to prevent
([ADR-0020](./0020-a-gate-may-want-more-than-one-human-and-may-exclude-the-one-who-asked.md)). Freezing the
Document at a Gate was the alternative: it makes a reviewer's "fix that typo and I will approve" require a
rejection first, which is more ceremony than a typo deserves.

## What it does not change

**Markdown is the one format.** Every Document is stored, read, written, versioned and approved as markdown
(`docs/plans/ui-redesign.md`, and the `deevy-ui` skill). A Human sees exactly what an Agent wrote, and an
Agent sees exactly what a Human wrote.

**The Event log is still the only record of what happened.** A version cut appends `document.updated` the
way a write always did, with the authors it now knows about. Nothing happens in the room that the log does
not learn about when it becomes a version.

**A Gate is still a Human's ruling**, an Agent still never approves one ([ADR-0004](./0004-agents-never-approve-gates.md)), and the version a ruling
pinned is still pinned.

**The Issue's description joins in**, having become an editor too, but it gains no versions — it never had
any. Its room is presence and live text over a field that is saved as it always was.

**Comments do not.** A comment is short, single-author and already its own record; a room around one would
be machinery for nothing.

## The cost, stated

Three weeks of work, a websocket transport, a Durable Object, a paid Workers plan for that deployment, a
three-way merge with its own failure modes, and a blob per Document that grows until it is compacted. The
plan is `docs/plans/collaborative-documents.md`, and the first slice is a spike that proves the room runs on
both runtimes before any of the rest is built.
