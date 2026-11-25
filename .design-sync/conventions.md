# Building with deevy's design system

deevy is the glue between a team's tools and its Agents. The work stays in GitHub, Linear, GitLab or Notion; deevy routes each record there to an Agent, records the Agent's Runs, and holds the Gates only a Human may rule on. The UI has one memorable idea: **you can always tell who is a Human and who is an Agent, and what is waiting on a Human.** Everything else is quiet.

## Words

Use the vocabulary: Member, Human, Agent, Sponsor, Workspace, Socket (a connection to one tool), Project (bound to a container in a tool, such as `acme/deevy`), Issue (a record deevy projected; on screen "the record" or its key, `acme/deevy#412`), Run, Activity, Checkpoint, Gate, Proposal, Ruling, Event. Never "ticket", "task", "status", "user", "bot". Document, State, Workflow, Label and Team are not deevy's words: where a tool has them (a Linear state, a GitHub label) they are the tool's, said as the tool says them.

**deevy authors nothing about a record.** No screen creates, titles, describes, labels, comments on or moves a record; its key links out to where it lives, and what deevy adds — Runs, Gates, Links, Events — is what a screen shows beside it. The one thing a Human writes in deevy about work is a Ruling's note. Forms configure things: a Socket, a Project's binding, a Checkpoint, an Agent, an invitation, a webhook.

The screens are **Needs me** (the home page: Gates awaiting you, then your Agents' Runs), **Runs** (the one list deevy owns), **Work** (every record deevy projected, read-only), a Run, a Gate, a record, and **Settings** (Workspace: General, Members, Event log; Work: Sockets, Projects; Agents and delivery: Agents, Webhooks).

## Setup

- No provider is needed: components style themselves from `styles.css` (tokens on `:root`, fonts, every utility). Wrap `Sidebar*` in `SidebarProvider`; `Tooltip` needs its `TooltipTrigger` inside it. Theme is a class: add `dark` on `<html>` for dark mode; never a media query.
- Base UI, not Radix: a custom trigger takes `render={<a href="…" />}` (plus `nativeButton={false}` on a Button that renders a link), never `asChild`. Every `SelectItem` sits in a `SelectGroup`; a `DropdownMenuLabel` sits in a `DropdownMenuGroup`. Give a `SelectValue` a render function that names its value, or the trigger shows the raw value.
- Icons are `lucide-react`; inside a Button mark them `data-icon="inline-start"` / `"inline-end"`.

## Styling idiom: Tailwind utilities on the app's tokens

Style your own layout with Tailwind classes; never write CSS or inline colours. Colours are the semantic tokens only — `bg-background text-foreground`, `bg-card`, `bg-popover`, `bg-muted text-muted-foreground`, `bg-accent`, `text-destructive bg-destructive/10`, `border-border`, `ring-ring`, `bg-sidebar text-sidebar-foreground`.

Three saturated colours carry the idea, and nothing else on a screen is saturated:

- **Indigo is a Human and what a Human does**, as the logo's half-disc says. `bg-primary text-primary-foreground` is the fill (buttons, checks; the same indigo in both themes, white text on it); `text-link` is indigo text on the page (links, a pressed toggle, a Human's name) — never `text-primary` for text, which fails contrast on a dark page. `text-human` / `ring-human` / `bg-human/15` mark a Human.
- **Rose is an Agent**, the logo's bar: `text-agent` / `ring-agent` / `bg-agent/15`.
- **Amber is a Gate** and anything waiting on a ruling, the one warm colour so it jumps: `text-gate` / `border-gate` / `bg-gate/20`, with `text-gate-foreground` on an amber tint. A Gate's Checkpoint is `<Badge variant="outline" className="border-gate/50 text-gate-foreground dark:text-gate">plan</Badge>`; a Gate's card is `rounded-lg border border-gate/40 bg-gate/5`; the Gate's mark is a small rotated square, `size-2 rotate-45 rounded-[1px] bg-gate`.

`bg-state-backlog`, `bg-state-active`, `bg-state-done` (green: Finished, Approved) are for a Run's status. Opacity steps `/5 /10 /15 /20 /30 /40 /50` exist on all of these. The only other colours are the sign-in buttons' brands, inside `SignInButton`.

Type: Inter for the UI; `font-display` (Outfit) for titles only — a page's `h1`, a dialog's, a sheet's — never body, rows or section headings; `font-mono` (JetBrains Mono) for record keys, `@handles`, Event kinds (`gate.requested`), run ids, API keys, a secret shown once, shortcut hints. Sizes: `text-xs` (12px) for meta, badges and a rail's headings, `text-sm` (14px) for anything a person operates or reads in a row, `text-base` (16px) prose, `text-xl` (20px) a page title; `font-medium` / `font-semibold`; `tabular-nums` on times and counts ("1 of 2"). Spacing utilities (`gap-2`, `p-4`, `px-3`) use the app's unit (5% roomier than Tailwind's). Rows are `h-8` compact or `h-10` comfortable; the sidebar is `w-60` folding to `w-12`; radius is `rounded-md` (8px).

