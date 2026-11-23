The list every screen with a list is built on: a plain table with a sticky header, columns that sort when they have a `sortValue`, group rows that fold, a skeleton while `loading`, and an `Empty` when there is nothing. Rows are 32px (`compact`, default) or 40px (`comfortable`); a row opens on click or Enter (`onOpen`), and `selectedId` is the row the keyboard is on. Render it edge-to-edge under a `PageHeader` whose children are the filters, never inside a Card.

- The one column that gives way is `w-full max-w-0 min-w-0 overflow-hidden` (a title, the Agent's last words); a narrow column of numbers is `whitespace-nowrap`, times are `tabular-nums`.
- The Runs feed's columns: Status (`RunStatus`), Record (the key in mono), Agent (`MemberChip size="xs"`), Last (what the Agent last said, muted, the one that gives), Time (working time, right-aligned), Last activity.
- Work's columns: Key (mono, linking out to the tracker, with an external-link icon), Title, State (the tracker's own word in an outline `Badge`), Routed to (`MemberChip size="xs"` or "Nobody"), Gate (the Checkpoint in an amber outline `Badge`), Changed.
- The empty state's words say what emptied the list: "No Runs match your filters", "Nothing matches your filters" with a Clear filters action, "Nothing has arrived yet" before any tool has spoken.

```tsx
<DataTable
  aria-label="Runs"
  columns={columns}
  rows={runs}
  getRowId={(row) => row.id}
  onOpen={openRun}
  empty={{
    icon: PlayCircle,
    title: "No Runs match your filters",
    description: "A Run starts when a record is routed to an Agent, or when one is mentioned.",
  }}
/>
```
