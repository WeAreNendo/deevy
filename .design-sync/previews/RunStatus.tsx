import { MemberChip, RunStatus } from "@deevy/design-system";
import { runs } from "./lib/fixtures";

/** Every status a Run can have, in the order it usually goes. */
export const Statuses = () => (
  <div className="flex flex-wrap items-center gap-2">
    <RunStatus status="pending" />
    <RunStatus status="active" />
    <RunStatus status="awaiting_input" />
    <RunStatus status="completed" />
    <RunStatus status="failed" />
    <RunStatus status="stale" />
  </div>
);

/** Under a Run's key, on its page: the status, the Agent, what started it, when. */
export const InARunsHeader = () => (
  <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
    <RunStatus status="awaiting_input" />
    <MemberChip member={runs[2]!.agent} size="inline" />
    <span className="text-xs">started by assignment</span>
    <span aria-hidden>·</span>
    <span className="text-xs">{runs[2]!.last}</span>
  </span>
);
