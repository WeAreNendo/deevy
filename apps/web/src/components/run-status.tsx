import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type RunStatusValue =
  | "pending"
  | "active"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "stale";

/** The wording issue-runs.tsx shipped, which the tests match on. */
export const runStatusLabels: Record<RunStatusValue, string> = {
  pending: "Waiting to start",
  active: "Working",
  // At a Gate, the one thing a Run waits at (docs/plans/simplify.md, slice 5).
  awaiting_input: "Waiting on a ruling",
  completed: "Finished",
  failed: "Failed",
  stale: "Gone quiet",
};

const looks: Record<RunStatusValue, string> = {
  pending: "border-dashed bg-transparent text-muted-foreground",
  active: "border-agent/40 bg-agent/10 text-agent",
  awaiting_input: "border-gate/50 bg-gate/15 text-gate-foreground dark:text-gate",
  completed: "border-state-done/40 bg-state-done/10 text-state-done",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  stale: "bg-muted text-muted-foreground",
};

/**
 * A Run's status as a badge: the Agent hue while it works, amber while it waits
 * on a Human, and a pulse on the one that is waiting right now.
 */
export function RunStatus({
  status,
  label,
  className,
}: {
  status: RunStatusValue;
  /** Overrides the default wording. */
  label?: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      data-slot="run-status"
      data-status={status}
      className={cn("gap-1.5 font-medium", looks[status], className)}
    >
      {status === "active" || status === "awaiting_input" ? (
        <span
          aria-hidden
          className={cn(
            "inline-block size-1.5 rounded-full",
            status === "active" ? "bg-agent" : "bg-gate animate-pulse",
          )}
        />
      ) : null}
      {label ?? runStatusLabels[status]}
    </Badge>
  );
}
