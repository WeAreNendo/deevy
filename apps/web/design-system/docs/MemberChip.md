A Member, drawn so nobody has to read to know which kind it is: a Human is a round avatar ringed in indigo, an Agent a square one ringed in rose, with a bot glyph when it has no picture. Its text is the Member's name. Use it wherever a Member appears in a row, a card, a comment or a rail: assignee, author, Sponsor, approver. Never draw a Member as plain text with your own avatar.

- `size`: `xs` inside a table cell or a chip in a picker, `sm` (default) in rows and comments, `md` in a rail or a header, `lg` on a Member's own page.
- `showHandle` adds `@handle` in mono after the name where a name alone is ambiguous (Settings › Members).
- `sponsorName` on an Agent goes into its tooltip ("Agent, sponsored by Ada Lovelace").
- A suspended Member (`suspendedAt` set) renders dimmed; `avatarOnly` is for the folded sidebar.
- In a `Select`, list Members as their `user.name` text under a `SelectLabel` (Humans / Agents), not as chips.

```tsx
<MemberChip
  member={{ id: "mem_1", kind: "agent", handle: "planner", user: { name: "Planner", image: null } }}
  sponsorName="Ada Lovelace"
/>
```
