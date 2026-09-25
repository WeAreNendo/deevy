---
name: deevy-ui
description: How deevy's web UI (apps/web) is designed and built — the visual language for Humans, Agents and Gates, the navigation model, the screens the Sockets milestone left and what each is for, which shadcn registries are allowed and why, and the test contracts a screen must keep. Load before touching anything under apps/web/src or apps/web/tests.
---

# deevy UI

deevy is the glue between a team's tools and its Agents (CONTEXT.md): the work lives in GitHub, Linear,
GitLab or Notion, and deevy routes it, records the Runs, and holds the Gates a Human rules on. The UI's one
memorable idea: **you can always tell who is a Human and who is an Agent, and what is waiting on a Human.**
Everything else is quiet.

This skill records the decisions of the 2026-09 redesign (`docs/plans/ui-redesign.md`) that still hold, and
what the Sockets milestone (`docs/plans/sockets.md`) settled when it cut deevy's own tracker out: the Issues
home, the Board, the Issue page and its peek, Documents and their editor, the Workflow editor, Labels, Teams
and the groupings are gone, and so are the sections that described them — their history is in git and in the
plan documents. Read `shadcn` (component rules) and `frontend-design` (design process) beside it.

## Where things are

| You want                                 | Look at                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| tokens, type, both themes                | `apps/web/src/index.css`, `/dev/tokens` on a dev instance                                                      |
| the frame, sidebar, top bar, member menu | `routes/shell.tsx`, `components/app-breadcrumb.tsx`                                                            |
| ⌘K, shortcuts, `?`                       | `components/command-palette.tsx`, `lib/shortcuts.ts`, `components/shortcuts-sheet.tsx`                         |
| what needs a Human                       | `routes/home.tsx` (Needs me)                                                                                   |
| a list screen                            | `components/data-table.tsx`; `routes/runs/list.tsx`, `routes/work/list.tsx` with `components/work-filters.tsx` |
| a Run                                    | `routes/runs/run.tsx`, `components/run-status.tsx`                                                             |
| a Gate, and ruling on it                 | `routes/gates/gate.tsx`, `components/gate-controls.tsx`                                                        |
| a record deevy projected                 | `routes/work/item.tsx`, `components/item-events.tsx`                                                           |
| the Inbox                                | `routes/inbox.tsx`, `lib/notification-text.ts`                                                                 |
| a Settings page                          | `components/settings-page.tsx`, `routes/settings/*`, `settingsNav` in `routes/settings/layout.tsx`             |
| connecting a tool                        | `routes/settings/sockets.tsx`, `routes/settings/socket.tsx`, `components/connect-*.tsx`                        |
| a Project's binding and policy           | `routes/settings/projects.tsx`, `components/bind-project.tsx`, `project-binding.tsx`, `checkpoint-policy.tsx`  |
| a Human's linked accounts                | `routes/settings/identities.tsx`                                                                               |
| the chips and badges                     | `components/member-chip.tsx`, `run-status.tsx`, `kbd-hint.tsx`                                                 |
| how an Event or a Notification reads     | `lib/event-text.ts`, `lib/notification-text.ts`                                                                |
| markdown on screen                       | `components/markdown.tsx` (read-only)                                                                          |
| everything outside the shell             | `App.tsx` (`SignInFrame`, `DevSignIn`), `routes/consent.tsx`                                                   |
| the accessible names tests rely on       | "Test contracts", at the end                                                                                   |

## Ground rules

- Vocabulary is CONTEXT.md's, in code, copy and tests: Member, Human, Agent, Sponsor, Workspace, Socket,
  Project, Issue (a projection of a record in a tracker), Checkpoint, Gate, Proposal, Ruling, Identity, Run,
  Activity, Event, Notification, Channel. On screen a record is usually "the record" or its key, because
  that is what the team calls it where it lives. Never "ticket", "task", "status", "user", "bot"; and
  Document, State, Workflow, Label and Team are not deevy's words any more — where a tool has them (a Notion
  status, a GitHub label) they are the tool's, and said as the tool says them.
- **deevy authors nothing about a record.** No screen edits a title, a body, a label or a comment: the record
  is the team's, in their tool, and a field that pretended otherwise would be a second place to write the
  same sentence. A record's key links out to where it lives; what deevy adds — Runs, Gates, Links, Events —
  is what a screen shows beside it. The one thing a Human writes in deevy about work is a Ruling's note.
