The frame every Settings page uses: a `PageHeader` (title, one-line description, the page's action on the right), then `SettingsSection`s stacked with a 24px gap. A `SettingsSection` is one concern — a list, a form that adds, a danger zone — as a bordered `bg-card` panel with an optional `h2` and description; `tone="danger"` for what disconnects, suspends, revokes or archives. Inside a section, one setting is a `SettingsRow`: the label and a line on why on the left, the control on the right once the container is wide enough (`@lg:`); rows rule against one another instead of each getting a card. A Settings page lays itself out by its container, never by the window.

Destructive (`variant="destructive"`) is for what does not undo — Disconnect, Remove, Revoke, Archive. Suspend, Reinstate and Pause are `outline`: they reverse. Give a section an `aria-label` so it is a landmark.

```tsx
<SettingsPage title="Projects" actions={<Button>Bind a Project</Button>}>
  <SettingsSection title="Binding" aria-label="Binding">
    <SettingsRow
      label="Route by mention"
      hint="Mentioning an Agent on a record routes it to that Agent."
      htmlFor="mention"
    >
      <Switch id="mention" />
    </SettingsRow>
  </SettingsSection>
  <SettingsSection title="Suspend this Agent" tone="danger" aria-label="Suspend this Agent">
    <Button variant="outline">Suspend</Button>
  </SettingsSection>
</SettingsPage>
```
