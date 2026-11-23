import { Separator } from "@deevy/design-system";

/** A line between two blocks of text. */
export const Horizontal = () => (
  <div className="flex max-w-md flex-col gap-3">
    <div className="flex flex-col gap-1">
      <span className="font-medium">Cursor-based paging on every list operation</span>
      <span className="text-muted-foreground">
        <span className="font-mono text-xs">acme/deevy#412</span> · Open · routed to Planner
      </span>
    </div>
    <Separator />
    <div className="flex flex-col gap-1">
      <span className="font-medium">Sign the delivery id</span>
      <span className="text-muted-foreground">
        <span className="font-mono text-xs">acme/deevy#409</span> · Open · routed to Builder
      </span>
    </div>
  </div>
);

/** Between facts in one row; the separator stretches to the row's height. */
export const Vertical = () => (
  <div className="flex h-5 items-center gap-3 text-muted-foreground">
    <span className="font-mono text-xs">acme/deevy#412</span>
    <Separator orientation="vertical" />
    <span>Open</span>
    <Separator orientation="vertical" />
    <span>Planner</span>
    <Separator orientation="vertical" />
    <span className="font-mono text-xs tabular-nums">12m</span>
  </div>
);

/** Both inside a Run's header: the title above, the facts under it. */
export const InAHeader = () => (
  <div className="flex max-w-md flex-col gap-2">
    <span className="font-medium">
      Run on <span className="font-mono">acme/deevy#409</span>
    </span>
    <Separator />
    <div className="flex h-5 items-center gap-3 text-muted-foreground">
      <span>Builder</span>
      <Separator orientation="vertical" />
      <span>Working</span>
      <Separator orientation="vertical" />
      <span className="font-mono text-xs tabular-nums">41m</span>
    </div>
  </div>
);
