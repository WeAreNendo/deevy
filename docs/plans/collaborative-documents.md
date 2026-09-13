# Two Members in one Document at the same time

A plan, decided 2026-09-13. The Documents pane edits in place — the view is the editor and leaving the text
writes a version — so what happens when two Members are in one Document at once is a daily question rather
than a theoretical one, and deevy has a version of it most tools do not: an Agent does not wait for a Human
to finish typing before it writes the spec it was asked for.

The first draft of this document was an options menu. Every question in it has now been answered, so this is
what gets built, in what order, and what each part costs. The choices that are expensive to reverse are
recorded in [ADR-0021](../adr/0021-a-document-is-live-and-markdown-is-what-it-becomes.md).

## What exists today, and why it is not enough

`documents.write` takes `baseVersion` — the version the text on screen was read from — and refuses a save
that would land on top of somebody else's:

- Ada opens the spec at v2 and starts typing.
- Planner writes v3 from a Run.
- Ada's editor blurs and tries to save on top of v2. The server refuses; the pane says so and keeps her text.

Nobody's words are lost and the loser of the race is told. But it does not merge, it does not show Ada that
Planner is in the Document while she types, and the Human who loses the race is the one who was typing. It is
a floor.

## What is being built

One room per Document, live text, carets, presence, a version model that survives both, and an Agent path
that stays markdown-shaped. All of it before any of it ships: half of this is not usefully shippable, and a
Document that is live for Humans but still refuses Agents would be the wrong half.

**Roughly three weeks.** The editor is an afternoon — Tiptap's collaboration extension is a drop-in over
`@tiptap/y-tiptap`, and nobody writes ProseMirror. The expense is everything behind it: a websocket on two
runtimes, persistence, the version rules, and the merge.

### The room

A Yjs document per `document` row, held by `@hocuspocus/server` 4.7. Hocuspocus v4 runs on `crossws`, which
has a Cloudflare adapter with Durable Object and hibernation support, so Node and Workers run the same room
rather than two that drift apart. Two of its hooks are deevy's:

- `onAuthenticate` — the Better Auth session on the upgrade request, then the Member, then exactly the
  authorization `documents.get` applies. A Human who cannot read the Issue cannot open its room.
- `onStoreDocument`, debounced — this **is** the quiet rule rather than something built beside it.

It mounts as its own route on the Hono app both entries already build. Every operation deevy has is
request/response or a server-sent stream; a websocket upgrade is neither, so it is not an operation and does
not pretend to be one (ADR-0009 stands; ADR-0021 says why this sits outside it). Nothing travels over it but
Yjs updates and awareness.

`packages/adapters` gains the runtime half — `./node` (the crossws Node adapter) and `./workers` (a
`DocumentRoom` Durable Object) — behind one interface. The rules stay in `packages/core`, which keeps its
no-`node:` constraint.

### What is stored

A new table, `document_state(document_id → document, state blob, updated_at)`, written on every debounced
store. The Yjs state is the truth while people type; markdown is what every version is made of, what every
read returns and what every Agent writes. A room with no state row boots by parsing the latest version's
markdown into a fresh Yjs document — which is also the recovery path if a blob is ever lost.

Persisted rather than rebuilt per session because offline has to work: a tab that was asleep merges into a
document identity the server still has, instead of duplicating text into one it rebuilt.

### What a version is now

On a store: always write the state, then decide whether to cut.

- Thirty seconds of quiet cuts a version from the merged markdown.
- A cut within **ten minutes** of the previous one, by the same set of authors, **amends** it instead of
  adding another — so an afternoon leaves a handful of readable versions rather than forty.
- A version a Gate ruling pinned (`gate_decision_document`) is never amended. Nor is one anybody has already
  opened at that version in History.
- Authors come from the update origins seen since the last cut, into a new `document_version_author` table —
  the same shape as the ruling's pin. The log says "Ada and Planner wrote spec v4".

No Publish button. A version is a checkpoint the system takes, not a thing a Human must remember, and a
Document that drifts a long way from its last version is how a Gate ends up approving text nobody published.

### How an Agent writes

An Agent never joins the room. It reads markdown and writes markdown, as it does today.

- `documents.get` returns `{ body, version, basis }` — the live text, the version it derives from, and an
  opaque `basis` describing the state it was read at.
- `documents.write` echoes `basis` back (or `baseVersion`, still honoured). The server diffs **the basis text
  against the submitted body** — what the Agent actually changed — and replays only that onto the live text,
  as a Yjs transaction whose origin is the Agent's Member. A whole body is never pasted over a paragraph a
  Human is inside.
