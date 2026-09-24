import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { MemberChip } from "@/components/member-chip";
import { PageHeader } from "@/components/page-header";
import { RunStatus, type RunStatusValue } from "@/components/run-status";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { orpc } from "@/lib/orpc";
import { useMembersById } from "@/lib/members";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * What needs you (docs/plans/sockets.md, slice 3).
 *
 * deevy is not where the work is any more, so this is not a list of work: it
 * is a Gate waiting on this Human's ruling, a Run waiting on their answer, and
 * then what their Agents are doing. In that order, because a ruling blocks
 * somebody, an answer blocks something, and the rest is news.
 */
export function HomePage() {
  const gates = useQuery(orpc.gates.list.queryOptions({ input: { mine: true } }));
  const runs = useQuery(orpc.runs.list.queryOptions({ input: { mine: true, limit: 20 } }));
  const nameOf = useMembersById();

  const waiting = gates.data?.gates ?? [];
  const mine = runs.data?.runs ?? [];
  // A Run stopped at a Gate is not a second thing to do: the Gate above is
  // where it is answered.
  const asking = mine.filter(
    (run) => run.status === "awaiting_input" && run.openGateRequestId === null,
  );
  // Everything else still going, the one stopped at a Gate included: it is
  // still an Agent's Run, it is just not a second question.
  const working = mine.filter(
    (run) => !["completed", "failed"].includes(run.status) && !asking.includes(run),
  );
  const loading = gates.isPending || runs.isPending;
  const nothing = !loading && waiting.length === 0 && asking.length === 0 && working.length === 0;

  return (
    // One landmark for the page, and one per queue inside it: a Human reading
    // with a screen reader hears what needs them, then what kind.
    <section aria-label="Needs me" className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8">
      <PageHeader
        title="Needs me"
        description="Rulings, answers, and what your Agents are doing."
      />

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}

      {nothing ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>Nothing needs you</EmptyTitle>
            <EmptyDescription>
              Gates awaiting your ruling and Runs awaiting your answer will show up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {waiting.length > 0 ? (
        <section aria-label="Gates awaiting you" className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Gates awaiting you</h2>
          <ul className="flex flex-col gap-2">
            {waiting.map((gate) => {
              const agent = nameOf(gate.requestedBy);
              return (
                <li key={gate.id}>
                  <Link
                    to="/gates/$requestId"
                    params={{ requestId: gate.id }}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border border-gate/40 bg-gate/5 p-3",
                      "hover:bg-gate/10",
                    )}
                  >
                    <Badge
                      variant="outline"
                      className="border-gate/50 text-gate-foreground dark:text-gate"
                    >
                      {gate.checkpoint}
                    </Badge>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {gate.proposal.split("\n")[0]?.replace(/^#+\s*/, "")}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{gate.run.issueKey}</span>
                        {agent ? <MemberChip member={agent} size="inline" /> : null}
                        <span>{ago(gate.askedAt)}</span>
                      </span>
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {gate.approvals} of {gate.policy.approvalsRequired}
                    </span>
                    <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {asking.length > 0 ? (
        <section aria-label="Runs awaiting your answer" className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Runs awaiting your answer</h2>
          <RunList runs={asking} nameOf={nameOf} />
        </section>
      ) : null}

      {working.length > 0 ? (
        <section aria-label="Your Agents' Runs" className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Your Agents&apos; Runs</h2>
          <RunList runs={working} nameOf={nameOf} />
        </section>
      ) : null}
    </section>
  );
}

type RunRow = {
  id: string;
  issueKey: string;
  agentMemberId: string;
  status: string;
  summary: string | null;
  lastActivityAt: Date;
  openGateRequestId: string | null;
};

/** The same row on Home and in the Runs feed: who, on what, how long ago. */
export function RunList({
  runs,
  nameOf,
}: {
  runs: RunRow[];
  nameOf: ReturnType<typeof useMembersById>;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {runs.map((run) => {
        const agent = nameOf(run.agentMemberId);
        return (
          <li key={run.id}>
            <Link
              to="/runs/$runId"
              params={{ runId: run.id }}
              className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent"
            >
              <RunStatus status={run.status as RunStatusValue} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">
                  {run.summary ?? (agent ? `${agent.user.name} is working` : "A Run")}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{run.issueKey}</span>
                  {agent ? <MemberChip member={agent} size="inline" /> : null}
                  <span>{ago(run.lastActivityAt)}</span>
                </span>
              </span>
              <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
