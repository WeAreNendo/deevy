// The stories for ScrollArea and its parts. Kept under lib/ with a non-component
// file name: a sibling named like an export is shimmed to the package by the
// story-imports plugin, so `export * from "./ScrollArea"` would re-export all of it.
import { ScrollArea, ScrollBar } from "@deevy/design-system";

// No screen uses ScrollArea: the page area scrolls, and a strip that can be
// wider than its room takes `scrollbar-thin overflow-x-auto`. So the rows are
// only rows.
const numbers = Array.from({ length: 12 }, (_, index) => index + 1);

/** A list taller than its frame: the scrollbar is the thumb in `border` on the right. */
export const Vertical = () => (
  <ScrollArea className="h-48 w-full max-w-sm rounded-md border bg-card">
    <ul className="flex flex-col divide-y">
      {numbers.map((number) => (
        <li key={number} className="px-3 py-2 text-sm tabular-nums">
          Row {number}
        </li>
      ))}
    </ul>
  </ScrollArea>
);

/** A row wider than its frame, with the horizontal ScrollBar along the bottom. */
export const Horizontal = () => (
  <ScrollArea className="w-full max-w-md rounded-md border bg-muted/30">
    <div className="flex w-max gap-3 p-3">
      {numbers.map((number) => (
        <div
          key={number}
          className="flex h-16 w-32 shrink-0 items-center justify-center rounded-md border bg-card text-sm tabular-nums"
        >
          Column {number}
        </div>
      ))}
    </div>
    <ScrollBar orientation="horizontal" />
  </ScrollArea>
);