- `documents.writeSection(name, section, body)` addresses a heading instead. It merges by construction, costs
  a fraction of the payload, and gives the log a line worth reading: "Planner rewrote Requirements in spec".

When the merge genuinely collides — the same lines changed on both sides — the write is refused with
`CONFLICT` naming the section, and the Agent re-reads and tries again. Asymmetric on purpose: the room is for
typing, the API is merge-or-retry, re-reading is what an Agent is good at, and nobody's sentence is rewritten
under their cursor by a machine.

### What a Human sees

- **Carets** with names and Member colours, through `@tiptap/extension-collaboration-caret`.
- **An Agent gets a banner, not a cursor** — "Planner just wrote this" — because its edit arrives as a
  block, not as typing. The Agent never joins the room, so the server says it on the Agent's behalf, through
  awareness, for twelve seconds after the write lands.
- **Avatars** of everyone in the Document, in the pane's header beside the byline.
- **Offline**: keep typing, with a line that says so, and merge on reconnect. A version cut while you were
  away will not contain your words, and the history will show them landing afterwards.

The Issue's **description** gets a room too, having become an editor in its own right — live text and
presence, no versions, because it has none. **Comments** do not: short, single-author, already their own
record.

### What changes at a Gate

No freeze. The ruling still pins the version it approved and the Issue still says when the text has moved
since. What is new is the four-eyes case: when a pinned Document changes while its Issue sits at a Gate with
approvals already given toward the threshold, **those approvals are cleared** and an Event says why —
otherwise the second Human approves text the first never saw, which is what a Gate wanting two Humans exists
to prevent.

## The slices

Each one ends somewhere defensible, and the first one is the one that decides the rest.

1. **The room, empty** (~3 days). Transport, `onAuthenticate`, a Yjs document in memory, two browsers typing
   into one Document, nothing persisted. Ends by running the same room under `wrangler dev` as a Durable
   Object. **If that fails, stop and re-plan**: the fallback is `y-crossws` (framework-free, same transport)
   or two implementations, and slice 6 doubles.
2. **State and versions** (~4 days). `document_state`, the debounce, the amend rule,
   `document_version_author`, the Activity wording, the History dialog reading amended versions.
3. **The editor** (~3 days). Collaboration and caret extensions in `tiptap-editor.tsx`, the Agent banner,
   avatars in the header, the offline line, the description's room.
4. **The Agent path** (~4 days). `basis` on reads, the three-way merge, `writeSection`, the conflict refusal,
   the MCP and OpenAPI snapshots, the Agent capability list.
5. **Gates** (~1 day). Clearing partial approvals, the Event, the line on the ruling card.
6. **Workers for real** (~3 days). The Durable Object binding and migration in `wrangler.jsonc`,
   `OPERATIONS.md` on the paid plan, the acceptance walk.

## What it costs, plainly

- **Three weeks**, and a permanent tax on every future change to the editor.
- **A paid Workers plan** for that deployment: Durable Objects are not on the free tier. The Node/Docker
  deployment needs nothing extra.
- **Seven new dependencies**: `yjs`, `y-protocols`, `@hocuspocus/server`, `@hocuspocus/provider`,
  `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`, `@tiptap/y-tiptap` — the
  Tiptap three pinned exactly with the rest of that family, as the catalog requires.
- **A three-way merge** is a real algorithm with real failure modes. It gets its own unit tests, with worked
  cases, before it is wired to anything.
- **A blob that grows.** Yjs state accumulates history and needs compaction on store, and D1 has row limits
  worth respecting.
- **A second representation of a Document**, which deevy refused once for mentions. ADR-0021 argues why this
  one earns it: markdown is still what is stored, read, written and approved; the Yjs state is scratch
  between versions and rebuildable from the last one.

## How it will be verified

- **Unit**: the merge, with worked three-way cases including the collisions that must refuse; the amend rule
  against a clock; the version-author set.
- **Integration**: two Yjs clients against one in-process room — no network, no browser — asserting that
  concurrent edits converge, that an Agent's merged write lands, and that a quiet cut writes one version with
  both authors.
- **Browser**: two tabs on a stubbed instance, typing into one spec, with carets visible in each; an Agent
  write through MCP landing mid-sentence; a tab put offline and brought back.
- **Acceptance**: the `wrangler dev` room, in the walk that already runs both deployments locally on every
  commit.
