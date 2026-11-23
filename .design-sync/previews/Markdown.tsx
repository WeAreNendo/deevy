import { Markdown } from "@deevy/design-system";
import { proposal } from "./lib/fixtures";

const plan = `${proposal}

## Who it touches

| Operation | Today | After |
| --- | --- | --- |
| \`runs.list\` | \`offset\` | \`cursor\` |
| \`events.list\` | \`before\` | \`cursor\` |

- [x] the cursor encodes the last \`seq\`
- [ ] the SPA reads \`next\` instead of counting rows

See [ADR-0015](https://example.com/adr/0015) for why ids are not sequential.`;

/** A Proposal: headings, a list, code coloured by lowlight, a quote, a table, a task list. */
export const Proposal = () => <Markdown>{plan}</Markdown>;

/** A Ruling's note: short, a little inline code. */
export const RulingNote = () => (
  <div className="max-w-md rounded-md border bg-card px-3 py-2">
    <Markdown>{`Approved. Keep \`offset\` working for one release, and say so in the changeset — somebody's script pages by it.`}</Markdown>
  </div>
);

/** A record's body, as its tracker wrote it: a numbered list and emphasis, no headings. */
export const RecordBody = () => (
  <div className="max-w-md">
    <Markdown>{`Every list operation pages by offset, which skips rows when one arrives mid-read.

1. \`runs.list\` — the feed
2. \`events.list\` — the Event log
3. \`issues.list\` — Work

*Cursor* paging fixes all three at once.`}</Markdown>
  </div>
);
