// The stories for ScrollArea and its parts. Kept under lib/ with a non-component
// file name: a sibling named like an export is shimmed to the package by the
// story-imports plugin, so `export * from "./ScrollArea"` would re-export all of it.
import { Badge, MemberChip, RunStatus, ScrollArea, ScrollBar } from "@deevy/design-system";
import {
  ada,
  builder,
  grace,
  omar,
  planner,
  records,
  runs,
  suspendedAgent,
  type RecordRow,
} from "./fixtures";

// More records than fit, so the scrollbar has something to do.
const work: RecordRow[] = [
  ...records,
  {
    key: "acme/deevy#397",
    title: "Retry a delivery that timed out",
    state: "Closed",
    routedTo: builder,
    gate: null,
    changed: "6d",
  },
  {
    key: "acme/ops#84",
    title: "Move the staging database to the EU",
    state: "Open",
    routedTo: null,
    gate: null,
    changed: "1w",
  },
  {
    key: "acme/deevy#390",
    title: "Fold routine steps in a Run's Activity",
    state: "Closed",
    routedTo: planner,
    gate: null,
    changed: "1w",
  },
  {
    key: "acme/deevy#386",
    title: "Suspend an Agent when its Sponsor leaves",
    state: "Closed",
    routedTo: builder,
    gate: null,
    changed: "2w",
  },
];

/** A list taller than its frame — Work's records — the vertical scrollbar is the thumb in `border` on the right. */
export const WorkList = () => (
  <ScrollArea className="h-48 w-full rounded-md border bg-card">
    <ul className="flex flex-col divide-y">
      {work.map((record) => (
        <li key={record.key} className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className="w-28 shrink-0 font-mono text-xs text-muted-foreground">
            {record.key}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{record.title}</span>
          <Badge
            variant="outline"
            className={record.state === "Closed" ? "text-muted-foreground" : ""}
          >
            {record.state}
          </Badge>
        </li>
      ))}
    </ul>
  </ScrollArea>
);

/** A row wider than its frame — your Agents' Runs as cards — with the horizontal ScrollBar along the bottom. */
export const Horizontal = () => (
  <ScrollArea className="w-full rounded-md border bg-muted/30">
    <div className="flex w-max gap-3 p-3">
      {runs.map((run) => (
        <div
          key={run.id}
          className="flex w-56 shrink-0 flex-col gap-2 rounded-md border bg-card p-2 text-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-muted-foreground">{run.record}</span>
            <MemberChip member={run.agent} size="xs" avatarOnly />
          </div>
          <span className="line-clamp-2 font-medium">{run.summary}</span>
          <div className="flex items-center justify-between gap-2">
            <RunStatus status={run.status} />
            <span className="text-xs tabular-nums text-muted-foreground">{run.last}</span>
          </div>
        </div>
      ))}
    </div>
    <ScrollBar orientation="horizontal" />
  </ScrollArea>
);

/** Settings › Members in a short frame: avatars, an Agent's Sponsor on hover, scrolling. */
export const Members = () => (
  <ScrollArea className="h-32 w-64 rounded-md border bg-card">
    <ul className="flex flex-col gap-0.5 p-2">
      {[ada, grace, omar, planner, builder, suspendedAgent].map((member) => (
        <li
          key={member.id}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
        >
          <MemberChip
            member={member}
            size="sm"
            sponsorName={member.kind === "agent" ? "Ada Lovelace" : undefined}
          />
          {"suspendedAt" in member ? (
            <Badge variant="outline" className="ml-auto">
              Suspended
            </Badge>
          ) : null}
        </li>
      ))}
    </ul>
  </ScrollArea>
);
