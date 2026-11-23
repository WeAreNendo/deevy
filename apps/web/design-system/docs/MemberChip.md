A Member, drawn so nobody has to read to know which kind it is: a Human is a round avatar ringed in indigo, an Agent a square one ringed in rose, with a bot glyph when it has no picture. Its text is the Member's name, and its tooltip says "Human" or "Agent, sponsored by …". Use it wherever a Member appears: who a record is routed to, which Agent a Run is, who ruled on a Gate, a Sponsor. Never draw a Member as plain text with your own avatar.

- `size`: `inline` inside a sentence ("Planner asked for a ruling at plan"), `xs` in a table cell, `sm` (default) in rows and lists, `md` in a rail, `lg` as the title of a Member's own page.
- `nameOnly` for a timeline, where an avatar on every line is noise: an Agent's name still takes the rose.
- `showHandle` adds `@handle` in mono after the name where a name alone is ambiguous.
- `sponsorName` on an Agent goes into its tooltip.
- A suspended Member (`suspendedAt` set) renders dimmed; `avatarOnly` is for the folded sidebar.
- In a `Select`, list Members as their `user.name` text under a `SelectLabel` (Humans / Agents), not as chips.

```tsx
<MemberChip
  member={{ id: "mem_1", kind: "agent", handle: "planner", user: { name: "Planner", image: null } }}
  sponsorName="Ada Lovelace"
/>
```
