---
"@deevy/core": minor
"@deevy/db": minor
"@deevy/server": minor
"@deevy/sockets": minor
"@deevy/web": minor
---

**deevy no longer keeps a tracker of its own. The work stays in GitHub, Linear, GitLab or Notion, and deevy routes it to Agents, records their Runs, and holds the Gates only a Human may rule on.**

**Upgrading from 0.8 means starting again.** The migration history starts afresh, so 0.9 runs on an empty database — a new volume, or a new D1 database on Workers — and there is no upgrade path from 0.8. Nothing is exported: the old volume keeps what it had. `docs/OPERATIONS.md`, "Coming from 0.8 or before", says what to do.

**Set `DEEVY_SECRET`** to at least 32 random characters before connecting anything: every tool's credential is sealed under it. Keep it apart from `BETTER_AUTH_SECRET`, and back it up with the database, because losing it means connecting every tool again.

A **Socket** is one tool deevy is connected to, under one identity of its own. An **Issue** is now what a record in a tracker says — its key (`acme/deevy#42`, `ENG-12`), its URL, title, body and state — and deevy authors none of it. A **Project** is a binding: where its records come from, where its code and its documents are, which Agents may work it, the Agent a record nobody named goes to, and its Checkpoints.

**What is gone:** deevy's own Issues and `DEV-42` keys, the Workflow of States, Documents and their live editing, Labels, Teams, stored comments, the board and the Issue pages. On Workers the Durable Object went with the Documents, so a deployment needs no paid binding and `nodejs_compat` is off.

**How a record reaches an Agent.** A tool delivers to `POST /hooks/<socketId>`, signed. A label `agent:<handle>` gives the record to that Agent; otherwise the Project's default Agent takes it. An instance no tool can reach asks each tool what changed instead: `DEEVY_SOCKET_CATCHUP_MINUTES` (default 30) is how long a tool may be quiet first, and a Socket can poll on an interval of its own.

**deevy says back, where the team reads.** A Gate becomes a comment on the record with the Proposal and how to rule, the record carries `deevy:awaiting-approval` while it waits, and the ruling is another comment with its arithmetic ("1 of 2"). With the Project's **Mirror** set to `runs`, Runs starting and finishing are said too; `off` says nothing. Every such comment ends `— <Agent> · <Run> · via deevy`, because the tool shows deevy as its author.

To try it with no account anywhere, `DEEVY_DEV_STUB_SOCKETS=1` registers an in-process tracker and forge (`docs/DEVELOPMENT.md`). The milestone was built in #81–#96, then walked against github.com and checked against what each other tool publishes in #98–#103; the plan and what each step found are in `docs/plans/sockets.md`, and the reasoning is ADR-0024 and ADR-0025.
