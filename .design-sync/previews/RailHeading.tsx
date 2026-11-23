import { Badge, MemberChip, RailHeading, RunStatus } from "@deevy/design-system";
import { ada, builder, planner } from "./lib/fixtures";

/**
 * A Run page's rail: each section named by a RailHeading (12px, medium, muted),
 * metadata-sized, never a 14px heading.
 */
export const RunRail = () => (
  <aside className="flex w-72 flex-col gap-6">
    <section className="flex flex-col gap-2">
      <RailHeading>Gates</RailHeading>
      <ul aria-label="Gates" className="flex flex-col gap-2">
        <li className="flex items-center gap-2 rounded-lg border border-gate/40 bg-gate/5 p-2.5 text-sm">
          <Badge variant="outline" className="border-gate/50 text-gate-foreground dark:text-gate">
            plan
          </Badge>
          <span className="flex-1 truncate">Cursor-based paging</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">0 of 1</span>
        </li>
      </ul>
    </section>
    <section className="flex flex-col gap-2">
      <RailHeading>Agent</RailHeading>
      <MemberChip member={planner} sponsorName="Ada Lovelace" />
    </section>
    <section className="flex flex-col gap-2">
      <RailHeading>Status</RailHeading>
      <div>
        <RunStatus status="awaiting_input" />
      </div>
    </section>
    <section className="flex flex-col gap-2">
      <RailHeading>Time</RailHeading>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Working</dt>
        <dd className="tabular-nums">14m</dd>
        <dt className="text-muted-foreground">Waiting on a Human</dt>
        <dd className="tabular-nums">12m</dd>
      </dl>
    </section>
  </aside>
);

/** A record's rail: who it is routed to and who last ruled on it. */
export const RecordRail = () => (
  <aside className="flex w-72 flex-col gap-6">
    <section className="flex flex-col gap-2">
      <RailHeading>Routed to</RailHeading>
      <MemberChip member={builder} />
    </section>
    <section className="flex flex-col gap-2">
      <RailHeading>Last ruling</RailHeading>
      <p className="text-sm text-muted-foreground">
        <MemberChip member={ada} size="inline" /> approved at{" "}
        <span className="font-mono">ship</span>, 2h ago
      </p>
    </section>
  </aside>
);
