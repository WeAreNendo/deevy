import {
  Badge,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
  MemberChip,
  RunStatus,
} from "@deevy/design-system";
import { ChevronRight } from "lucide-react";
import { activeRun, gates, waitingRun, type GateRow, type RunRow } from "./lib/fixtures";

// No screen uses Item: Needs me draws its rows as plain links. These are the
// same rows, in the same words, out of Item's parts.

const Gate = ({ gate }: { gate: GateRow }) => (
  <Item variant="outline" className="border-gate/40 bg-gate/5">
    <ItemMedia>
      <Badge variant="outline" className="border-gate/50 text-gate-foreground dark:text-gate">
        {gate.checkpoint}
      </Badge>
    </ItemMedia>
    <ItemContent>
      <ItemTitle>{gate.says}</ItemTitle>
      <ItemDescription className="flex items-center gap-2 text-xs">
        <span className="font-mono">{gate.record}</span>
        <MemberChip member={gate.agent} size="inline" />
        <span>{gate.asked}</span>
      </ItemDescription>
    </ItemContent>
    <ItemActions>
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        {gate.approvals} of {gate.required}
      </span>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
    </ItemActions>
  </Item>
);

const Run = ({ run }: { run: RunRow }) => (
  <Item variant="outline">
    <ItemMedia>
      <RunStatus status={run.status} />
    </ItemMedia>
    <ItemContent>
      <ItemTitle className="font-normal">
        {run.summary ?? `${run.agent.user.name} is working`}
      </ItemTitle>
      <ItemDescription className="flex items-center gap-2 text-xs">
        <span className="font-mono">{run.record}</span>
        <MemberChip member={run.agent} size="inline" />
        <span>{run.last}</span>
      </ItemDescription>
    </ItemContent>
    <ItemActions>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
    </ItemActions>
  </Item>
);

/** One Gate on Needs me: its Checkpoint in amber, what is asked, the record, the Agent that asked, the count. */
export const GateAwaitingYou = () => (
  <div className="max-w-lg">
    <Gate gate={gates[0]!} />
  </div>
);

/** Needs me: the Gates awaiting you, then your Agents' Runs that are still going. */
export const NeedsMe = () => (
  <ItemGroup className="max-w-lg gap-2">
    {gates.map((gate) => (
      <Gate key={gate.id} gate={gate} />
    ))}
    <ItemSeparator />
    <Run run={activeRun} />
    <Run run={waitingRun} />
  </ItemGroup>
);

/** The three looks: default sits flat, outline has a border, muted a tint. */
export const Variants = () => (
  <div className="flex max-w-lg flex-col gap-2">
    {(["default", "outline", "muted"] as const).map((variant) => (
      <Item key={variant} variant={variant}>
        <ItemContent>
          <ItemTitle>{variant}</ItemTitle>
          <ItemDescription>A line under the title.</ItemDescription>
        </ItemContent>
      </Item>
    ))}
  </div>
);

/** A header line and a footer line spanning the row. */
export const WithHeaderAndFooter = () => (
  <Item variant="outline" className="max-w-lg">
    <ItemHeader>
      <span className="font-mono text-xs text-muted-foreground">{activeRun.id}</span>
      <RunStatus status={activeRun.status} />
    </ItemHeader>
    <ItemContent>
      <ItemTitle className="font-mono">{activeRun.record}</ItemTitle>
      <ItemDescription className="flex items-center gap-2">
        <MemberChip member={activeRun.agent} size="inline" />
        <span>started by assignment</span>
      </ItemDescription>
    </ItemContent>
    <ItemFooter className="text-muted-foreground tabular-nums">
      <span>Working {activeRun.time}</span>
      <span>Waiting on a Human 0 s</span>
    </ItemFooter>
  </Item>
);
