What Humans and Agents write, rendered from markdown: a Proposal on a Gate, a record's body as its tracker has it, an Activity of a Run. The typography is fixed (14px/24px, headings 20/16/14, links in `text-link`, code in mono on `bg-muted` coloured by lowlight, task lists, tables, blockquotes). Use it for those; never re-style prose by hand. A Ruling's note is plain text (`<p className="text-sm">`), and so is a Run's summary. It is read-only: deevy has no editor, because the record is the team's, in their tool.

```tsx
<Markdown>
  {
    "## Plan\n\nPage every list operation by an opaque cursor.\n\n- [ ] keep `offset` for one release"
  }
</Markdown>
```
