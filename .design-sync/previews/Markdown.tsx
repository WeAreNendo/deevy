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

See [the design note](https://example.com/paging) for why the cursor is opaque.`;

/** A Proposal: headings, a list, code coloured by lowlight, a quote, a table, a task list. */
export const Proposal = () => <Markdown>{plan}</Markdown>;

/** A Run's Activities, each in its kind's tone: an action, a thought, a response, an error. */
export const Activities = () => (
  <ol className="flex max-w-md flex-col gap-2">
    <li className="flex flex-col gap-0.5 border-l-2 pl-3">
      <Markdown className="text-sm">
        {"Read the three list operations that still page by `offset`."}
      </Markdown>
      <span className="text-xs text-muted-foreground">14 minutes ago</span>
    </li>
    <li className="flex flex-col gap-0.5 border-l-2 pl-3">
      <Markdown className="text-sm text-muted-foreground italic">
        {"An offset skips a row whenever one arrives mid-page, so the cursor is the last `seq`."}
      </Markdown>
      <span className="text-xs text-muted-foreground">13 minutes ago</span>
    </li>
    <li className="flex flex-col gap-0.5 border-l-2 pl-3">
      <Markdown className="text-sm text-agent">
        {"One cursor fits all three, so the change is one shape."}
      </Markdown>
      <span className="text-xs text-muted-foreground">13 minutes ago</span>
    </li>
    <li className="flex flex-col gap-0.5 border-l-2 pl-3">
      <Markdown className="font-mono text-sm text-destructive">
        {"The test database refused the connection."}
      </Markdown>
      <span className="text-xs text-muted-foreground">12 minutes ago</span>
    </li>
  </ol>
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
