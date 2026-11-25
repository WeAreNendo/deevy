import { MemberChip, runStatusLabels, Separator } from "@deevy/design-system";
import { activeRun, records } from "./lib/fixtures";

// No screen places one itself (a DropdownMenu, a Select and the sidebar have
// their own); a list rules its rows with `divide-y` or borders.

/** A line between two blocks of text. */
export const Horizontal = () => (
  <div className="flex max-w-md flex-col gap-3 text-sm">
    <div className="flex flex-col gap-1">
      <span className="font-medium">{records[0]!.title}</span>
      <span className="text-muted-foreground">
        <span className="font-mono text-xs">{records[0]!.key}</span> · changed {records[0]!.changed}
      </span>
    </div>
    <Separator />
    <div className="flex flex-col gap-1">
      <span className="font-medium">{records[1]!.title}</span>
      <span className="text-muted-foreground">
        <span className="font-mono text-xs">{records[1]!.key}</span> · changed {records[1]!.changed}
      </span>
    </div>
  </div>
);

/** Between facts in one row; the separator stretches to the row's height. */
export const Vertical = () => (
  <div className="flex h-5 items-center gap-3 text-sm text-muted-foreground">
    <span className="font-mono text-xs">{records[0]!.key}</span>
    <Separator orientation="vertical" />
    <span>{records[0]!.stateName}</span>
    <Separator orientation="vertical" />
    <span className="text-xs">{records[0]!.changed}</span>
  </div>
);

/** Both: a title above, its facts under it. */
export const InAHeader = () => (
  <div className="flex max-w-md flex-col gap-2 text-sm">
    <span className="font-mono font-medium">{activeRun.record}</span>
    <Separator />
    <div className="flex h-5 items-center gap-3 text-muted-foreground">
      <MemberChip member={activeRun.agent} size="inline" />
      <Separator orientation="vertical" />
      <span>{runStatusLabels[activeRun.status]}</span>
      <Separator orientation="vertical" />
      <span className="text-xs tabular-nums">{activeRun.time}</span>
    </div>
  </div>
);