- **Base UI, not Radix.** `apps/web/components.json` is `"style": "base-mira"`. Custom triggers use
  `render={<Link … />}` (and `nativeButton={false}` on a Button that renders an anchor — without it Base
  UI warns on every render, which is what CI's stderr shows), never `asChild`. `nativeButton={false}`
  gives the anchor a button role, so navigation a test finds as a `link` (the not-found page's ways out, the
  Notion dialog's "Open the Socket's page") is a `<Link className={buttonVariants(…)}>` instead: a real
  link dressed as a button. Nothing under `apps/web` may import `@radix-ui/*`.
- Work from `apps/web` so the `shadcn` skill's `shadcn info` finds `components.json`. Add components with
  `pnpm dlx shadcn@latest add <item> --overwrite`; it rewrites `pnpm-workspace.yaml` and pins versions, so
  move new dependencies to the catalog and restore the file's comments.
- **Markdown is read, not edited.** A Proposal, a record's body and a page of a Project's documents are
  markdown, written by an Agent or by the team in their tool, and `components/markdown.tsx` renders them.
  There is no editor in the app.
- **Leaving deevy for a tool's own page** — a consent page, an install page — goes through `leaveFor` in
  `lib/leave.ts`, so a test can say where the app would have gone without jsdom trying to go there.
- Every screen is verified in the browser through a stubbed instance (below), in both themes.

## Running the app without an OAuth App or a tool

`DEEVY_DEV_STUB_OAUTH=1` makes the Node server import `apps/web/scripts/stub-oauth.js` — the same stub the
acceptance walk and the Workers smoke prepend to their bundles — so the OAuth `code` is the email address and
the signed-out page offers "Sign in as this email". It stands in for the client pairs too, so an environment
that configures no provider still offers all four buttons: GitHub, Google, GitLab and one generic OpenID
Connect entry. `DEEVY_DEV_STUB_SOCKETS=1` registers the Socket provider that is not a tool — a tracker and a
forge in the process, `packages/sockets/src/stub` — so records arrive, route and open Runs with no App, no
tunnel and no network. Both are refused under `NODE_ENV=production`; the Worker never has the first.
`health.ping` reports `devSignIn` and `devSockets`, which is how the SPA knows.

Two launch configurations in `.claude/launch.json` put that together:

- **`dev:stub`** runs the dev servers with both flags on and its own database file, for working on the SPA
  with hot reload. Fill it with `DEEVY_DATABASE_PATH=./data/stub.sqlite vp run server#seed`.
- **`seeded`** serves the built bundle and SPA on one port with a clean environment — nothing from `.env`,
  every identity at example.com — and reseeds every time it starts. Use it whenever the checkout's `.env`
  carries a real address or a real client pair, and for screenshots. Build first (`vp run -r build`).

The seed (`apps/server/src/seed.ts`) signs in `ada@example.com` (the admin), `grace@example.com` and
`omar@example.com` through the stub, connects a stub Socket, creates the Agents Planner and Builder, binds two
Projects, projects thirty-odd records, and leaves Runs in every status, Gates open and ruled — in deevy and
`via: socket` — Links, a Slack Channel, routing and a webhook, all through the operations, so the Inbox and
the Event log fill themselves. Sign in as any of the three with the dev form.

## Registries

Two hard constraints on anything added from a registry: **an open-source licence with no licence key**, and
**no `@radix-ui/*` import**. Run `pnpm dlx shadcn@latest view <item>` before `add` and read the imports.
Verified 2026-09-05; nothing outside `components/ui` is vendored today, since the board's kanban and sortable
went with the board.

| Namespace                                                          | Licence                 | Use                                                                                             | Do not use                                              |
| ------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `@shadcn`                                                          | MIT                     | everything in `components/ui`; blocks `sidebar-07`, `sidebar-08`, `login-04` as starting points | —                                                       |
| `@reui`                                                            | MIT (free items)        | its `/r/{style}/{name}` URL returns the Base UI build for our style                             | anything with a Pro badge; never set `REUI_LICENSE_KEY` |
| `@kibo-ui`                                                         | MIT                     | compose our `ui/*`                                                                              | `relative-time` (Radix)                                 |
| `@diceui`                                                          | MIT                     | —                                                                                               | anything importing `radix-ui`                           |
| `@coss`                                                            | MIT for `apps/ui` items | pattern references                                                                              | as our theme                                            |
| Origin UI, Magic UI, Cult UI, Animate UI, Aceternity, shadcnblocks | mixed                   | —                                                                                               | Radix or off-brief                                      |

Every adopted file starts with a comment naming the registry, item, date and licence, and lives under
`components/<registry>/`, never `ui/`, so a re-add cannot clobber shadcn's own. New npm dependencies go
through the catalog.

## Design language (the tokens in `apps/web/src/index.css`)

- **Type.** Inter (variable, `@fontsource-variable/inter`) for UI; JetBrains Mono
  (`@fontsource-variable/jetbrains-mono`) for record keys, `@handles`, Event kinds, run ids, API keys,
  addresses and secrets shown once, seqs, shortcut hints. Self-hosted; no Google Fonts. Scale 12 / 13 / 14 /
  16 / 20 / 28; tabular numerals on keys and times. Rows 32px compact, 40px comfortable; sidebar rows 28px;
  radius 8px (`--radius: 0.5rem`); the spacing unit is `--density: 0.2625rem`, 5% roomier than Tailwind's
  default — every spacing utility multiplies it. The families, radius, density and `--tracking` are
  variables `@theme inline` hands to the utilities, so a palette review retunes them from one block.
- **Color slots.** `--human` (sky blue) for a Human Member; `--agent` (rose) for an Agent; `--gate` (amber)
  for a Gate and anything waiting on a ruling; `--state-backlog|active|done` for a Run's status;
  `--primary` (indigo) for the one action colour; cool blue-gray paper and ink — the base is tweakcn's
  _clean-slate_ preset (Apache-2.0), picked by Matt. Those three saturated slots are the only saturated
  colours on a screen besides `--primary` and `--destructive`: sky & rose as indigo's neighbours, amber the one
  warm colour, so a Gate jumps. Both themes; a real System/Light/Dark toggle in the Member menu.
- **Layout.** Full-bleed frame, 240px sidebar collapsing to 48px, edge-to-edge lists with a 40px filter bar.
  A page with a subject and its context — a Gate, a Run, a record — is a main column and an 18–22rem rail,
  one column under `@3xl`. Where the rail holds what a Human acts on (a Gate's ruling card, a Run's Gates) it
  comes first on a phone (`-order-1 @3xl:order-none`) and sits beside the subject above it; a record's rail
  comes after. Cards only for things that are cards (a Gate on Needs me, a
  Channel, a Socket's section).
- **Motion** only in answer to an action. Nothing on load.

## Navigation and keyboard

Primary sidebar: **Needs me** (`/`) · **Inbox** (the only badge) · **Runs** · **Work** · Settings (its own
area with its own sidebar: Workspace / Work / Agents and delivery / You) · the Member's chip, with search
(⌘K) at the top. `⌘K` palette (Go to, Settings, Help); `?` shortcuts; `g i` Inbox, `g r` Runs, `g w` Work,
`g p` Projects, `g s` Settings; `j`/`k`/arrows/`Enter`/`o`/`Esc` in lists; in the Inbox `e` marks read, `⇧E`
marks all read, `x` picks a row, `o` opens the record where it lives; on a Gate `⇧A`/`⇧R` choose a ruling
and put the cursor in the Note, and `⌘Enter` — the only submit key — commits it. `src/lib/shortcuts.ts` owns a
scope stack: an open Sheet, Dialog or palette owns the keys.

## What the redesign settled that still holds

- **Sizes live in `components/ui`.** shadcn's `base-mira` is the compact style — 12px controls, 10px badges
  and kbd, 28px buttons. deevy resizes those files (button, input, textarea, select, label, table, badge,
  kbd, sidebar, dropdown-menu, command, dialog) to a 14px control size with 32px heights, drops
  `CommandDialog`'s `top-1/3 translate-y-0` so the palette keeps `DialogContent`'s own centring, hides
  `CommandItem`'s unchecked tick instead of leaving it at `opacity-0` (two `ml-auto`s in one row split the free
  space), strips `avatar`'s inner `after:` border since the kind ring (`MemberChip`) is the avatar's one edge,
  and paints fields `bg-card` in light — base-mira's `bg-input/20` read as disabled — with `disabled:bg-muted`
  now meaning it; dark keeps `bg-input/30`. Scale: `text-xs` 12px for meta and badges, `text-sm` 14px for
  everything a person operates or reads in a row, `text-base` 16px for prose, `text-xl` 20px for a page
  title. A `shadcn add --overwrite` of one of those files brings the compact sizes back — re-apply them.
- **Theme is a class.** `next-themes` (`attribute="class"`, system default) sets `.dark` on `<html>`; tokens
  live on `:root` and `.dark`, never in a media query.
- **Shortcuts** go through `src/lib/shortcuts.ts` — `useShortcut("g i", …)`, `useShortcut("mod+k", …,
{ global: true })`, `useShortcutScope(name, active)` on anything modal — never a raw `keydown` listener.
  Plain letters are ignored while typing; `mod+…` is not. `Shortcut keys="…"` (`kbd-hint.tsx`) draws one; the
  hints are `aria-hidden` (`data-slot="shortcut"`), so a hint inside a button never joins its accessible name.
  **The keyboard map is data in `components/shortcuts-sheet.tsx`**, shown by `?` and by the palette's Help
  group; add a shortcut there when you add one to the app.
- **Navigation.** The Settings area's nav is `settingsNav` in `routes/settings/layout.tsx`, shared with the
  palette so a page has one name everywhere. Settings routes are children of the `/settings` layout route,
  each declared with a literal path: a helper that takes `path: string` erases the literal and every typed
  `to` in the app stops compiling. **The top bar carries a breadcrumb** (`crumbsFor(pathname, …)`, pure): a
  new route gets a case there.
- **Palette.** `components/command-palette.tsx` on `ui/command`. cmdk depends on `@radix-ui/react-dialog` —
  the one sanctioned transitive Radix dependency, because it is what shadcn ships for Base UI projects too;
  nothing under `apps/web/src` imports Radix directly. cmdk names its input from `<Command label>`.
- **An empty list is an `Empty`, centred in the room the page leaves** (`Empty › EmptyHeader › EmptyMedia
variant="icon" + EmptyTitle + EmptyDescription`, a lucide icon that says what is missing). Height flows
  down so the `flex-1` Empty centres: every page root is `flex flex-1 flex-col`. `DataTable` takes `empty={{
icon, title, description, action? }}`. **The words say what emptied the list**: under a filter "No records
  match your filters" with a Clear filters button, never "No records yet"; the Inbox's Unread filter says
  "Nothing unread"; Needs me with nothing waiting says "Nothing needs you". Inline notes inside a section stay `<p>`.
- **Nowhere is a page.** `routes/not-found.tsx` is the root route's `notFoundComponent` and what a Run, a
  Gate, a record or a Socket renders when the API says `NOT_FOUND` (`isNotFound`, which the QueryClient also
  uses to skip retries): `h1` "There is nothing here" or "There is no <what>", then Go back / Home / Inbox.
- **Grouped buttons.** `ToggleGroup` for buttons that toggle a state (Inbox All/Unread, the Runs feed's
  statuses), `ButtonGroup` for actions, `Tabs` for views of one thing (the coding agents in `ConnectAgent`).
  Joined ToggleGroups are `variant="outline" spacing={0}`; a pressed Toggle is `bg-primary/10 text-primary`
  with a `border-primary/30` edge. Their corners and half the kit's `data-*` styling depend on `@import
"shadcn/tailwind.css"` in `index.css`; without it the kit silently degrades.
- **Selects are shadcn's, never native**, composed directly from `ui/select`: `Select` › `SelectTrigger` +
  `SelectValue`, then `SelectContent` › `SelectGroup` › `SelectItem`, with `SelectLabel` on a group that has a
  heading and `SelectSeparator` between a "none" item (Nobody, Nowhere deevy reads, Any) and the real
  choices. Every item sits in a group, which carries the padding. Base UI wants a real value for "none", so a
  page keeps a sentinel constant (`"__nobody"`, `"__nowhere"`), never `""`. **A `SelectValue` is given a render
  function naming what its value is** — `{(selected) => nameOf(selected)}` — because Base UI's trigger
  otherwise shows the raw value: a Member id and `gates` were on the Project settings until 2026-09-24, and
  a Socket's id in **Bind a Project** until the GitHub walk. A Member in a select is `user.name` as text; the
  kind comes from the group's label, never from a chip. `ui/select`'s popup is at least as wide as its
  trigger and grows to fit its items (`w-max min-w-(--anchor-width) max-w-(--available-width)`), because a
  short trigger clipped a Socket's name; re-apply it after a `shadcn add --overwrite` of the file.
- **A secret is typed into `SecretInput`** (`components/secret-input.tsx`): masked, `autoComplete="off"`,
  and marked for 1Password, LastPass, Bitwarden and Dashlane to leave alone — a token an admin pastes from a
  tool is not their password, and a manager that saves or fills one is wrong both ways. Every connect dialog
  showed its secrets in the clear until the Linear check. A PEM in a `Textarea` stays a `Textarea`.
- **A list says it is empty only once the server has said so.** Gate the empty sentence on `isSuccess`, not
  on `data ?? []`: the Sockets page told a deevy built with five tools it had none, for as long as the list
  took to arrive.
- **A stored value is never a sentence.** A Run's trigger reads through `lib/run-trigger.ts` ("started when
  its sub-issues finished"), a breadcrumb names a Socket by its name and a record by its tracker's key, and a
  routed assignment a page cannot name still says "routed it to an Agent", never "unassigned it".
- **Destructive is for what does not undo.** Disconnect, Remove, Revoke, Archive are `variant="destructive"`.
  Suspend, Reinstate, Pause and Unlink are `outline`: they reverse. Reject is a ruling, not a deletion, and
  keeps the ruling's own styling.
- **Base UI menus and switches.** A `DropdownMenuLabel` must sit inside a `DropdownMenuGroup` or the menu
  throws when it opens. Make a menu's trigger the DOM button itself (`DropdownMenuTrigger
className={sidebarMenuButtonVariants(...)}`), not `render={<SidebarMenuButton/>}`. A `Switch` inside a
  `<label>` is named by that label — Base UI points `aria-labelledby` at it — so it takes no `aria-label` of
  its own, which would name it twice.
- **Layout facts.** shadcn's `SidebarInset` _is_ the `<main>` landmark — a page never renders another; it
  carries `min-w-0` (a deevy edit) so a wide page shrinks rather than pushing the app sideways. Under 768px
  the sidebar is a Sheet behind the trigger; review screens at ≥1280px. **The frame is the viewport's height
  and the page area is what scrolls** (`h-svh overflow-hidden` on the sidebar wrapper, `overflow-y-auto`
  around the `Outlet`), so `h-full` means it. A page that lays out its own panes (the Inbox) declares
  `staticData: { bleed: true }` and the shell adds no padding. **A dialog that can be taller than a laptop
  screen scrolls inside the window** (`max-h-[calc(100dvh-2rem)] overflow-y-auto`, as the connect dialogs do).
- **Live updates.** `lib/live.ts` maps an Event's `subjectType` to the query keys it may have changed
  (`keysFor`) and coalesces invalidations per 16ms; mutations invalidate by key, never
  `invalidateQueries()` bare. `QueryClient` has `staleTime: 5_000`.
- **Search values are strings, both ways.** `router.tsx` gives the router a `parseSearch`/`stringifySearch`
  pair on `URLSearchParams`; every `parse*Search` still tolerates a number. **Filters live in the URL**, so a
  view is a link and Back undoes a filter, and every filter is the server's.
- **`components/data-table.tsx`** is hand-rolled on `ui/table`: client sort per column, skeleton, `Empty`,
  `aria-selected` on the keyboard row; a row's accessible name is its text and it opens on click (`onOpen`).
  Clip any cell that mixes text with chips (`min-w-0 overflow-hidden`; a `max-w-0` cell does not clip alone).
- **Mobile is read-and-rule, and it falls out of the containers.** The sidebar is a Sheet below 768px, the
  Inbox folds to one pane below 1024px, a page with a rail stacks under `@3xl`. A new screen gets the same by
  using the same containers; check it at 390px with `scrollWidth === innerWidth`.
- **Wording lives in `lib/event-text.ts` and `lib/notification-text.ts`.** A screen never phrases an Event
  itself; a new Event kind gets a case in `describeEvent` (with a unit test) and new payload fields carry
  names beside ids so the log reads without lookups.
- **A rail section is named by `RailHeading`** (12px, medium, muted — metadata size). **A chip inside a
  sentence is `size="inline"`**; a timeline shows names without avatars (`nameOnly`), with an Agent's in the
  Agent colour. **A row of `items-baseline` wants children that have a baseline**: an icon that belongs in a
  line of text goes _in_ the line (`inline size-3.5 align-[-0.1875em]`), not in a flex box beside it.
- **Forms save themselves** where a change is one field (`lib/autosave.ts`: a `role="status"` line, Saving ·
  Saved · error + Retry; a Project's binding saves each choice as it is made). The Checkpoint policy is the
  exception — a policy about who may approve what saves whole, with **Save policy**, because "I was still
  typing" must not become the rule.
- **Settings.** `SettingsPage` (the h1, a description, the page's action) and `SettingsSection` (a card with
  an optional title and description, `aria-label` for a landmark, `tone="danger"` for what disconnects,
  suspends, revokes or archives). `SettingsRow` is one setting. **A Settings page lays itself out by its
  container, never by the window** (`@sm:`…`@3xl:`). **The Settings nav appears at `lg`**; below it the whole
  navigation is one Select (`combobox "Settings page"`). Settings leaves the primary sidebar alone. **A label
  element beats an `aria-label`** where a control can have a visible one.
- **The Event log** (`routes/settings/events.tsx`) reads `events.list` with `order: "desc"`, pages back with
  `before`, filters by Project and subject on the server and by kind prefix on the page, shows a row's
  payload as JSON when clicked, reads at 12px and names its actors rather than drawing them.
- **Everything outside the shell** (`SignedOut`, `NotAMember`, `Suspended`) renders in `SignInFrame`. **The
  sign-in buttons are `health.ping`'s `providers`**, one per entry in the order the server sent (`Sign in
with <label>`); a provider is added by configuring one, never by editing `App.tsx`. The dev form stays
  under them only when `health.ping` reports `devSignIn`. **An invitation link is answered outside the
  router**: `/invite/<token>` is held in `sessionStorage` (`lib/invitation.ts`) and spent by `NotAMember`.
- **Live regions:** the Gate banner on a focused ruling card and a Run's "Needs your answer" band are
  `role="status"`; nothing else announces without a reason. **Tests drive Base UI popups with keys**:
  `ArrowDown` opens a Select or Combobox in jsdom, `Enter` on the highlighted option chooses, `Escape`
  closes — and while one is open the rest of the page is inert.
- **`ui/*` hygiene:** a `ui/*` file may sit unimported (it is the kit), but a dependency only an unimported
  file needs goes with the file.
- **jsdom stubs** live in `tests/setup.ts`: `matchMedia`, `ResizeObserver`, `scrollTo`,
  `Element.prototype.scrollIntoView` (cmdk needs it).
- **Screenshots** come from `vp run web#screens` (`apps/web/scripts/screens.ts`) against the `seeded`
  instance, into `docs/screens/`; regenerate them at a milestone.

## What the Sockets milestone settled (2026-09-19 to 2026-09-24)

- **Needs me is the home page** (`routes/home.tsx`, `region "Needs me"`), in the order things block
  somebody: `region "Gates awaiting you"` (a card per Gate — the record's key, the Checkpoint, the Agent, how
  long it has waited, a link into the ruling), `region "Runs awaiting your answer"`, then `region "Your Agents'
Runs"`. It is not a list of work: the work is in the tools.
- **The Runs feed** (`/runs`) is the one list deevy owns, because a Run is deevy's record and the tracker has
  none of it: flat, newest first, `group "Filters"` with the statuses as a ToggleGroup, filters in the URL.
- **A Run** (`/runs/$runId`) is its feed in time order (`ol "Activity of <run id>"`, an item per Activity,
  toned by kind — the Agent's voice, a Human's, an error) with the Gates it asked for in the rail (`list
"Gates"`), because a Gate is where a Run stops and the only thing on that page a Human acts on.
- **A Gate** (`/gates/$requestId`) is the one link an Agent hands a Human, so it answers four things at a
  glance: what is proposed (`region "Proposal"`, the markdown), which record (its key, linking out), where
  the count stands, and whether this Human may rule. The rail holds the ruling card on top, then `list "Gate
decisions"` — each saying where it was made: "in deevy", "in Slack", "via GitHub", with "(email)" where an
  address vouched for the Human — then "The Run that stopped here". The card is focused while the Gate is
  open, on its own page and in the Inbox's preview alike.
- **`components/gate-controls.tsx` is the only place a ruling is made in deevy.** It says the arithmetic
  out loud ("1 of 2"), and says why it will not take this Human's ruling before they click — the reason is
  the server's own (`gates.get`), so the disabled button and the refusal behind it can never disagree.
  `group "<Checkpoint> Gate"` with `data-focused`, a `Note`, `Approve` and `Reject`; `⇧A`/`⇧R` choose and
  `⌘↵` commits, and nothing commits on a key alone.
- **Work is read-only** (`/work`, `table "Work"`): every record deevy projected, filtered in the URL by
  words, Project, open or closed, and who it is routed to; the key on every row goes back to where the record
  is. **A record** (`/work/$issueId`) is `region "What the record says"` (the tracker's words, rendered), then
  Runs, Gates and Links (`list "Runs"`, `list "Gates"`, `list "Links"`) and what happened (`list "Events"`,
  `components/item-events.tsx`), and a link to read the conversation where it is. Nothing on it is editable,
  and that is the design rather than a gap.
- **The Inbox** is one flat two-line list (`list "Notifications"`), a checkbox per row and a `toolbar
"Selection"` to mark several read; above 1024px the selected row opens beside it — the Gate page when the
  Notification asks for a ruling, the record otherwise — and below it one pane.
- **Connecting a tool is a dialog per provider** (`components/connect-github.tsx`, `-gitlab`, `-linear`,
  `-notion`, `-slack`), opened from `group "Connect a tool"`, whose buttons are `sockets.providers` — what
  this build can speak, the stub left out. Where the tool wants deevy's addresses written into its own
  settings, the Socket is started first (`sockets.begin`) and the dialog shows them with their real values;
  a secret is shown once, in mono, and said to be shown once.
- **A Socket's page** (`routes/settings/socket.tsx`) answers what an operator actually asks: is the tool
  talking to deevy or is deevy asking it (`How it is doing`), where it delivers (`region "Where it delivers"`,
  with **Point GitHub at this address** for an App), what it signs with, and what it has said lately
  (`table "Deliveries"`). A section that only one tool has — Notion's `region "Verifying the webhook"` and
  "Who commented", Linear's "Assigning issues to deevy", GitHub's "Where it is installed" with a link to
  install the App on more repositories — keys off `socket.provider`; what a tool _can_ do is the server's to
  say wherever it decides anything.
- **A Project is a binding** (`routes/settings/projects.tsx`): **Bind a Project** picks a tool, a container
  the tool itself offers, and a name — never a field somebody types, because a typo there is a Project bound
  to nothing — and, for a tool that holds code, binds the same container as its code unless **Its code is
  here too** is unticked. Its `region "Binding"` states the tracker and will not move it, and sets the Default
  Agent (which grants that Agent the Project), the routing label, the Mirror, the **Repository** and **Base
  branch** its code is in, and **Documents** — where its plans live, for an Agent's `docs_get`. `region
"Checkpoints"` is the policy (`checkpoint-policy.tsx`).
- **A Run that did not finish can be tried again.** A failed or stale Run's page offers **Try again**
  (`runs.retry`) in its header and goes to the fresh Run; the server decides who may, and a refusal shows in
  its own words under the button.
- **Identities** (`routes/settings/identities.tsx`) lists the accounts that rule as this Human, how deevy
  knows each, and lets them unlink one and link it again; a Slack code is checked before it links
  (**Check the code**, then **Link @x to me**), and a tool with a consent page of its own (Linear) is **Link
  <tool>**. The page reads `?linked=` and `?linkError=` off the URL a tool's callback sends the browser back
  to.
- **Channels** add a room in a connected Slack app beside the incoming-webhook kind, and **Notifications**
  has a Direct message column for a Human whose Slack account is linked.

## Test contracts

Tests in `apps/web/tests` query by role and accessible name, mock `lib/orpc` with `tests/stub-client.ts`
(shallow merge per namespace; a test overrides only the operations it asserts on), mount routes with
`mountAt(path, { memberName })` from `tests/mount.tsx`, drive a Select with `pickOption` and read it with
`selectedLabel` from `tests/select.ts`, and replace `lib/leave.ts` where a screen leaves for a tool's page.
The names a screen keeps unless a change says otherwise:

- **The frame.** `navigation "breadcrumb"`; links `Needs me`, `Inbox` (with its count), `Runs`, `Work`,
  `Settings`; `menuitemradio "Dark"` and `menuitem "Sign out"` in the Member menu; `heading "Keyboard"` on the
  shortcuts sheet and `option "Keyboard shortcuts"` in the palette; `heading "There is nothing here"` with
  `Go back`.
- **Signed out.** `Sign in with <provider>` per provider; `form "Development sign-in"`, `Sign in as this
email`; `Sign out and try another account` for somebody who is not a Member.
- **Needs me.** `region "Needs me"`, `region "Gates awaiting you"` with a link per Gate, `region "Runs
awaiting your answer"`, `region "Your Agents' Runs"`.
- **Runs.** `table "Runs"` with a row per Run, `group "Filters"`; on a Run `ol "Activity of <run id>"` and
  `list "Gates"`, `heading` named by the record, and `Try again` on a failed or stale one.
- **A Gate.** `region "Proposal"` with the Proposal's own headings; `group "<Checkpoint> Gate"` with
  `data-focused`; `Note`, `Approve`, `Reject`; `list "Gate decisions"`; a link to the record by its key.
- **Work.** `table "Work"`, the filters by label; on a record `region "What the record says"`, `list "Runs"`,
  `list "Gates"`, `list "Links"`, `list "Events"`, link `Read the conversation on <tool>`.
- **Inbox.** `heading "Inbox"`, `list "Notifications"`, `checkbox "Select <what it says>"`, `toolbar
"Selection"`, `Mark read`, `Mark all read`, the All / Unread toggles.
- **Sockets.** `heading "Sockets"`, `list "Sockets"`, `group "Connect a tool"` with `Connect <tool>`;
  GitHub's `form "Create the App on GitHub"` and `Paste an App you already have`; Slack's `Show the app
manifest` and `App manifest`; Linear's `Show the addresses`, `Callback URLs`, `Client ID`, `Client secret`,
  `Webhook signing secret`, `Install deevy as an agent`; GitLab's `GitLab URL`, `Access token`, `Signing
token`, `Use the signing token`; Notion's `Internal integration secret` and link `Open the Socket's page`;
  `Connect`, `Done`; every secret field is `type="password"` with `autocomplete="off"`. On a Socket's page: its name as `heading`, `region "Where it delivers"` with `Point GitHub
at this address`, `region "Where it is installed"` with link `Install it` or `Install it on more
repositories`, `Pause`, `Mint a webhook secret`, `region "Verifying the webhook"` with `Show the token`,
  `switch "Take a verified address as proof"`, `table "Deliveries"`, `Disconnect` then `Disconnect it`.
- **Projects.** `Bind a Project` opening `dialog "Bind a Project"` with `combobox "Tool"`, `combobox
"Container"`, `checkbox "Its code is here too…"`, `Name`, `Bind it`; `region "Binding"` with `combobox
"Default Agent"`, `Routing label`, `combobox "Mirror"`, `combobox "Repository"`, `Base branch`, `combobox
"Documents"`; `region "Checkpoints"` with `Add a Checkpoint`, `Name`,
  `Approvals`, `checkbox "Not the Human the work is for"`, who may rule, `Save policy`.
- **Identities.** `heading "Identities"`, `table "Identities"`, `Unlink @<login>`, `Link @<login> again`;
  `Code from Slack`, `Check the code`, `Link @<login> to me`; `region "Link an account"` with `Link
<provider>`.
- **Settings elsewhere.** The settings h1s (`Workspace`, `Members`, `Event log`, …); `navigation "Settings"`
  and, below `lg`, `combobox "Settings page"` (whose classes the shell test asserts as `lg:hidden` /
  `lg:flex`); `Who may join`, `Add rule`, `Stop allowing <value>`; `Invite someone`, `Create invitation`,
  `Revoke the invitation for <address>`; `New Agent`, `region "Projects"`, `region "API keys"`, `region
"Connect an Agent"` with `tablist "Coding agent"`, `Generate`, `Revoke`, `Suspend`, `Reinstate`, `heading
"Recent Runs"`; `Add Channel`, `form "Add a Slack room"`, `Add room`, `Test`, `Save routing`; `Subscribe`,
  `Deliveries`, `Redeliver`; `table "Event log"`.
