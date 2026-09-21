import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, ExternalLink } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/data-table";
import { MemberChip } from "@/components/member-chip";
import { PageHeader } from "@/components/page-header";
import { WorkFilters, workListInput, type WorkSearch } from "@/components/work-filters";
import { Badge } from "@/components/ui/badge";
import { orpc } from "@/lib/orpc";
import { ago } from "@/lib/time";

interface WorkRow {
  id: string;
  externalKey: string;
  url: string;
  title: string;
  state: string;
  stateName: string;
  externalUpdatedAt: Date;
  assignee: { id: string; kind: "human" | "agent"; user: { name: string } } | null;
}

/**
 * Every record deevy has projected: `/work` (docs/plans/sockets.md, slice 3).
 *
 * Read-only, and deliberately not a tracker: what it adds to the tool the work
 * lives in is which Agent deevy routed a record to and what happened next. The
 * key on every row goes back to where the record really is.
 */
export function WorkPage({
  search,
  onSearch,
}: {
  search: WorkSearch;
  onSearch: (patch: Partial<WorkSearch>) => void;
}) {
  const navigate = useNavigate();
  const issues = useQuery(orpc.issues.list.queryOptions({ input: workListInput(search) }));
  const open = useQuery(orpc.gates.list.queryOptions({ input: { status: "open" } }));
  const gateOf = new Map((open.data?.gates ?? []).map((gate) => [gate.issueId, gate]));

  const columns: DataColumn<WorkRow>[] = [
    {
      id: "key",
      header: "Key",
      cell: (row) => (
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(clicked) => clicked.stopPropagation()}
          className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
        >
          {row.externalKey}
          <ExternalLink aria-hidden className="size-3" />
        </a>
      ),
      sortValue: (row) => row.externalKey,
    },
    {
      id: "title",
      header: "Title",
      cell: (row) => <span className="truncate">{row.title}</span>,
      sortValue: (row) => row.title,
      className: "max-w-0 min-w-0 overflow-hidden",
    },
    {
      id: "state",
      header: "State",
      // The tracker's own word, not deevy's: `In Review` means whatever it
      // means there (ADR-0024).
      cell: (row) => (
        <Badge variant="outline" className={row.state === "closed" ? "text-muted-foreground" : ""}>
          {row.stateName}
        </Badge>
      ),
      sortValue: (row) => row.stateName,
    },
    {
      id: "assignee",
      header: "Routed to",
      cell: (row) =>
        row.assignee ? (
          <MemberChip member={row.assignee as never} size="xs" />
        ) : (
          <span className="text-muted-foreground">Nobody</span>
        ),
      sortValue: (row) => row.assignee?.user.name ?? "",
    },
    {
      id: "gate",
      header: "Gate",
      cell: (row) => {
        const gate = gateOf.get(row.id);
        return gate ? (
          <Badge variant="outline" className="border-gate/50 text-gate-foreground dark:text-gate">
            {gate.checkpoint}
          </Badge>
        ) : null;
      },
    },
    {
      id: "when",
      header: "Changed",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">{ago(row.externalUpdatedAt)}</span>
      ),
      sortValue: (row) => row.externalUpdatedAt.getTime(),
    },
  ];

  const filtered = Object.keys(search).length > 0;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Work"
        description="Every record deevy has projected from the tools it is connected to."
      >
        <WorkFilters search={search} onSearch={onSearch} />
      </PageHeader>

      <DataTable
        aria-label="Work"
        columns={columns}
        rows={(issues.data?.issues ?? []) as unknown as WorkRow[]}
        getRowId={(row) => row.id}
        loading={issues.isPending}
        onOpen={(id) => void navigate({ to: "/work/$issueId", params: { issueId: id } })}
        empty={{
          icon: ClipboardList,
          title: filtered ? "Nothing matches your filters" : "Nothing has arrived yet",
          description: filtered
            ? "Clear a filter to see the rest."
            : "A record shows up here when its tracker tells deevy about it, or when deevy asks.",
        }}
      />
    </div>
  );
}