## Layout

- The frame is the sidebar (Needs me, Runs, Work, Settings at the foot, the Member's chip last; search on ⌘K at the top) and a page under a 44px top bar with a breadcrumb. A page's root is `flex flex-1 flex-col`.
- A list is an edge-to-edge `DataTable` under a `PageHeader` whose children are the filters. What is not a list is a bordered row (`rounded-lg border p-3`, `border-gate/40 bg-gate/5` for a Gate): a Gate or a Run on Needs me (a rail's rows are `rounded-md border p-2`). A Socket is a page of `SettingsSection`s.
- A page with a subject and its context — a Gate, a Run, a record — is `@container`, then `grid grid-cols-[minmax(0,1fr)] gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]`: the main column and a rail. Rail sections are named by `RailHeading`. Where the rail holds what a Human acts on (a Gate's ruling card, a Run's Gates) it comes first on a phone (`-order-1 @3xl:order-none`).
- A Settings page is `SettingsPage` › `SettingsSection`s (General is `SettingsRow`s instead, one setting a row, in a plain column), and lays itself out by its container (`@sm:` … `@3xl:`), never the window.
- Motion only in answer to an action. Nothing on load.

## Compose with the real pieces

- A Member is always `MemberChip` (round indigo ring = Human, square rose ring = Agent); `size="inline"` inside a sentence, `nameOnly` in a timeline. A Run's status is `RunStatus`; a shortcut hint is `Shortcut keys="mod+k"`; a secret field is `SecretInput`; deevy's name is `DeevyLogo`.
- A Gate says its arithmetic out loud ("1 of 2") and names its Checkpoint; ruling is Approve and Reject with an optional Note, and `⌘Enter` is the only submit key. An Agent never rules.
- A page starts with `PageHeader` (title, description, actions). An empty list is `Empty` whose words say what emptied it: "No Runs match your filters", "Nothing has arrived yet", "Nothing needs you".
- Toggling buttons are a `ToggleGroup variant="outline" spacing={0}`; buttons that act stand apart, each its own `Button` (a Gate's Approve and Reject are two `size="sm"` outline buttons, never joined and never one behind the other); a choice of what to show below is `Tabs`. Disconnect, Remove, Revoke, Archive are `variant="destructive"` (they do not undo); Suspend, Reinstate, Pause are `outline`.
- A Proposal, a record's body and a Run's Activity are `Markdown`, read-only. A Ruling's note, a Run's summary and everything else a Member wrote is plain text.
- Some of the kit no screen of deevy uses: `Alert`, `ButtonGroup`, `Card`, `Collapsible`, `InputGroup`, `Item`, `Popover`, `Resizable*`, `ScrollArea`, `Separator`, `Spinner`, `Toggle` alone, and `toast()` (the `Toaster` is mounted and nothing calls it). Their cards say nothing about deevy. Prefer what the screens use: a bordered row, a `SettingsSection`, a `Dialog`, a `Select` or `Combobox`, `Skeleton`s while a list loads, a refusal as `text-sm text-destructive` beside what was refused.

## Where the truth lives

Read `styles.css` and the `_ds_bundle.css` it imports for the compiled utilities and tokens; `components/<group>/<Name>/<Name>.prompt.md` for how each component is composed (with worked examples) and `<Name>.d.ts` for its props. Groups: Actions, Forms, Overlays, Navigation, Data display, Members and Runs, Pages, Brand.

## An idiomatic screen

```tsx
const { PageHeader, Button, DataTable, MemberChip, RunStatus, ToggleGroup, ToggleGroupItem } =
  window.Deevy;

<div className="flex min-h-svh flex-col gap-4 bg-background p-6 text-foreground">
  <PageHeader title="Runs" description="What your Agents have been doing.">
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
      <ToggleGroup variant="outline" spacing={0}>
        <ToggleGroupItem value="active">Working</ToggleGroupItem>
        <ToggleGroupItem value="completed">Finished</ToggleGroupItem>
      </ToggleGroup>
      <Button size="sm" variant="outline">
        Mine
      </Button>
    </div>
  </PageHeader>
  <DataTable
    aria-label="Runs"
    columns={[
      { id: "status", header: "Status", cell: (run) => <RunStatus status={run.status} /> },
      {
        id: "record",
        header: "Record",
        cell: (run) => <span className="font-mono text-xs">{run.record}</span>,
      },
      {
        id: "agent",
        header: "Agent",
        cell: (run) => <MemberChip member={run.agent} size="xs" />,
      },
      {
        id: "last",
        header: "Last",
        cell: (run) => <span className="truncate text-muted-foreground">{run.summary}</span>,
        className: "w-full max-w-0 min-w-0 overflow-hidden",
      },
      {
        id: "time",
        header: "Time",
        cell: (run) => (
          <span className="text-xs tabular-nums text-muted-foreground">{run.time}</span>
        ),
        className: "text-right whitespace-nowrap",
        headerClassName: "text-right",
      },
    ]}
    rows={runs}
    getRowId={(run) => run.id}
  />
</div>;
```
