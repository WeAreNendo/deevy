# Changelog

deevy's user-visible changes, one entry per release. Each entry is folded from the changesets a pull request
declared, so it says what changed for somebody upgrading rather than what was committed.

A release is two Docker images and one `vX.Y.Z` tag — see [docs/OPERATIONS.md](./docs/OPERATIONS.md).

<!-- Entries are inserted below this line by `vp run version`. -->

## 0.8.0

### Minor Changes

- **core, cli** — [#71](https://github.com/WeAreNendo/deevy/pull/71) [`a6c699c`](https://github.com/WeAreNendo/deevy/commit/a6c699c43d93272a4ec26193b92bc69266e5c7fd) Thanks [@mattallty](https://github.com/mattallty)! - The CLI now asks the instance what it can do before it asks it to do anything. A command the instance does not have is refused by name — `https://old.example.com has no \`projects.create\`` — rather than failing as a 404 you have to interpret. That is what makes a newer CLI safe against an older deevy, which will happen the first time somebody upgrades one and not the other.
  It reads the instance's own API document once a day and keeps the answer beside the token. It is not a version check: two instances on the same version have the same operations, and comparing the operations says _which_ command is missing.
  An instance now puts its version in that document, so the message can name both sides. A deevy that does not say (an older one, or one whose entry never told it) is described rather than given a number it did not claim.
  `--deevy-url` points a single command somewhere without setting `DEEVY_URL`.
  One upgrade note: the file a token is kept in now carries the scheme — `https_deevy.example.com.json` rather than `deevy.example.com.json` — because `http://host` and `https://host` are two instances and were sharing one file. Signing in again is all that is needed.
- **core** — [#67](https://github.com/WeAreNendo/deevy/pull/67) [`111803f`](https://github.com/WeAreNendo/deevy/commit/111803f66f2e5db277d152e7a54dcf0a42be3f9b) Thanks [@mattallty](https://github.com/mattallty)! - deevy now issues access tokens for two protected resources instead of one: the MCP server at `${BETTER_AUTH_URL}/mcp`, as before, and the operation API at `${BETTER_AUTH_URL}/api`, which is new. A token is checked against the resource it was minted for, so one granted to an MCP client reaches the tools and not the ninety-four operations behind them, and one granted to an API client is refused at `/mcp`.
  **Nothing an existing MCP client does changes.** Its tokens are still minted for `/mcp` and still accepted there; the second resource is additive.
  This is what lets a Human sign in from something that is not a browser — the CLI being built on top of it — without that credential inheriting everything an MCP consent grants. Gate rulings are unaffected and still cannot be made by any delegated credential, whatever it is for.
  **A client is linked to the API resource only if it asks for one at registration**, so an MCP client that registers without naming it cannot obtain an API token at all, and one that asks for it anyway is refused with `invalid_target`. A client that legitimately wants both names both, and then holds a token whose audience is both — which is RFC 8707 working as specified, and the reason "a token for one surface is refused at the other" is a statement about single-resource tokens.
  RFC 9728 protected-resource metadata is served for the MCP resource only. A client that needs the API resource reads `/.well-known/oauth-authorization-server` and names the resource in its authorization request (RFC 8707). A client identified by a Client ID Metadata Document has no requested resources, so it is linked to MCP alone.
- **server** — [#65](https://github.com/WeAreNendo/deevy/pull/65) [`c8deadb`](https://github.com/WeAreNendo/deevy/commit/c8deadb31d9dc3d380069848bcc7826105008cc5) Thanks [@mattallty](https://github.com/mattallty)! - The deevy image now runs as an unprivileged user on Google's distroless Node base. It carries Node, deevy's bundle and nothing else — no shell, no package manager, no `apt`, and no way to get a prompt inside the container. It is about a third smaller for it.
  **Upgrading an existing instance needs one command first.** Everything on your volume was written as root, and the new image runs as uid 65532, so it can read the database but not write to it. With the container stopped:
  ```bash
  docker run --rm -v deevy-data:/data alpine chown -R 65532:65532 /data
  ```
  If you forget, deevy tells you: it checks that it can write `/data` before it opens the database and stops with that exact command in the error. That check is new in this release and it matters more than it sounds — the migrations on an upgraded volume are already applied and nothing else writes at startup, so without it a root-owned volume would carry the container all the way to `healthy` and only fail at the first thing anyone tried to save. The command is idempotent; run it if you are unsure.
  A fresh install needs nothing — a new named volume takes its ownership from the image. A host directory you bind-mount does not, so `chown -R 65532:65532` that before the first start.
  **The image now carries its own healthcheck**, so `docker ps` reports `healthy` and Compose's `depends_on: condition: service_healthy` works without a healthcheck of your own, on whatever `DEEVY_PORT` you set. The one in the published `docker-compose.yml` has been removed. If you have a copy of the old file, delete the `healthcheck:` block under the `deevy` service — it calls `node` by name, and the new image has no shell and no `PATH` entry to find it with, so it would report `unhealthy` forever and hold back anything waiting on it.
  Backups are unchanged: `sqlite3` was never in this image and still is not, so the sidecar recipes in `docs/OPERATIONS.md` are still how you take one. **Restoring now needs one more line** — a file copied in by a root sidecar has to be given to uid 65532 before deevy can write it. The recipe in the docs does that.
  If you already ran the image with `--user` or a `user:` in Compose, it still works; that is now the default rather than something you have to ask for.
- **cli** — [#66](https://github.com/WeAreNendo/deevy/pull/66) [`5ba116f`](https://github.com/WeAreNendo/deevy/commit/5ba116f0cfcee29b0d4492576cbae1e9b67e70c2) Thanks [@mattallty](https://github.com/mattallty)! - The first piece of a deevy CLI: a new `@deevy/cli` package that reads deevy's operation registry and works out the command list from it. Nothing is runnable yet — the commands themselves, sign-in and output formatting are the slices after this one — but the shape is now fixed, and it is the shape the API, the MCP tools and the web client already have: one operation defined once, projected to a surface (ADR-0005).
  There is nothing to install and nothing changes for a running instance.
- **cli** — [#72](https://github.com/WeAreNendo/deevy/pull/72) [`5825952`](https://github.com/WeAreNendo/deevy/commit/582595221aa43408af56dd078009d8d312326cac) Thanks [@mattallty](https://github.com/mattallty)! - Commands now answer with something a person can read. A list is a table with the columns you recognise a row by — `key`, `title`, `handle`, and the State's name rather than its id — plus whatever time the row carries, so `deevy inbox list` shows you what is unread and `deevy members list` shows you who is suspended. A single thing is its fields, with nested shapes indented under their names. An operation whose whole answer is that it happened says so in a word, and one that counts says the count.
  Free prose stays out of the grid and long values are clipped, so one Issue with a long description no longer makes every other row that wide. Titles that are not ASCII line up, because a column is not a UTF-16 unit.
  `--json` is unchanged and exact, and is what a script should use.
  Colour appears only when you are looking at a terminal: a pipe gets plain text, and `NO_COLOR` turns it off.
  None of this is written per command. The shape of the answer decides how it is shown, so an operation added to deevy is readable without anybody teaching the CLI about it.
- **cli** — [#70](https://github.com/WeAreNendo/deevy/pull/70) [`a142f03`](https://github.com/WeAreNendo/deevy/commit/a142f03a150c2be773ce30df047dcd29dc39c33c) Thanks [@mattallty](https://github.com/mattallty)! - Every operation deevy has is now a command. `deevy issues create --project-key DEV --title "..."`, `deevy issues move DEV-42 --state-id ...`, `deevy runs list`, and ninety more — none of them written by hand. The command name, its help text, which arguments are positional and which are flags, what an enum accepts and what is required all come from the same definition the REST route and the MCP tool come from, so an operation added to deevy is a command with no CLI change at all.
  Path parameters are positional and everything else is a flag: `deevy issues get DEV-42`, `deevy issues list --project-key DEV --assignee-kind agent`. A list is one flag given more than once. `--json` is on every command.
  Four operations answer with an explanation instead of a request. `gates approve` and `gates reject` are a Human's, in a browser, and no CLI, key or Agent can rule a Gate whatever it is signed in as. `oauth-clients list` and `oauth-clients revoke` want a Human signed in to deevy itself, because a delegated credential should not be able to list or revoke the consents that delegated it. The CLI says which of the two rules it hit rather than passing back a bare `FORBIDDEN`.
  It also refuses before asking when it already knows the answer: an operation an Agent may not call says that `DEEVY_API_KEY` is why, and one only an Agent may call says to set it.
  When deevy refuses input, you get the reason the schema wrote — "Two to six uppercase letters, as in DEV", against the flag you typed — rather than "Input validation failed".
  Point a command at an instance with `--deevy-url`, or set `DEEVY_URL` once.
  The Event stream is not a command yet.
- **cli** — [#73](https://github.com/WeAreNendo/deevy/pull/73) [`3ec9144`](https://github.com/WeAreNendo/deevy/commit/3ec9144cd8e57b260e472462cc439f55a00fdb83) Thanks [@mattallty](https://github.com/mattallty)! - `deevy events watch` follows the Event log as it happens, resuming from where it got to and reconnecting when a stream ends — which is what a Cloudflare-hosted instance does after every poll, so a watch that did not reconnect would quietly stop after a few seconds there while working fine against a Docker one. `--after` resumes from an Event you name, `--project-id` narrows it, `--json` gives you one Event per line for a script, and Ctrl-C ends it.
  `deevy gates open DEV-42` puts a Gate in front of the Human who can rule it. The link is built on `DEEVY_URL`, which is the API — if your SPA is somewhere else, as it is in the development loop, say so with `--web-url` or `DEEVY_WEB_URL`. `gates approve` and `gates reject` still exist and still refuse, because a Gate is ruled in deevy's own browser and by nothing else — this is the verb that does something about that rather than being told about it. The URL goes to stdout so it can be piped somewhere; the explanation does not.
- **cli** — [#69](https://github.com/WeAreNendo/deevy/pull/69) [`5f3b053`](https://github.com/WeAreNendo/deevy/commit/5f3b053c28ef901d6f030011731b7c6472471c31) Thanks [@mattallty](https://github.com/mattallty)! - `deevy login`, `deevy logout` and `deevy whoami`. Signing in opens a browser, takes the consent you would give any other client, and keeps the token at `~/.config/deevy/<instance>.json` — one file per instance, mode 0600, so signing into a second deevy does not sign you out of the first.
  Set `DEEVY_API_KEY` and the CLI acts as that Agent instead, which is what a script wants. It wins over a stored token because it is the explicit thing you put there for that one run, and `deevy whoami` says which of the two it used — that changes what the CLI may do, so it is stated rather than left to be guessed.
  Nothing else is runnable yet: the operations arrive in the next release.
- **cli** — [#74](https://github.com/WeAreNendo/deevy/pull/74) [`e5e8f09`](https://github.com/WeAreNendo/deevy/commit/e5e8f09c60cccd1d47fb4ea1eb15c841de2adab9) Thanks [@mattallty](https://github.com/mattallty)! - The CLI is on npm:
  ```bash
  npm install -g @deevy/cli
  deevy login https://deevy.example.com
  ```
  It is the only package deevy publishes — everything else in the workspace is part of an instance, and this is the part you install. Its version is deevy's: the same number as the image and the instance, always.
  The tarball is the bundle, the readme and the licence, with no dependencies to resolve: `vp pack` inlines everything. It is published from the release tag with npm provenance, so the workflow, the commit and the repository that built it are recorded and anybody can check them.
  **One thing an admin has to do once**: add an `NPM_TOKEN` secret with publish rights to the `@deevy` scope. Without it the release still tags, still writes its notes and still pushes both images — only this job fails.

### Patch Changes

- **server, agent** — [#61](https://github.com/WeAreNendo/deevy/pull/61) [`3d3e6f8`](https://github.com/WeAreNendo/deevy/commit/3d3e6f826e66638e30a1334dc65eaec2821faba9) Thanks [@mattallty](https://github.com/mattallty)! - deevy has moved to the WeAreNendo organisation on GitHub, and its images with it. From this release on they
  are published as `ghcr.io/WeAreNendo/deevy` and `ghcr.io/WeAreNendo/deevy-agent`; the old paths under
  `ghcr.io/mattallty` keep every tag they already have and receive no new ones. Change the image in your
  compose file or `docker run` line, and the `DEEVY_AGENT_IMAGE` you pass to the runtime if you set one. The
  repository itself redirects from its old address, so links and clones keep working.
- **agent** — [#62](https://github.com/WeAreNendo/deevy/pull/62) [`8d54abc`](https://github.com/WeAreNendo/deevy/commit/8d54abc6c2805c84dbc37fade971221e3455f433) Thanks [@mattallty](https://github.com/mattallty)! - The runtime no longer goes down when the git it serves a local repository with answers before it has read
  the whole request, or is not there to be started. Both showed up as a crash of the supervisor rather than
  as a failed push, and only with a repository on disk as the remote — the acceptance walk and the tests —
  never with a remote on the internet. A backend that finishes early now has its answer relayed as it was,
  and a git that cannot be started is a 502 that says so.

## 0.7.0

### Minor Changes

- **core** — [#59](https://github.com/mattallty/deevy/pull/59) [`6d9a5b0`](https://github.com/mattallty/deevy/commit/6d9a5b0fea7866813837e6948158876c9815ee72) Thanks [@mattallty](https://github.com/mattallty)! - A sub-issue may now live in a different Project from its parent. Work has dependencies that run across
  Projects — the piece that has to land in the API before the piece in the app can — and a parent link that
  stopped at the boundary did not remove the dependency, it moved it onto somebody writing it down twice. An
  Agent may open a child in any Project it was granted, and the child follows that Project's Workflow and its
  Gates. A parent in a Project you cannot see is not shown to you, and an Issue whose parent is hidden that way
  cannot be moved out of its tree.
  This also fixes an Issue's parent and children being labelled with the wrong key. They were named after the
  Project of the Issue you were looking at, which was invisible while a tree could not cross one.
- **core** — [#59](https://github.com/mattallty/deevy/pull/59) [`6d9a5b0`](https://github.com/mattallty/deevy/commit/6d9a5b0fea7866813837e6948158876c9815ee72) Thanks [@mattallty](https://github.com/mattallty)! - Creating an Issue that is already assigned now tells the Assignee. It did not before — the assignment was
  silent until somebody changed it — so an Issue opened for a Member never reached their inbox, and one opened
  for an Agent never started its Run. Both do now, from the one call that created it. An Issue opened under a
  parent also says so in the Activity, rather than leaving a reader to click through to find out.
- **core, web** — [#59](https://github.com/mattallty/deevy/pull/59) [`6d9a5b0`](https://github.com/mattallty/deevy/commit/6d9a5b0fea7866813837e6948158876c9815ee72) Thanks [@mattallty](https://github.com/mattallty)! - An Agent that splits work into sub-issues can no longer split it forever. Your Workspace now carries three
  limits — how many sub-issues one Issue may have, how many levels deep they may go, and how many may be open
  in one tree at once — and an Agent that reaches any of them is refused, with a line in the log so you can see
  that a number shaped the work rather than the Agent. They start at 20, 3 and 50, an admin changes them under
  Settings › Workspace, and they never apply to a Human.
- **core, web** — [#59](https://github.com/mattallty/deevy/pull/59) [`6d9a5b0`](https://github.com/mattallty/deevy/commit/6d9a5b0fea7866813837e6948158876c9815ee72) Thanks [@mattallty](https://github.com/mattallty)! - An Issue now shows what its sub-issues are doing: where each one has got to, which ones have an Agent working
  them right now, and how many are still open. A Gate on an Issue whose sub-issues are unfinished says so where
  the buttons are — it does not stop you ruling, it just stops you being the last to know.
  And an Agent splitting work up no longer floods its Sponsor's inbox. Six sub-issues opened at once are one
  line, not six, and there is a second line when the last of them is finished. A sub-issue assigned to a Human
  still reaches that Human directly, because a rollup is for the wave and never for somebody's own work.
  "Sub-issues" is a Notification kind of its own now, so you can turn it off or route it to Slack like any other.
- **core** — [#59](https://github.com/mattallty/deevy/pull/59) [`6d9a5b0`](https://github.com/mattallty/deevy/commit/6d9a5b0fea7866813837e6948158876c9815ee72) Thanks [@mattallty](https://github.com/mattallty)! - An Agent that splits work into sub-issues no longer has to sit and wait for them. It finishes its Run, and
  when the last sub-issue closes it gets a new one to pick the work back up from — reading what its sub-issues
  concluded off the Issue, the way anybody else would. Where there is no Agent left to wake, because it was
  suspended or lost the Project, the Issue still says its sub-issues are done, so the work is visibly somebody's
  rather than silently nobody's. A sub-issue in another Project counts exactly the same: done is done wherever
  it is.

### Patch Changes

- **core, db** — [#59](https://github.com/mattallty/deevy/pull/59) [`6d9a5b0`](https://github.com/mattallty/deevy/commit/6d9a5b0fea7866813837e6948158876c9815ee72) Thanks [@mattallty](https://github.com/mattallty)! - Two sub-issues of one parent finishing at the same moment no longer starts the parent's Agent twice. "At most
  one open Run per Issue and Agent" was a rule every caller checked for itself, which only held while nothing
  happened at once — and the ordinary ending of a fan-out is two things happening at once. The database keeps
  the rule now. If your instance already has duplicate open Runs from before this, the migration closes the
  later one and says so in its summary.
  Opening a sub-issue also got cheaper: it was spending more statements than a Cloudflare D1 request allows on
  the deepest tree the default limits permit, so on the Worker deployment it would have failed outright. Raising
  the "Levels deep" limit no longer makes that write more expensive at all.
- **db** — [#59](https://github.com/mattallty/deevy/pull/59) [`6d9a5b0`](https://github.com/mattallty/deevy/commit/6d9a5b0fea7866813837e6948158876c9815ee72) Thanks [@mattallty](https://github.com/mattallty)! - An Agent that splits work into sub-issues can no longer split it forever. Your Workspace now carries three
  limits — how many sub-issues one Issue may have, how many levels deep they may go, and how many may be open
  in one tree at once — and an Agent that reaches any of them is refused, with a line in the log so you can see
  that a number shaped the work rather than the Agent. They start at 20, 3 and 50, an admin changes them under
  Settings › Workspace, and they never apply to a Human.

## 0.6.0

### Minor Changes

- **core, db, web** — [#57](https://github.com/mattallty/deevy/pull/57) [`3920978`](https://github.com/mattallty/deevy/commit/392097882bb53a4e3a217edcb87df1264bbd2f65) Thanks [@mattallty](https://github.com/mattallty)! - A Gate that wants two Humans no longer collects approvals of two different texts. When a Document changes
  while its Issue is sitting at such a Gate, the approvals already given are cleared and the Gate asks again —
  the ruling card says so where the buttons are, and the Activity says which Document changed. Nothing is
  deleted: the rulings stay in the log and the version each one approved stays pinned. A Gate that wanted one
  Human is untouched, because the Issue has already gone through it.
- **core, db** — [#57](https://github.com/mattallty/deevy/pull/57) [`3920978`](https://github.com/mattallty/deevy/commit/392097882bb53a4e3a217edcb87df1264bbd2f65) Thanks [@mattallty](https://github.com/mattallty)! - A room now remembers what was typed in it and turns it into versions. Thirty seconds of quiet writes the
  markdown the room holds; a further quiet within ten minutes, by the same people, amends that version rather
  than adding another, so an afternoon of writing leaves a history somebody can read. A version names everyone
  whose keystrokes are in it, and `documents.versions` reports them. A version a Gate ruled on is never
  amended. An Issue's description is saved the same way, without versions, because it has none.
- **core, web** — [#58](https://github.com/mattallty/deevy/pull/58) [`158a005`](https://github.com/mattallty/deevy/commit/158a0057e4fac5239bbda48bf58a3c3376cc2c3e) Thanks [@mattallty](https://github.com/mattallty)! - A tab left open on a Document and put to sleep now comes back cleanly. A room whose stored state has grown
  large enough to be swept up starts the Document's identity again, and a browser that was away across that
  used to sync its old copy in beside the new one — the same text, twice. The room now turns such a browser
  away instead, and the browser puts what you typed while you were gone back as markdown, merged the way an
  Agent's write is merged. Where your words and the room's changed the same lines, the room keeps what it has
  and the editor hands yours back for you to place, rather than dropping them or pasting them over somebody.
- **core** — [#57](https://github.com/mattallty/deevy/pull/57) [`3920978`](https://github.com/mattallty/deevy/commit/392097882bb53a4e3a217edcb87df1264bbd2f65) Thanks [@mattallty](https://github.com/mattallty)! - An Agent writing a Document somebody is typing in no longer has to win or lose. `documents.get` hands back
  the live text and an opaque `basis`; echo it on `documents.write` and the server replays what you _changed_
  onto what the Document says now, so your paragraph and theirs both survive. Where the two genuinely
  collide — the same lines on both sides — the write is refused, naming the section, and the Agent re-reads
  and tries again; the Human typing is never interrupted. `documents.writeSection` rewrites one heading's
  worth without sending the rest of the Document, which merges by construction and reads better in the log.
- **core, web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - Edit a Document where you read it. The intent, spec and plan panes have no Edit button and no read mode any
  more: the text on screen is the editor, and leaving it — or ⌘Enter — writes a version, with a line that says
  whether the save landed. The byline names every Member who has written a version, Humans and Agents alike
  ("written by Ada and Planner"), and the older versions moved behind a ⋯ menu that opens the full history,
  reads any version and can restore one. A save that would land on top of somebody else's is now refused
  rather than quietly winning: `documents.write` takes the version the text was read from, and a new
  `documents.versions` operation lists who wrote what and when.
- **core, web** — [#57](https://github.com/mattallty/deevy/pull/57) [`3920978`](https://github.com/mattallty/deevy/commit/392097882bb53a4e3a217edcb87df1264bbd2f65) Thanks [@mattallty](https://github.com/mattallty)! - Documents are live. Open an Issue in two browsers and you are writing in the same text: what one types the
  other sees, with a caret in their colour showing where they are and their avatar beside the byline. Nobody
  presses save — the room writes a version when the typing stops. Lose the connection and you keep typing; it
  merges when you are back, and the editor says so rather than pretending. An Issue's description works the
  same way.
  Where a deployment has no rooms — a Worker without the Durable Object binding — every editor behaves exactly
  as it did before, and `health.ping` says which it is.
- **core, db, web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - A Gate ruling now records what it ruled on. Every approval and rejection pins the version each of the
  Issue's Documents stood at, so "approved" is a statement about words that cannot change afterwards: the
  ruling reads "on spec v2", it says so when the text has been written since, and the Document's history marks
  the version a Gate approved or rejected. `documents.versions` reports those rulings per version, for Agents
  as well as Humans.
- **core, db, web** — [#48](https://github.com/mattallty/deevy/pull/48) [`2051571`](https://github.com/mattallty/deevy/commit/2051571c74fdeee56671ffe11664fa79700f461b) Thanks [@mattallty](https://github.com/mattallty)! - Repositories are gone. Registering one only ever decorated a Link with the repository's own name and cost a settings screen, a table, two Event kinds and three API operations to do it; nothing read the attribution back, and it was never what let an Agent push — where a Run pushes is the runtime's own configuration.
  What this changes for you: the `repositories.list`, `repositories.create` and `repositories.delete` operations and the Settings › Repositories screen no longer exist, a Link no longer carries a `repository` or `repositoryId` (its kind and ref are still derived from the URL exactly as before), and the `repository.created` and `repository.deleted` Events are no longer written. The migration drops the `repository` table and the `issue_link.repository_id` column; the Links themselves are kept. The Workspace set-up strip also drops its allowlist item, whose fix was the Allowlist row on the same page, so it now counts a Project, an Agent and a Channel.
- **core, web, server** — [#57](https://github.com/mattallty/deevy/pull/57) [`3920978`](https://github.com/mattallty/deevy/commit/392097882bb53a4e3a217edcb87df1264bbd2f65) Thanks [@mattallty](https://github.com/mattallty)! - Groundwork for Documents two Members can write at once: the room exists, and nothing uses it yet. Operators
  deploying the Worker should know that it now declares a Durable Object binding (`ROOMS`) and the
  `nodejs_compat` and `new_module_registry` compatibility flags — a deploy creates the object, and Durable
  Objects need a paid Workers plan. The Node deployment needs nothing extra and answers the same websocket on
  the port it already listens on.
- **core, web** — [#57](https://github.com/mattallty/deevy/pull/57) [`3920978`](https://github.com/mattallty/deevy/commit/392097882bb53a4e3a217edcb87df1264bbd2f65) Thanks [@mattallty](https://github.com/mattallty)! - A Document open in your browser now tells you when an Agent has written into it. An Agent never joins a
  room — its edit arrives as a block rather than as typing, so a cursor for it would be a lie — and instead
  the Document's header says "Planner just wrote this" for as long as the change is still a surprise. The
  write itself lands in the room as it happens, so the paragraphs change in front of you rather than the next
  time the page is loaded.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - Formatting floats over what you selected instead of sitting above what you are reading. The strip of buttons
  above every Document, description and comment is gone; select some words and the same buttons appear beside
  them. Inserting a table or a divider is what the `/` menu is for, so those two moved there rather than being
  carried around by a toolbar all day.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - The Issue peek can be dragged wider by its left edge, and remembers how wide you left it. It still opens at
  45% of the window and will not go under that, or under the 56rem its two-column layout needs; the edge is a
  proper splitter, so the arrow keys move it and Home puts it back. On a phone, where the peek is the whole
  screen, there is nothing to drag.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - An Issue's title and description are edited where they are read, the way its Documents already were. The
  Edit button and the form behind it are gone: click the title and type, press Enter or move on and it is
  saved; Escape puts back what was there, and an empty title is refused rather than written. The description
  is the same editor a Document gets, and a line beside the Issue's key says when something is saving, when it
  is saved, and offers to try again when it failed.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - The Issue view takes the shape chosen from ten layouts (docs/plans/issue-view.md): the Documents are the
  subject of the page and say who wrote them, the rail is wide enough to read as a column rather than a
  gutter, and an Agent's Run sits in that rail beside the ruling it is waiting on instead of under the
  Documents, where a long Run pushed the conversation off the screen. The side peek shows the same page.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - The Edit/Source tabs are gone from every editor. Two tabs above each Document, description and comment were
  a choice nobody was making, and they took a line of chrome from every reading of the text underneath them.
- **web** — [#57](https://github.com/mattallty/deevy/pull/57) [`3920978`](https://github.com/mattallty/deevy/commit/392097882bb53a4e3a217edcb87df1264bbd2f65) Thanks [@mattallty](https://github.com/mattallty)! - Live Documents work on the Cloudflare deployment: each room is a Durable Object, and the Worker routes
  `/collab` to it. Durable Objects are a paid feature, so a deployment without the `ROOMS` binding keeps
  exactly the Documents it had — `health.ping` says which, and nothing opens a socket that would not answer.

### Patch Changes

- **core** — [#57](https://github.com/mattallty/deevy/pull/57) [`3920978`](https://github.com/mattallty/deevy/commit/392097882bb53a4e3a217edcb87df1264bbd2f65) Thanks [@mattallty](https://github.com/mattallty)! - A Document typed into for months no longer carries every keystroke it ever had. A room's stored state is
  written in half the bytes it used to take, and once it passes a quarter of a megabyte with nobody in the
  room it is rebuilt from the Document's own markdown and the history is dropped. Rooms saved by earlier
  versions are read exactly as before.
- **core** — [#58](https://github.com/mattallty/deevy/pull/58) [`158a005`](https://github.com/mattallty/deevy/commit/158a0057e4fac5239bbda48bf58a3c3376cc2c3e) Thanks [@mattallty](https://github.com/mattallty)! - The demonstration data no longer opens an Issue for mirroring Documents into the code repository. That is not
  on the roadmap any more, and a seeded Issue is a promise like any other.
- **core, web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - An Agent is now created with its first API key, and the dialog that created it is where you read that key — the only time it is readable, since deevy keeps a hash. An Agent with no key can reach nothing at all, so making one was an errand every Sponsor had to remember; `agents.create` returns it (and null where an instance has no way to mint keys at all), so an Agent created over the API arrives connectable too. The key is called "first key" in the list, `agent.key_issued` is in the Event log for it exactly as for one you issue yourself, and every later key is still issued from the Agent's own page.
  Connecting is now explained where the key is, rather than once above the list of every Agent. The dialog that creates an Agent — and the banner beside any key you issue afterwards — carries the command to connect with **that key already written into it**, because that is the one moment deevy can fill it in. The Agent's own page carries the same block standing, and there it names the key rather than containing it: `DEEVY_AGENT_KEY` for the clients that read a variable, and a placeholder for the two that do not.
  Every one of them offers a tab per coding agent — Claude Code, OpenCode, Cursor CLI, Copilot CLI, and the shape anything else speaking MCP over streamable HTTP takes — with the file to write or the command that writes it. The four named are the ones the reference runtime drives itself. Which clients get the variable form is not a guess: Claude Code expands `${VAR}` in the entry it writes and OpenCode reads `{env:VAR}`, while Cursor documents `${env:VAR}` but does not resolve it for a remote server and the Copilot CLI documents nothing, so those two are told the key itself rather than a reference deevy would receive verbatim.
- **core, db, web** — [#51](https://github.com/mattallty/deevy/pull/51) [`1d7b221`](https://github.com/mattallty/deevy/commit/1d7b2214fe391e45e370cefbf170aa63c1579ce7) Thanks [@mattallty](https://github.com/mattallty)! - A Gate can now ask for more than one Human. Each Gate carries the number of distinct Humans who must approve before an Issue leaves it, and that number defaults to one, so every Workflow you already have behaves exactly as it did. Set it on a Gate and the Issue stays put until the last of them approves: each approval before that is its own `gate.approval` Event carrying how many are still wanted, the Issue enters no State, no Document is opened, and an Agent waiting at the Gate is still told `awaiting`. `gate.approved` continues to mean what it always meant — the Issue left the Gate — so webhooks, timelines and Run resumption need no change to stay correct. Approving twice is refused, because a Gate wants distinct Humans and not one Human's opinion twice.
  Approvals count for one visit to the Gate. Entering the State begins a visit, and so does every rejection — including a rejection in the first State of a Workflow, which has nowhere to send the Issue and so leaves it where it is. One rejection ends the matter however many approvals were wanted.
  A threshold no one could ever meet is refused when you save the Workflow, naming both numbers: a Gate asking for three approvals in a Workspace where only two Humans could give one is a Gate nobody can open, and the Humans who count are the ones the Gate names, or everybody, less anyone suspended. Saving a Workflow without mentioning the number leaves each Gate's threshold as it was, so an older API client cannot widen a Gate by accident, and a State that stops being a Gate loses its threshold rather than keeping one in reserve.
- **core, db** — [#52](https://github.com/mattallty/deevy/pull/52) [`ed4c7ca`](https://github.com/mattallty/deevy/commit/ed4c7caceaa71107c6d35416af4c1727d3463cc2) Thanks [@mattallty](https://github.com/mattallty)! - A Gate can now refuse the approval of the Human who put the Issue in front of it. Turn the exclusion on for a Gate and whoever brought the Issue there is asked for nothing and refused if they try, with a message that says why rather than a bare refusal; anybody else may still approve. It is a separate choice from how many approvals a Gate wants, so a Workspace can have two approvals from anyone, or one approval from anyone but the author, or both at once.
  The requester is the Human who made the move that brought the Issue to the Gate — and when an Agent made that move, its Sponsor, which is deevy's rule for accountability everywhere else. When the Event log does not say who brought it, because an Issue was carried into a State by an edit to the Workflow rather than by anyone, the Gate excludes nobody: a rule that guessed would be worse than one that abstains.
  Saving a Workflow refuses an exclusion nobody could work around: turning it on reserves one Human from every count, so a Workspace of one cannot exclude anybody at all, and a Gate asking two approvals with the requester excluded needs three Humans. As with the approval threshold, saving a Workflow without mentioning the exclusion leaves each Gate's answer as it was, and a State that stops being a Gate loses it.
- **core, web** — [#53](https://github.com/mattallty/deevy/pull/53) [`67cb4fc`](https://github.com/mattallty/deevy/commit/67cb4fca01674554140ac319114483c02802d744) Thanks [@mattallty](https://github.com/mattallty)! - An Issue sitting in a Gate now says where that Gate has got to. The panel on the Issue reads how many Humans must agree and how many have, names the ones who did with whatever note they left, and — when you are not one of the Humans it is waiting for — disables Approve and says why instead of refusing you after the click: you are not one of the approvers it names, you brought the Issue here and it asks somebody else, or you have already approved and it wants one more.
  A Gate can also become unopenable after it was configured, because suspending a Member takes a Human out of the count. The Issue says so where the buttons are — how many approvals it wants, how many Humans could give one — and says an admin can lower the number or reinstate whoever is suspended. Rejecting stays available throughout: one rejection ends the matter whatever the threshold, including from the Human who asked.
  The Workflow editor now carries both settings on every Gate, so neither needs the API any more: how many Humans must agree, and whether whoever brings an Issue there may be one of them.
  The Issue detail carries this as a `gate` object over the API and the RPC surface, alongside the Gate rulings it already returned, and it is null for an Issue that is not in a Gate — which is also when deevy spends nothing working it out.
- **core, web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - A Document now says who wrote the version you are reading, and when they wrote it. Half the words on a deevy Issue are an Agent's and the page never said which half; the version row has carried its author since Documents were versioned, and `documents.get` returns it along with the time that version was written — the version's own time, so reading version 1 of a Document edited yesterday no longer claims it was written yesterday.
  A Gate ruling says which Gate it was at and who made it. An Issue that came through Intent, Spec and Plan showed three lines that each read "approved" over a note, with nothing to tell them apart; each one now names its Gate and the Human who ruled, with the note quoted under it.
  The dot beside a line in an Issue's Activity sits on the line it belongs to, rather than a hair above it.
- **db** — [#58](https://github.com/mattallty/deevy/pull/58) [`158a005`](https://github.com/mattallty/deevy/commit/158a0057e4fac5239bbda48bf58a3c3376cc2c3e) Thanks [@mattallty](https://github.com/mattallty)! - A tab left open on a Document and put to sleep now comes back cleanly. A room whose stored state has grown
  large enough to be swept up starts the Document's identity again, and a browser that was away across that
  used to sync its old copy in beside the new one — the same text, twice. The room now turns such a browser
  away instead, and the browser puts what you typed while you were gone back as markdown, merged the way an
  Agent's write is merged. Where your words and the room's changed the same lines, the room keeps what it has
  and the editor hands yours back for you to place, rather than dropping them or pasting them over somebody.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - In the Activity, a folded row of an Agent's steps now sits on its line like every other: the Member's name
  lines up with the chevron beside it, and the line lines up with its own dot.
- **web** — [#58](https://github.com/mattallty/deevy/pull/58) [`158a005`](https://github.com/mattallty/deevy/commit/158a0057e4fac5239bbda48bf58a3c3376cc2c3e) Thanks [@mattallty](https://github.com/mattallty)! - The line that says an Agent just wrote into a Document now disappears twelve seconds later, as it always meant to. In a Document where nobody else was typing it could stay on screen until something unrelated happened.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - The `/` block menu and the `@` mention list stay with the line they were opened on. Scrolling used to leave
  them where they were on screen, so the menu drifted away from the words it was about.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - The sidebar is 240px wide rather than 256px — the width deevy's design language always named, which the component kit's own default had been standing in for. Every label it carries still sits on one line, and the 16px goes to the Issues beside it. Nothing else about it changes: it still collapses to 48px of icons, and it is still a Sheet on a phone.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - What a command palette row says on its right — the State an Issue is in — lines up at the row's edge instead of stopping somewhere in the middle. It was sharing the row's free space with a tick the list keeps for items that can be checked, so it landed at a different place on every line depending on how long the title beside it was. Nothing in deevy checks a palette row, so the tick stays out of the way until something does.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - A Project no longer opens with the name of the Team that owns it. It sat above the Project's own name as a bare word — "Platform", with nothing saying what it was — and the Projects list already shows the same thing in a column headed Team. What is left above a Project's name is the one thing the page has to say about itself first: whether it is archived.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - A Project's settings moved off the Project and into Settings, where everything else a Workspace is made of is configured. Settings › Projects lists every Project and opens one beside the list — its name, what it is for, the Team that owns it, and archiving it — with the Project in the address, so a Project's settings are a link like a Team's are. The Project's own tabs are the work now: Issues, Board and the Workflow they move through. The tab's old address still answers, and takes you to the same Project in its new place.
- **web** — [#57](https://github.com/mattallty/deevy/pull/57) [`3920978`](https://github.com/mattallty/deevy/commit/392097882bb53a4e3a217edcb87df1264bbd2f65) Thanks [@mattallty](https://github.com/mattallty)! - Opening an Issue with a live Document no longer logs a React warning about updating one component while
  another renders.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - The bar the Board scrolls sideways on is thinner, and drawn in the border colour rather than as the platform's default shelf under the cards. The wheel is left to the browser: sideways is Shift and a wheel, a trackpad's own gesture, or that bar.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - The Activity timeline drops the avatar in front of every name. The stream already marks each line with a
  tone dot down its left edge, and a second column of pictures beside it was one more thing to read past; the
  name is enough, an Agent's is in the Agent colour, and hovering still says Human or Agent. Those dots now
  sit on the centre of the line they belong to rather than a hair above it.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - The Issue peek takes 45% of the window rather than a fixed width, so it is the same share of a laptop and of
  a 34" display: since the peek shows the whole Issue — rail, ruling and Runs — a width that suited one was a
  gutter on the other. It never goes under 56rem, which is what the two-column layout needs, never over 92% of
  the window, so the list you came from stays visible, and on a phone it is the whole screen.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - A line in an Issue's Activity reads as one sentence now. Whoever acted was drawn with an avatar taller than the line it sat on and a name a size smaller than the words after it, so each row read as a badge followed by a caption. The avatar is the height of the text beside it — ring and all, since the ring round a Human or an Agent is painted outside the circle — and the name is the size of the rest of the sentence.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - Nothing a deployment can see: the dev server picks a free port when 5173 is taken, and the SPA's own tests
  wait as long for a query as the machine actually needs.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - Changing a filter no longer blanks the screen on the way to the answer. The Issue list, the Board and the Event log each asked a new question and showed nothing while it was in flight: the count under the heading disappeared, the rows were replaced by a skeleton, and both came back a moment later — a flicker on every filter, and a page that jumped as the count's line collapsed and reopened. What you were reading now stays where it is until the new answer arrives and replaces it. A skeleton is still what you see the first time a list loads, when there is genuinely nothing to keep.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - The labels down the side of an Issue — State, Assignee, Labels, Parent, Children, Links — are all one size again. Three of them had drifted two pixels larger than the others, which is the size deevy uses for the headings of the column you read beside them, so the rail looked like it was competing with the Issue rather than annotating it.
- **web** — [#48](https://github.com/mattallty/deevy/pull/48) [`2051571`](https://github.com/mattallty/deevy/commit/2051571c74fdeee56671ffe11664fa79700f461b) Thanks [@mattallty](https://github.com/mattallty)! - The interface explains itself less and gets out of the way more. Every Settings page and section that carried a line of prose under its heading — "Agents work alongside your team on the same Issues", "Your Workspace's name, who can join it", the note about API keys being stored as a hash — now goes straight from the heading to the thing itself. The Inbox and Projects lost theirs too. What survives is the text that does work where it stands: the two lines introducing the commands that connect an Agent or an MCP client, the guidance in each empty state, and the dialogs that say what a choice commits you to. Those, and the rest of the app's copy, now speak to you rather than describing the system, and no environment variable name appears in the interface any more.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - The Activity timeline's dots are bullets now rather than rings — punctuation down the edge of the feed
  instead of the first thing on every line — and each one sits on the centre of the line it belongs to.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - A Board is now a frame rather than a page that grows. On anything wider than a phone it is exactly as tall as the room below the filters, and each column scrolls its own cards: the Workflow stays on screen while you read down a State, the column headers and their counts stay put, and a wheel over a column does what a wheel does everywhere else. It also stopped spending height on saying what it is: the page's bottom gutter goes to the cards, and the "Board" heading is gone — the Project's name is the page's heading and the tab above already says which one you are on. On a 1440x900 screen that is a column 100px taller than before. A Board on a phone still grows and scrolls with the page, because the chrome above it leaves about 300px there and a frame that size would show two cards.
  The frame around every screen changed with it: the window itself no longer scrolls, the page area does. The sidebar and the top bar therefore stay where they are on a long page instead of sliding away, and a screen that asks for the viewport's height now gets the room that is actually there.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - A Board with more columns than fit no longer drags the whole page sideways with it. The board has always had its own horizontal scroll, but the words only a screen reader hears — the "Gate" on a State, the letter behind an avatar — are positioned text, and positioned text is clipped by whatever it is positioned against rather than by whatever scrolls. Against the page, they landed wherever their off-screen column was, and the page grew a scrollbar of its own: the sidebar and the header slid away as you moved through the Workflow. The board is now what they are positioned against, so it is the only thing that scrolls.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - The command palette opens in the middle of the window. It was pinned a third of the way down, which reads as centred while it is showing four results and slides to the bottom of the screen as the list fills — on a full list it ended 14px from the bottom edge. It is centred now whatever it is showing, and still fits on a short screen.
- **web** — [#55](https://github.com/mattallty/deevy/pull/55) [`85cfa76`](https://github.com/mattallty/deevy/commit/85cfa76bc8e9766c8a1dd9d271a90a1be4b92e50) Thanks [@mattallty](https://github.com/mattallty)! - An Issue opened beside a list now looks like the Issue page, because it is wide enough to be it. The panel was narrower than the width at which an Issue lays itself out in two columns, so it stacked the rail — the Gate ruling, the Assignee, the Labels, the Links — on top of the description and showed the Issue in an order nothing else in deevy uses. It is wider now, and reads top to bottom exactly as the full page does.
  It also stopped behaving like a dialog. There is no dimmed backdrop and nothing behind it is disabled: the list, the Board or the Inbox it was opened from stays lit and usable, which is how a panel beside your work should feel. On a phone it is still the full width of the screen, with the rail first.

## 0.5.3

### Patch Changes

- **core, web, server** — [#45](https://github.com/mattallty/deevy/pull/45) [`e4508d2`](https://github.com/mattallty/deevy/commit/e4508d2a388415d706cdd6f98f65b56c8563cc52) Thanks [@mattallty](https://github.com/mattallty)! - Every link deevy hands a Human — the Gate link an Agent surfaces mid-Run, an invitation, a Slack message —
  is now built on the origin a browser finds deevy at, rather than on the origin the API answers on. They are
  the same in the Docker image and on the Worker, which serve the SPA themselves; in the `dev` loop and on a
  split-origin deployment the API is a second port that serves no page, and a Gate link built on it 404s.
  Where the SPA has an origin of its own, `DEEVY_WEB_ORIGIN` is what deevy builds those links on. It was
  already the CORS allowance for exactly that deployment, so an operator who has set it needs to change
  nothing; one that has not is a deployment where the two origins are the same.
- **core, web, server** — [#38](https://github.com/mattallty/deevy/pull/38) [`2795934`](https://github.com/mattallty/deevy/commit/27959343a2f90bc9e5378a001bcfb4b60fabf3f3) Thanks [@mattallty](https://github.com/mattallty)! - Which providers an instance offers a Human to sign in with is now configuration rather than a constant.
  `createAuth` registers the entries whose client id and secret are both set, `health.ping` reports that
  list publicly, and the sign-in page draws one button per entry in the order the server sent. Setting only
  half a pair — a `GITHUB_CLIENT_ID` with no secret — no longer registers a provider whose sign-in ends on
  GitHub's own error page: the entry is absent, and an instance with no provider configured says so on the
  page instead of offering a button that goes nowhere. GitHub stays the one entry, on the same
  `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, so an instance whose environment is unchanged sees only
  the heading's wording change.
- **core, db** — [#44](https://github.com/mattallty/deevy/pull/44) [`eba5cb5`](https://github.com/mattallty/deevy/commit/eba5cb55515a6814590c123cc0f19f2884e133ac) Thanks [@mattallty](https://github.com/mattallty)! - An admin can now admit exactly one person, instead of opening the door to their whole email domain. A new
  `invitations.create` takes an address and a role and hands back a URL to send however the admin likes — deevy
  has no email Channel, so nothing about inviting somebody waits on a mail transport. `invitations.list` and
  `invitations.revoke` are the other two admin operations, and `invitations.accept` is what the invited Human
  calls after signing in with whichever provider the instance offers.
  The link is a bearer: 32 random bytes, shown once in the response that created them, stored only as a
  SHA-256 hash, and in no Event payload and no list output. An admin who loses one revokes the invitation and
  issues another. An invitation is good for seven days, one address may hold one live invitation at a time,
  and the invited address has to be the address that signs in — a forwarded link is not a second seat. An
  unknown token is a 404, an expired or revoked one a 400, a mismatched address a 403 naming the address the
  invitation was for, and somebody who is already a Member gets their Member row back rather than an error.
  Accepting inserts the Member with the invited role and appends `invitation.accepted` and `member.joined`, so
  the Workspace's history reads the same whether a teammate joined by an allowlist rule or by invitation. The
  `invitation` table is a new migration; the SPA screens that create and accept invitations follow.
- **core, web, server** — [#43](https://github.com/mattallty/deevy/pull/43) [`9367dbb`](https://github.com/mattallty/deevy/commit/9367dbb50f52ae72a02eb16b7410dffa19918810) Thanks [@mattallty](https://github.com/mattallty)! - An instance behind an OpenID Connect IdP — Okta, Entra, Keycloak, Authentik, anything that publishes a
  discovery document — now offers one sign-in button that works, configured from four environment variables and
  nothing else. Set `DEEVY_OIDC_ISSUER` to where the IdP publishes `/.well-known/openid-configuration`
  (`https://acme.okta.com`, a Keycloak or Authentik realm URL with its path), `DEEVY_OIDC_CLIENT_ID` and
  `DEEVY_OIDC_CLIENT_SECRET` to the client pair, and the sign-in page draws the button beside whatever else is
  configured. The Redirect URI to register with the IdP is `${BETTER_AUTH_URL}/api/auth/callback/oidc` — deevy's
  own name for the entry, whatever the IdP is called. All three or none: the authorization, token, userinfo and
  JWKS endpoints are read out of the discovery document, so an issuer is as load-bearing as a client id.
  `DEEVY_OIDC_NAME` is what the button says, defaulting to "Single sign-on". It is reported by `health.ping` with
  the rest of the providers, so naming your IdP "Acme SSO" is a variable and not a deployment of the SPA.
  deevy asks for `openid`, `profile` and `email` and nothing more, uses PKCE, and refuses to register a provider
  whose discovery document names no issuer and no `jwks_uri`: an OIDC sign-in's identity is its `id_token`'s
  claims, and a token nobody can verify is not an identity. Who may join is unchanged — the allowlist decides,
  and an `email_domain` rule admits the addresses the IdP hands out. A teammate who already signed in with
  another provider keeps their one Member: the OIDC sign-in links onto the address they already hold.
  One entry, not a list. A self-hosted deevy has one IdP, and a second one would be JSON in a secret.
- **core, db, web, server** — [#42](https://github.com/mattallty/deevy/pull/42) [`a236ab7`](https://github.com/mattallty/deevy/commit/a236ab738f14ba089b54a133707f67fe222bf0d5) Thanks [@mattallty](https://github.com/mattallty)! - deevy now offers GitLab as a sign-in provider, and a GitLab group is an allowlist rule the way a GitHub
  organization is. Set `GITLAB_CLIENT_ID` and `GITLAB_CLIENT_SECRET` — environment variables on the Node
  server, `wrangler secret put` on the Worker — and the sign-in page draws a GitLab button beside whatever
  else is configured. The Redirect URI to give the GitLab application is
  `${BETTER_AUTH_URL}/api/auth/callback/gitlab`, and both halves or neither, the same rule every provider
  follows.
  One entry serves gitlab.com and a self-hosted instance: `GITLAB_ISSUER` is where GitLab is, defaulting to
  `https://gitlab.com`, and the authorization, token and `/api/v4` endpoints are all built from it.
  Settings, Allowlist gains a **GitLab group** rule beside Email domain and GitHub organization. Its value is
  the group's full path — `acme/platform` — and a subgroup is not its parent: `acme` admits nobody from
  `acme/platform` unless you say so. A group rule needs the `read_api` scope, the only one GitLab has that
  lists a person's groups, so deevy asks for it beside `read_user`; the token is the sign-in's own, read once
  on the join and never again, and an instance with no group rule never spends it. Existing rules and the two
  kinds that were already there are unchanged, and the schema needed no migration.
  An allowlist value is now validated per kind rather than against one pattern: `acme/platform` is a group
  path and is still refused as an email domain. A provider that cannot be reached when the rule is checked
  now costs a teammate their join and not their sign-in — they land signed in and not a Member, and the next
  sign-in asks again.
- **core, web, server** — [#45](https://github.com/mattallty/deevy/pull/45) [`e4508d2`](https://github.com/mattallty/deevy/commit/e4508d2a388415d706cdd6f98f65b56c8563cc52) Thanks [@mattallty](https://github.com/mattallty)! - A teammate whose first sign-in was GitLab can now add a second provider. GitLab's API carries no
  `email_verified` — a confirmed address is `confirmed_at` — so every GitLab sign-in was landing on a `user`
  row that had never proved its address, and Better Auth then refused that Human every later link with
  `account_not_linked`: one Human, one Member failed for exactly the provider it was meant to cover. deevy now
  reads `confirmed_at` as the proof it is, and believes a GitLab that does report `email_verified` first.
  Nothing changes for a Human already signed in with GitLab, whose row stays as it was; a fresh sign-in with
  GitLab fixes it, and an admin who cannot wait can set `email_verified` on that row by hand. An IdP behind
  `DEEVY_OIDC_ISSUER` that publishes no `email_verified` claim at all — Entra is one — has the same effect
  and no equivalent fallback; `docs/OPERATIONS.md`, "Signing in", now says so.
  `DEEVY_DEV_STUB_OAUTH=1` stands in for the client pairs as well as the endpoints, so the documented
  no-OAuth-App loop works from a fresh copy of `.env.example` again. Since a provider with half a pair is not
  offered, an environment that sets no pair at all was getting a sign-in page saying the deployment has no
  provider configured and a development form whose sign-in answered `PROVIDER_NOT_FOUND`. A stubbed instance
  now offers all four — GitHub, Google, GitLab and one generic OpenID Connect entry — and keeps whichever
  pairs the environment did set. `vp run server#seed` stubs the same way whatever the flag says, and
  `vp run web#screens` signs in with the first provider the instance offers rather than naming GitHub.
- **core, web, server** — [#41](https://github.com/mattallty/deevy/pull/41) [`c4ec225`](https://github.com/mattallty/deevy/commit/c4ec225029a3164d4bfb810573ce244a72285dac) Thanks [@mattallty](https://github.com/mattallty)! - deevy now offers Google as a sign-in provider. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` — as
  environment variables on the Node server, as `wrangler secret put` on the Worker — and the sign-in page
  draws a Google button beside whatever else is configured; leave them unset and nothing changes. The
  Authorized redirect URI to give the Google OAuth client is `${BETTER_AUTH_URL}/api/auth/callback/google`,
  and both halves or neither, the same rule every provider follows.
  Google decides nothing about who may join. deevy sets no `hd`, so anyone with a Google account can sign in
  and lands signed in, not a Member, until an allowlist rule matches them: a Google Workspace is an email
  domain, so an `email_domain` rule under Settings, Allowlist is what admits it, in the one place an admin
  already looks. A teammate who signed in with GitHub before keeps their Member and their handle when they
  sign in with Google, because the address is what identifies them.
  `docker-compose.yml` no longer demands a GitHub client pair to start: it passes whichever pairs are set, so
  an instance can offer Google alone. Under `DEEVY_DEV_STUB_OAUTH=1`, the development sign-in form now uses
  the first provider the instance offers instead of naming GitHub, so a stubbed instance configured with only
  Google signs in too.
- **core** — [#40](https://github.com/mattallty/deevy/pull/40) [`2fb4631`](https://github.com/mattallty/deevy/commit/2fb4631a44bfad3bcfd4f4d328969b8387a86266) Thanks [@mattallty](https://github.com/mattallty)! - A second sign-in links onto the Human who already holds the address only when the provider says the address
  is verified. deevy no longer trusts a provider simply because the deployment configured it.
  GitHub and Google always report a verified address, and GitLab reports it as a `confirmed_at` stamp, so
  nothing changes for those three. An OpenID Connect IdP that sends no `email_verified` claim at all —
  Microsoft Entra is one — can no longer become somebody's second provider: that sign-in is refused with
  `account_not_linked`, and the teammate keeps using the provider they started with.
  The reason to fail in that direction: trusting every configured provider meant the claim was never read, so
  an IdP with open self-registration could hand somebody an account on a colleague's address and have it
  linked onto that colleague's Member — even when the IdP truthfully said the address was unverified.
- **core** — [#40](https://github.com/mattallty/deevy/pull/40) [`2fb4631`](https://github.com/mattallty/deevy/commit/2fb4631a44bfad3bcfd4f4d328969b8387a86266) Thanks [@mattallty](https://github.com/mattallty)! - A Human who signs in with a second provider stays one Member. deevy now states its account-linking policy
  rather than inheriting Better Auth's defaults: a sign-in whose address a user already holds links onto that
  user, every provider the environment configured is trusted for it and only those, and a link is always the
  same address at both ends. So a teammate who joined with one provider in March and signs in with another in
  April keeps one handle, one inbox and one Member row.
  The trusted list is the same one `health.ping` reports and the sign-in page draws its buttons from, so
  configuring an IdP is never also remembering to trust it — and un-configuring one withdraws that trust. The
  account already holding an address still has to have proved it: a sign-in that would link onto a row whose
  email was never verified is refused with `account_not_linked` rather than joining the two, and creates no
  second Human on the address.
- **core, web** — [#45](https://github.com/mattallty/deevy/pull/45) [`e4508d2`](https://github.com/mattallty/deevy/commit/e4508d2a388415d706cdd6f98f65b56c8563cc52) Thanks [@mattallty](https://github.com/mattallty)! - Five things the sign-in work left behind, found reading it back.
  An allowlist rule that names a GitHub organization or a GitLab group now matches a teammate who is in many
  of them: both forges page their lists — thirty organizations, twenty groups — and deevy read only the first
  page, so a rule naming the one on page two matched nothing, which looked exactly like a rule that did not
  match. A join now reads up to five pages of a hundred, and a page the forge refuses fails the question
  rather than passing back a short list that looks complete.
  A Member joining through a rule takes their handle from what the provider calls them — a GitHub login, a
  GitLab username — rather than always from their display name. The profile is read once, when the Member is
  actually being created.
  `health.ping` offers only the providers Better Auth registered. A generic OpenID Connect entry is registered
  by fetching the IdP's discovery document as the instance starts, and an IdP that is down at that moment is
  skipped with a log and no error — so the sign-in page could draw a button that answered `PROVIDER_NOT_FOUND`
  until the process was restarted.
  `invitations.create` returns the link site-relative as `path` beside the absolute `url`, and the SPA builds
  what an admin copies on the origin their browser is on. In the image and on Workers the two are the same
  origin; in the `dev` loop and on a split-origin deployment the absolute URL pointed at the API, which serves
  no SPA.
  The Event log reads the three `invitation.*` Events as sentences naming the address and the role, instead of
  printing the kind, and its Kind and Subject filters can narrow to invitations and allowlist rules.
- **web** — [#45](https://github.com/mattallty/deevy/pull/45) [`e4508d2`](https://github.com/mattallty/deevy/commit/e4508d2a388415d706cdd6f98f65b56c8563cc52) Thanks [@mattallty](https://github.com/mattallty)! - The invitation an admin creates is now a link somebody can actually use, and the admin can see who has not
  used theirs. `/invite/<token>` shows the sign-in page under a line saying an invitation is waiting — it can
  say no more, because the token is a bearer and there is nothing to read without one — and holds the token
  for the sign-in that follows. Sign in with any provider the instance offers and the screen that used to say
  only "signed in, not yet a Member" spends the invitation instead, landing you in the Workspace. Somebody who
  signs in first and clicks the link second joins the same way, and a Member who lands on one is already in,
  so it takes them home.
  An address that does not match gets the message the operation gives, naming the address the invitation was
  for, with Sign out and try another account beside it: the link is still held, so signing in as the invited
  address still works. That screen also now names an invitation as a way in, beside an allowlist rule.
  Settings, Workspace gains an **Invited** row under Who may join: every invitation that is still outstanding,
  with its address, its role and how long it has left, each with Revoke. Invite someone opens a dialog for an
  address and a role, and the link it hands back is shown there once and nowhere else — deevy keeps only a
  hash of the token, so there is no Copy link on a row and no way to see it again; revoke the invitation and
  make another if it goes astray. An invitation that has run out of time is still listed, marked Expired,
  because it holds its address until it is revoked.
- **web, server, agent** — [#39](https://github.com/mattallty/deevy/pull/39) [`6bc8e74`](https://github.com/mattallty/deevy/commit/6bc8e74377bea3bb866aad01feeb3d9dea5d8c87) Thanks [@mattallty](https://github.com/mattallty)! - The development sign-in flag is now `DEEVY_DEV_STUB_OAUTH`, and it stubs every provider deevy offers rather
  than GitHub alone. Rename it wherever you set it — in `.env`, in a `docker run -e`, in a shell alias: the old
  `DEEVY_DEV_STUB_GITHUB` is not read any more and is not aliased, so an instance that still sets it starts with
  sign-in pointed at the real provider. Nothing changes for a deployment that never set it; the flag is still
  refused outright under `NODE_ENV=production`, and no Worker ever has it.
  The stub behind it (`apps/web/scripts/stub-oauth.js`, formerly `stub-github.js`) now answers for Google,
  GitLab and a generic OIDC issuer beside GitHub, and signs the `id_token` it hands back with a key pair it
  generates and publishes as a JWKS at whichever certificate URL was asked for. So a developer, the Workers
  smoke and the acceptance walk can each drive a real OAuth sign-in for any provider without an account
  anywhere.

## 0.5.2

### Patch Changes

- **release** — [#36](https://github.com/mattallty/deevy/pull/36) [`8d9fb55`](https://github.com/mattallty/deevy/commit/8d9fb558fb9bff1f9259b0b9723a51d732159228) Thanks [@mattallty](https://github.com/mattallty)! - Nothing in deevy changed. This release exists to walk the release itself end to end after a fix to it: the
  Version PR behind it is the first whose own checks run, rather than queueing for an approval that could never
  be granted. If you are on 0.5.1 you can skip it.

## 0.5.1

### Patch Changes

- **web** — [#28](https://github.com/mattallty/deevy/pull/28) [`bb21531`](https://github.com/mattallty/deevy/commit/bb215311be6f27c4d749880e25a97222ac10d248) Thanks [@mattallty](https://github.com/mattallty)! - The UI kit can now be synced to Claude Design (claude.ai/design), so a design agent builds screens out of deevy's real components instead of generic ones. `apps/web/design-system` re-exports every standalone component as one importable entry with its own stylesheet, types and per-component docs; `.design-sync/` holds the sync's configuration, its preview cards and the conventions the design agent reads. Nothing the app ships changes.
- **web** — [#32](https://github.com/mattallty/deevy/pull/32) [`5cb0ddd`](https://github.com/mattallty/deevy/commit/5cb0ddde5e85160ecab3651dbbd5f42cda06e52d) Thanks [@mattallty](https://github.com/mattallty)! - Issues can be grouped by a Label scope — one entry in Group by per scope the Workspace uses, so `epic` and
  `priority` are each a way to divide the list or column the board, with a "No epic" bucket for the Issues
  carrying none. Never by Labels at large: an Issue carries at most one Label per scope, so a scope divides
  the Issues exactly once each and a board column can take a drop, which sets that scope's Label and leaves
  every other Label alone.
- **web** — [#32](https://github.com/mattallty/deevy/pull/32) [`5cb0ddd`](https://github.com/mattallty/deevy/commit/5cb0ddde5e85160ecab3651dbbd5f42cda06e52d) Thanks [@mattallty](https://github.com/mattallty)! - Issues can be grouped by Assignee and by Project, in the list and on the board alike. On a board, dragging a
  card between Assignee columns reassigns it — including onto Unassigned, which takes it off whoever held it —
  and every Member has a column even holding nothing, so there is somewhere to drop. Project columns take no
  cards and say why: an Issue belongs to the Project its key names. The table also stops repeating whatever the
  groups already say, so grouping by Assignee brings the State column back and takes the Assignee one away.
- **web** — [#32](https://github.com/mattallty/deevy/pull/32) [`5cb0ddd`](https://github.com/mattallty/deevy/commit/5cb0ddde5e85160ecab3651dbbd5f42cda06e52d) Thanks [@mattallty](https://github.com/mattallty)! - Group by is on the board as well as the list. The columns are what a board groups by, so the board was the
  one screen where the control was hidden and the one where it is most wanted. It offers "No grouping" only
  on a list — a board with no columns is not a board — and `?group=` now carries whatever the screen groups
  by, so a grouped view is still a link.
- **web** — [#32](https://github.com/mattallty/deevy/pull/32) [`5cb0ddd`](https://github.com/mattallty/deevy/commit/5cb0ddde5e85160ecab3651dbbd5f42cda06e52d) Thanks [@mattallty](https://github.com/mattallty)! - A Settings page lays itself out by the room it actually has, not by the size of the window. The Settings
  content column is a container query now, and the nav beside it appears at 1024px rather than 768px — at
  768 it was taking 235px next to a 256px sidebar and leaving the page 161px, which pushed the window
  sideways on seven of the eleven pages. Below that the scrolling strip of tabs is the whole navigation.
  The Labels form's four columns follow the same rule and stack when they do not fit.
- **web** — [#32](https://github.com/mattallty/deevy/pull/32) [`5cb0ddd`](https://github.com/mattallty/deevy/commit/5cb0ddde5e85160ecab3651dbbd5f42cda06e52d) Thanks [@mattallty](https://github.com/mattallty)! - Settings works on a phone. Its eleven pages were a strip of tabs that scrolled sideways — MCP clients was
  four swipes from General, and the page you were on could be scrolled out of its own navigation. They are
  one control now, which names where you are without being opened and opens to the whole list in the same
  four groups the wide nav uses. The page beside it also stops adding a second 24px gutter inside the one
  the app already gives it, which was spending a quarter of a 390px screen on margins.
- **web** — [#27](https://github.com/mattallty/deevy/pull/27) [`65b4e2f`](https://github.com/mattallty/deevy/commit/65b4e2fe50d852761fbf8fd24552f30aff455153) Thanks [@mattallty](https://github.com/mattallty)! - Task-list checkboxes sit beside their text again. In the editor every `- [ ]` item stacked its checkbox above the text, and when a description or comment was read the same items carried a bullet next to the checkbox; both now render each item as one row, the checkbox at the left.
- **web** — [#32](https://github.com/mattallty/deevy/pull/32) [`5cb0ddd`](https://github.com/mattallty/deevy/commit/5cb0ddde5e85160ecab3651dbbd5f42cda06e52d) Thanks [@mattallty](https://github.com/mattallty)! - Settings › Teams is master–detail: the Teams down a rail, one of them open beside it, and the open one
  named in the URL so a Team is a link. It shows what it never used to — which Projects a Team owns, and
  which of its Members are Humans and which are Agents. Naming a Team is behind a button rather than a form
  standing above the page, taking somebody off a Team is behind that row's menu, and the only destructive
  control left is Disband, once. Below a wide column the two panes stack, so it works on a phone.
- **web** — [#32](https://github.com/mattallty/deevy/pull/32) [`5cb0ddd`](https://github.com/mattallty/deevy/commit/5cb0ddde5e85160ecab3651dbbd5f42cda06e52d) Thanks [@mattallty](https://github.com/mattallty)! - The Event log reads as a log. Its rows are 12px throughout rather than 14px, and the Actor is a name
  instead of an avatar and a name — 300 rows of avatars was a column of noise. Who is a Human and who is
  an Agent still shows, in the colour the rest of the app gives each. Its three filters now say what they
  filter on — Kind, Subject, Project — rather than leaving "Every kind" to stand on its own.
- **web** — [#32](https://github.com/mattallty/deevy/pull/32) [`5cb0ddd`](https://github.com/mattallty/deevy/commit/5cb0ddde5e85160ecab3651dbbd5f42cda06e52d) Thanks [@mattallty](https://github.com/mattallty)! - Folded to its icons, the sidebar lines up and every row can be clicked. The Workspace badge sat four
  pixels left of the column every other icon keeps, the Member's avatar had the left of its ring shaved
  off by the button clipping it, and the invisible "Projects" group label lay on top of the Projects row
  and swallowed every click on it. Settings no longer folds the sidebar on the way in and unfolds it on
  the way out either: it leaves it the way you set it. The Settings content column is wider, 1100px, and
  the app no longer scrolls sideways on a narrow window while a Settings page is open.
- **web** — [#32](https://github.com/mattallty/deevy/pull/32) [`5cb0ddd`](https://github.com/mattallty/deevy/commit/5cb0ddde5e85160ecab3651dbbd5f42cda06e52d) Thanks [@mattallty](https://github.com/mattallty)! - Settings › Workspace › General shows you the Workspace instead of only asking about it. It opens with the
  Workspace itself — its mark, its name edited where you read it, its address, when it was made, and how many
  Humans, Agents, Teams and Projects it has — and the name saves itself on blur like every other single field
  in deevy, so the Save button is gone. Who may join is a row of chips rather than a table with a form standing
  open above it. While anything is unset — no rule, no Project, no Agent, no Repository, no Channel — one strip
  at the top names what is missing and links to the page that fixes it, and it disappears once nothing is.
  Renaming the Workspace now changes the name in the sidebar, which it never did.
- **web** — [#32](https://github.com/mattallty/deevy/pull/32) [`5cb0ddd`](https://github.com/mattallty/deevy/commit/5cb0ddde5e85160ecab3651dbbd5f42cda06e52d) Thanks [@mattallty](https://github.com/mattallty)! - The Allowlist is now a section of Settings › Workspace › General, beside the Workspace's name — who may
  join is a fact about the Workspace, not a page of its own. `/settings/allowlist` redirects there, so an
  old link still lands on it. On Notifications, only the table's headings are bold now.
- **server** — [#32](https://github.com/mattallty/deevy/pull/32) [`5cb0ddd`](https://github.com/mattallty/deevy/commit/5cb0ddde5e85160ecab3651dbbd5f42cda06e52d) Thanks [@mattallty](https://github.com/mattallty)! - The seeded Workspace's fabricated people and its Allowlist rule are at `example.com`, whatever
  `DEEVY_ADMIN_EMAIL` is. The seed used to take the domain from the admin's own address, which put a real
  domain on a screen every screenshot and demo shows. The admin still signs in as themselves; only the
  fiction moved. Reseed with `--force` to pick it up, and restart the server afterwards — `--force` unlinks
  the database file, and a running server keeps serving the one it already has open.
- **server** — [#32](https://github.com/mattallty/deevy/pull/32) [`5cb0ddd`](https://github.com/mattallty/deevy/commit/5cb0ddde5e85160ecab3651dbbd5f42cda06e52d) Thanks [@mattallty](https://github.com/mattallty)! - `vp pack` no longer prints twenty lines of `UNRESOLVED_IMPORT` for `@opentelemetry/api` on every build.
  Better Auth reaches its tracer through a dynamic import with a no-op fallback and marks the package an
  optional peer; deevy does not install it, so the bundle names it external on purpose instead. Nothing
  about what the server does changes.
- **agent** — [#29](https://github.com/mattallty/deevy/pull/29) [`c8b6b06`](https://github.com/mattallty/deevy/commit/c8b6b061a522285f01da42712f9ef5cc50645840) Thanks [@mattallty](https://github.com/mattallty)! - The reference runtime is now `apps/agent` and can drive four coding-agent CLIs: Claude Code, OpenCode, Cursor
  CLI and GitHub Copilot CLI, selected with `DEEVY_AGENT_HARNESS`. Each ships as its own image
  (`deevy-agent:claude-code`, `:opencode`, `:cursor`, `:copilot`, plus `<version>-<harness>`); `deevy-agent:latest`
  stays Claude Code. What each harness bounds and does not is in `docs/OPERATIONS.md`, and `docs/harnesses.md`
  says how to add another.
- **agent** — [#31](https://github.com/mattallty/deevy/pull/31) [`f68a624`](https://github.com/mattallty/deevy/commit/f68a624620ae23afa21025df8ad2f50c50dde1de) Thanks [@mattallty](https://github.com/mattallty)! - An Agent now runs git itself: its own branches, its own commits and messages, pushed where it likes. The
  four harnesses no longer deny `git push`, `git remote`, `git config` or `gh`. The credential stays with the
  supervisor, which serves the remote on loopback and adds it on the way out, so a session's `origin` is a
  local address and its checkout holds no token. **Where an Agent can push is now the scope of the token you
  issue and whatever your forge protects**, so give it a token scoped to one repository and protect the
  branches that matter.
- **agent** — [#29](https://github.com/mattallty/deevy/pull/29) [`c8b6b06`](https://github.com/mattallty/deevy/commit/c8b6b061a522285f01da42712f9ef5cc50645840) Thanks [@mattallty](https://github.com/mattallty)! - The reference runtime drives Claude Code as a subprocess (`claude -p`) instead of through the Agent SDK,
  behind a harness contract other coding-agent CLIs can implement; `DEEVY_AGENT_HARNESS` selects the harness
  and defaults to `claude-code`. Each session now runs with a home directory of its own, so the operator's
  dotfiles and credentials are not readable from a session's shell, and the files a repository could ship to
  configure the CLI (`.mcp.json`, `.claude/`) are removed from the clone before the session starts. The
  runtime checks at startup that the harness binary runs, and logs what each Run spent when the harness
  reports it. The image no longer carries the Agent SDK; it installs the Claude Code CLI at a pinned version.
- **agent** — [#29](https://github.com/mattallty/deevy/pull/29) [`c8b6b06`](https://github.com/mattallty/deevy/commit/c8b6b061a522285f01da42712f9ef5cc50645840) Thanks [@mattallty](https://github.com/mattallty)! - The reference runtime no longer hands its session the Agent's API key. The session reaches deevy through a
  loopback proxy the runtime opens for each Run, which adds the key, offers only the twelve tools the runtime
  grants, and refuses any other tool before deevy hears of it; a refusal is written into the Run's feed as an
  error Activity. The runtime also checks that deevy answers the key before a session starts, and fails the Run
  with the reason when it does not.
- **agent** — [#31](https://github.com/mattallty/deevy/pull/31) [`f68a624`](https://github.com/mattallty/deevy/commit/f68a624620ae23afa21025df8ad2f50c50dde1de) Thanks [@mattallty](https://github.com/mattallty)! - A session now runs as its own user, so it can no longer read the supervisor's environment. On one user a
  session with a shell reads the Agent's API key and the git token out of `/proc`, whatever the environment
  allowlist hands it; the image gives the supervisor root and each session uid 10002, and the working directory
  and the session's home are handed over before it starts. Run the container with
  `--cap-drop=ALL --cap-add=SETUID --cap-add=SETGID`. A runtime that is not root keeps its old shape and says
  so in its first lines, which is fine for trying it out and is not a way to run it against a Workspace other
  people write in.
- **agent** — [#31](https://github.com/mattallty/deevy/pull/31) [`f68a624`](https://github.com/mattallty/deevy/commit/f68a624620ae23afa21025df8ad2f50c50dde1de) Thanks [@mattallty](https://github.com/mattallty)! - A pull request now carries what the Agent said. The summary it writes when it finishes its Run becomes the
  title and the body, and the commit message when the supervisor commits on its behalf; a Run that finishes
  without one keeps the runtime's old line. The instructions tell the Agent that git is its own, that the
  default branch is not to be pushed even though it can, and that what it writes when it finishes is what a
  reviewer reads.
- **agent** — [#31](https://github.com/mattallty/deevy/pull/31) [`f68a624`](https://github.com/mattallty/deevy/commit/f68a624620ae23afa21025df8ad2f50c50dde1de) Thanks [@mattallty](https://github.com/mattallty)! - Every ref a Run moves is now in its feed: the branch, the commit it came from and the one it points at, and
  whether history was rewritten. A force-push to the base branch is a sentence a Human reads on the Issue
  rather than something nobody finds. A session that pushed its own branch is attributed rather than pushed
  over: the supervisor opens a pull request for what the agent left and attaches it to the Run, instead of
  making a second branch beside it. And a Run that delivers twice, once before a Gate and once after the
  ruling, now continues its branch instead of failing the second push.
- **agent** — [#31](https://github.com/mattallty/deevy/pull/31) [`f68a624`](https://github.com/mattallty/deevy/commit/f68a624620ae23afa21025df8ad2f50c50dde1de) Thanks [@mattallty](https://github.com/mattallty)! - The runtime image documents the capabilities it actually needs:
  `--cap-drop=ALL --cap-add=SETUID --cap-add=SETGID --cap-add=CHOWN --cap-add=DAC_OVERRIDE`. Two of them are
  what lets a session be another user; the other two are what lets the supervisor hand it a working directory
  and read back what it wrote. Running with only the first two fails at the first Run.

## 0.5.0

### Minor Changes

- **release** — [#19](https://github.com/mattallty/deevy/pull/19) [`d6aa91e`](https://github.com/mattallty/deevy/commit/d6aa91e46e74152b1549aaaafc7d85e941e92ea6) Thanks [@mattallty](https://github.com/mattallty)! - Release candidates. `changeset pre enter rc` puts the release path into pre-release mode: versions become
  `0.5.0-rc.N`, the images publish under their own tags without moving `latest`, and the GitHub Release is
  marked as a prerelease. `changeset pre exit` ends the line, and the final release's notes re-list every
  change in it.

## 0.4.1

### Patch Changes

- **release** — [#14](https://github.com/mattallty/deevy/pull/14) [`d24c71a`](https://github.com/mattallty/deevy/commit/d24c71a62c58ea9c34bac0af2436d912fa575bb7) Thanks [@mattallty](https://github.com/mattallty)! - The changelog fold no longer deletes the per-package changelogs, which failed every release, and it strips a
  third shape of dependency bullet that was reaching the release notes.
- **release** — [#16](https://github.com/mattallty/deevy/pull/16) [`78fc0ad`](https://github.com/mattallty/deevy/commit/78fc0ad1fd751741769b1f52e52ea01de7284c2b) Thanks [@mattallty](https://github.com/mattallty)! - Releasing no longer tags the version pull request's own commit, the version pull request can pass its own
  checks, and a prerelease tag no longer moves the `latest` image tag.
- **release** — [#13](https://github.com/mattallty/deevy/pull/13) [`3c2bd55`](https://github.com/mattallty/deevy/commit/3c2bd5543fd4fdae4c5a7f21c9b955d02a92c142) Thanks [@mattallty](https://github.com/mattallty)! - deevy publishes a changelog. Each release now writes `CHANGELOG.md` and a GitHub Release from what its pull
  requests declared, and the images are published by merging a "Version Packages" pull request rather than by
  pushing a tag by hand.

## 0.4.0

Nothing here is backfilled. deevy reached v1 — milestones M0 through M4 — before it kept a changelog, and the
record of that is [docs/PLAN.md](./docs/PLAN.md), the per-milestone plans in [docs/plans](./docs/plans), the
decisions in [docs/adr](./docs/adr), and the git log. Only `v0.3.0` was ever tagged.
