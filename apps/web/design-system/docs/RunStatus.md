A Run's status as a badge, in the words the app uses everywhere (`runStatusLabels`): Waiting to start (dashed), Working (the Agent's rose, with a dot), the wait at a Gate (amber, with a pulsing dot — the one thing on a screen that asks a Human to look), Finished (green), Failed (red), Gone quiet (muted). Use it in the Runs feed, on a Run's page, on Needs me, in a rail. Keep the default words: `label` overrides them, and no screen does.

```tsx
<RunStatus status="active" />
<RunStatus status="awaiting_input" />
```
