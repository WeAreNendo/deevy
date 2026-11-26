The frame every Settings page uses: a `PageHeader` (title, one-line description, the page's action on the right), then `SettingsSection`s stacked with a 24px gap. A `SettingsSection` is one concern — a list, a form that adds, a danger zone — as a bordered `bg-card` panel with an optional `h2` and description; `tone="danger"` for what disconnects, suspends, revokes or archives. A page that is one setting after another, as General is, is `SettingsRow`s in a plain column instead: the label and a line on why on the left, the control on the right once the container is wide enough (`@lg:`); rows rule against one another instead of each getting a card, and sit in no section. A Settings page lays itself out by its container, never by the window.

Destructive (`variant="destructive"`) is for what does not undo — Disconnect, Remove, Revoke, Archive. Suspend, Reinstate and Pause are `outline`: they reverse. Give a section an `aria-label` so it is a landmark.

```tsx
<SettingsPage title={<MemberChip member={planner} size="lg" showHandle />}>
  <SettingsSection title="Projects" aria-label="Projects">
    …
  </SettingsSection>
  <SettingsSection title="Suspend this Agent" tone="danger" aria-label="Suspend this Agent">
    <Button variant="outline">Suspend</Button>
  </SettingsSection>
</SettingsPage>
```
