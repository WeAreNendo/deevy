A keyboard shortcut drawn beside the thing it triggers, in `Kbd` keys: `mod+k` is one combination (⌘ K on a Mac, Ctrl K elsewhere), `g r` a chord of two keys in sequence ("G then R"). It is decoration (`aria-hidden`), so put it beside a label, never instead of one: in a sidebar row, a menu item's trailing slot, a tooltip, a palette row, the shortcuts sheet. The app's keys: `mod+k` the palette, `?` the shortcuts, `g r` Runs, `g w` Work, `g p` Projects, `g s` Settings, `j`/`k` in lists, `shift+a`/`shift+r` to choose a ruling on a Gate and `mod+enter`, the only submit key, to commit it.

```tsx
<Button variant="outline">Search <Shortcut keys="mod+k" /></Button>
<Shortcut keys="g r" />
```
