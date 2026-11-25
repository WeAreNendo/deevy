import { Badge, MemberChip, RailHeading, RunStatus } from "@deevy/design-system";
import { ExternalLink } from "lucide-react";
import { finishedRun, grace, planGate, shipRun, waitingRun } from "./lib/fixtures";

/** A Run's rail: the Gates it asked for, then how long it took. */
export const RunRail = () => (
  <div className="flex w-72 flex-col gap-6">
    <section className="flex flex-col gap-2">
      <RailHeading>Gates</RailHeading>
      <ul aria-label="Gates" className="flex flex-col gap-2">
        <li className="flex items-center gap-2 rounded-md border p-2 text-sm">
          <Badge variant="outline">{planGate.checkpoint}</Badge>
          <span className="flex-1 truncate text-muted-foreground">
            {planGate.approvals} of {planGate.required}
          </span>
          <ExternalLink aria-hidden className="size-3 text-muted-foreground" />
        </li>
      </ul>
    </section>
    <section aria-label="Time" className="flex flex-col gap-2">
      <RailHeading>Time</RailHeading>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Working</dt>
        <dd className="tabular-nums">{waitingRun.time}</dd>
        <dt className="text-muted-foreground">Waiting on a Human</dt>
        <dd className="tabular-nums">12 min</dd>
        <dt className="text-muted-foreground">Queued</dt>
        <dd className="tabular-nums">3 s</dd>
      </dl>
    </section>
  </div>
);

/** A Gate's rail, under the ruling card: what was already said (one of the two it wants), and the Run that stopped. */
export const GateRail = () => (
  <div className="flex w-72 flex-col gap-6">
    <section className="flex flex-col gap-2">
      <RailHeading>Gate decisions</RailHeading>
      <ul aria-label="Gate decisions" className="flex flex-col gap-2">
        <li className="flex flex-col gap-1 rounded-md border p-2">
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <MemberChip member={grace} size="inline" />
            <Badge variant="outline" className="border-state-done/40 text-state-done">
              Approved
            </Badge>
            <span className="text-xs text-muted-foreground">1 hour ago</span>
          </span>
          <p className="text-sm">Yes, and say so in the changelog.</p>
        </li>
      </ul>
    </section>
    <section className="flex flex-col gap-2">
      <RailHeading>The Run that stopped here</RailHeading>
      <div className="flex items-center gap-2">
        <RunStatus status={shipRun.status} />
        <span className="font-mono text-xs text-muted-foreground">{shipRun.id}</span>
      </div>
    </section>
  </div>
);

/** A record's rail: the Runs on it, the Gates asked about it, the Links left on it. */
export const RecordRail = () => (
  <div className="flex w-72 flex-col gap-6">
    <section className="flex flex-col gap-2">
      <RailHeading>Runs</RailHeading>
      <ul aria-label="Runs" className="flex flex-col gap-2">
        <li className="flex items-center gap-2 rounded-md border p-2 text-sm">
          <RunStatus status={finishedRun.status} />
          <span className="flex-1 truncate text-muted-foreground">{finishedRun.summary}</span>
        </li>
      </ul>
    </section>
    <section className="flex flex-col gap-2">
      <RailHeading>Gates</RailHeading>
      <ul aria-label="Gates" className="flex flex-col gap-2">
        <li className="flex items-center gap-2 rounded-md border p-2 text-sm">
          <Badge variant="outline">ship</Badge>
          <span className="flex-1 truncate text-muted-foreground">approved</span>
        </li>
      </ul>
    </section>
    <section className="flex flex-col gap-2">
      <RailHeading>Links</RailHeading>
      <ul aria-label="Links" className="flex flex-col gap-1">
        <li>
          <a href="#" className="inline-flex items-center gap-1 text-sm hover:underline">
            Sign the delivery id
            <ExternalLink aria-hidden className="size-3" />
          </a>
        </li>
      </ul>
    </section>
  </div>
);
