The top of every screen: the `h1` a page is named by (20px semibold, in the display face), one line on what it is for, and the actions that belong to the whole page on the right; children go in a row under the title (filters, a `ToggleGroup`, tabs). One per page, at the top of the page's flex column, above an edge-to-edge list.

```tsx
<PageHeader title="Runs" description="What your Agents have been doing.">
  <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
    <ToggleGroup variant="outline" spacing={0}>
      …
    </ToggleGroup>
    <Button size="sm" variant="outline">
      Mine
    </Button>
  </div>
</PageHeader>
```
