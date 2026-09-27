import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PlayCircle } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/data-table";
import { MemberChip } from "@/components/member-chip";
import { PageHeader } from "@/components/page-header";
import { RunStatus, runStatusLabels, type RunStatusValue } from "@/components/run-status";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { orpc } from "@/lib/orpc";
import { useMembersById } from "@/lib/members";
import { ago } from "@/lib/time";
import { dollars, duration, tokens, type UsageTotals } from "@/lib/usage";

/** What `/runs` carries in its URL: every filter is the server's. */
export interface RunsSearch {
  status?: RunStatusValue;
  agent?: string;
  mine?: string;
}

const statuses: RunStatusValue[] = [
  "pending",
  "active",
  "awaiting_input",
  "completed",
  "failed",
  "stale",
];

export function parseRunsSearch(search: Record<string, unknown>): RunsSearch {
  const status = typeof search.status === "string" ? search.status : "";
  const agent = typeof search.agent === "string" ? search.agent : "";
  return {
    ...(statuses.includes(status as RunStatusValue) ? { status: status as RunStatusValue } : {}),
    ...(agent ? { agent } : {}),
    ...(search.mine === "1" || search.mine === true ? { mine: "1" } : {}),
  };
}

interface RunRow {
  id: string;
  issueKey: string;
  agentMemberId: string;
  status: string;
  summary: string | null;
  lastActivityAt: Date;
  openGateRequestId: string | null;
  usage: UsageTotals;
  timing: { queuedMs: number; workingMs: number; waitingMs: number };
}

/**
 * The Runs feed: what deevy's Agents have been doing (docs/plans/sockets.md).
 *
 * The one list deevy still owns, because a Run is deevy's own record and the
 * tracker has none of it. Flat, newest first, with the filters in the URL so a
 * view is a link.
 */
export function RunsPage({ search }: { search: RunsSearch }) {
  const navigate = useNavigate();
  const runs = useQuery(
    orpc.runs.list.queryOptions({
      input: {
        limit: 50,
        ...(search.status ? { status: search.status } : {}),
        ...(search.agent ? { agentMemberId: search.agent } : {}),
        ...(search.mine ? { mine: true } : {}),
      },
    }),
  );
  const nameOf = useMembersById();

  const set = (patch: Partial<RunsSearch>) =>
    void navigate({ to: "/runs", search: (previous) => ({ ...previous, ...patch }) });

  const columns: DataColumn<RunRow>[] = [
    {
      id: "status",
      header: "Status",
      cell: (row) =>
        row.openGateRequestId ? (
          // A Run that stopped at a Gate is one click from where it is
          // answered: a badge that only says "waiting" wastes the click.
          <Link
            to="/gates/$requestId"
            params={{ requestId: row.openGateRequestId }}
            className="inline-flex"
            onClick={(clicked) => clicked.stopPropagation()}
          >
            <RunStatus status="awaiting_input" label="Waiting on a ruling" />
          </Link>
        ) : (
          <RunStatus status={row.status as RunStatusValue} />
        ),
      sortValue: (row) => row.status,
    },
    {
      id: "issue",
      header: "Record",
      cell: (row) => <span className="font-mono text-xs">{row.issueKey}</span>,
      sortValue: (row) => row.issueKey,
    },
    {
      id: "agent",
      header: "Agent",
      cell: (row) => {
        const agent = nameOf(row.agentMemberId);
        return agent ? <MemberChip member={agent} size="xs" /> : <span>—</span>;
      },
      sortValue: (row) => nameOf(row.agentMemberId)?.user.name ?? "",
    },
    {
      id: "summary",
      header: "Last",
      cell: (row) => <span className="truncate text-muted-foreground">{row.summary ?? ""}</span>,
      // The one column that gives: it takes what the others leave and clips,
      // rather than being left the minimum while Status stretches.
      className: "w-full max-w-0 min-w-0 overflow-hidden",
    },
    {
      id: "cost",
      header: "Cost",
      // The harness's estimate, or a dash: a Run nobody priced is never a $0.
      cell: (row) =>
        row.usage.costUsd === null ? (
          <span
            className="text-muted-foreground"
            title={
              row.usage.reports === 0
                ? "No usage reported"
                : `${tokens(row.usage.unpricedTokens)} tokens, cost not reported`
            }
          >
            —
          </span>
        ) : (
          <span
            className="tabular-nums"
            title={
              row.usage.unpricedTokens > 0
                ? `An estimate; ${tokens(row.usage.unpricedTokens)} tokens were not priced`
                : "An estimate, by whatever ran the Agent"
            }
          >
            {dollars(row.usage.costUsd)}
          </span>
        ),
      sortValue: (row) => row.usage.costUsd ?? -1,
      className: "text-right whitespace-nowrap",
      headerClassName: "text-right",
    },
    {
      id: "time",
      header: "Time",
      // Working time; the wait on a Human and the queue are the tooltip's.
      cell: (row) => (
        <span
          className="text-xs tabular-nums text-muted-foreground"
          title={`Waiting on a Human ${duration(row.timing.waitingMs)} · Queued ${duration(row.timing.queuedMs)}`}
        >
          {duration(row.timing.workingMs)}
        </span>
      ),
      sortValue: (row) => row.timing.workingMs,
      className: "text-right whitespace-nowrap",
      headerClassName: "text-right",
    },
    {
      id: "when",
      header: "Last activity",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">{ago(row.lastActivityAt)}</span>
      ),
      sortValue: (row) => row.lastActivityAt.getTime(),
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Runs" description="What your Agents have been doing.">
        <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            variant="outline"
            spacing={0}
            value={search.status ? [search.status] : []}
            onValueChange={(next) =>
              set({ status: (next as string[])[0] as RunStatusValue | undefined })
            }
          >
            {(["active", "awaiting_input", "completed"] as const).map((status) => (
              <ToggleGroupItem key={status} value={status}>
                {runStatusLabels[status]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            size="sm"
            variant={search.mine ? "default" : "outline"}
            onClick={() => set({ mine: search.mine ? undefined : "1" })}
          >
            Mine
          </Button>
        </div>
      </PageHeader>

      <DataTable
        aria-label="Runs"
        columns={columns}
        rows={(runs.data?.runs ?? []) as RunRow[]}
        getRowId={(row) => row.id}
        loading={runs.isPending}
        onOpen={(id) => void navigate({ to: "/runs/$runId", params: { runId: id } })}
        empty={{
          icon: PlayCircle,
          title: search.status || search.mine ? "No Runs match your filters" : "No Runs yet",
          description:
            "A Run starts when a record is routed to an Agent, or when one is mentioned.",
        }}
      />
    </div>
  );
}
