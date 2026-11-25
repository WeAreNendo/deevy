import { Badge, DataTable, MemberChip, RunStatus } from "@deevy/design-system";
import { ClipboardList, ExternalLink, PlayCircle } from "lucide-react";
import { records, runs, type RecordRow, type RunRow } from "./lib/fixtures";

const runColumns = [
  {
    id: "status",
    header: "Status",
    cell: (row: RunRow) => <RunStatus status={row.status} />,
    sortValue: (row: RunRow) => row.status,
  },
  {
    id: "record",
    header: "Record",
    cell: (row: RunRow) => <span className="font-mono text-xs">{row.record}</span>,
    sortValue: (row: RunRow) => row.record,
  },
  {
    id: "agent",
    header: "Agent",
    cell: (row: RunRow) => <MemberChip member={row.agent} size="xs" />,
    sortValue: (row: RunRow) => row.agent.user.name,
  },
  {
    id: "summary",
    header: "Last",
    cell: (row: RunRow) => <span className="truncate text-muted-foreground">{row.summary}</span>,
    // The one column that gives way: it takes what the others leave, and clips.
    className: "w-full max-w-0 min-w-0 overflow-hidden",
  },
  {
    id: "time",
    header: "Time",
    cell: (row: RunRow) => (
      <span className="text-xs tabular-nums text-muted-foreground">{row.time}</span>
    ),
    className: "text-right whitespace-nowrap",
    headerClassName: "text-right",
  },
  {
    id: "when",
    header: "Last activity",
    cell: (row: RunRow) => <span className="text-xs text-muted-foreground">{row.last}</span>,
  },
];

/** The Runs feed: status, record, Agent, what it last said, working time, when. */
export const Runs = () => (
  <DataTable
    aria-label="Runs"
    columns={runColumns}
    rows={runs}
    getRowId={(row) => row.id}
    selectedId="run_3n7p0w5d8e2f"
  />
);

const recordColumns = [
  {
    id: "key",
    header: "Key",
    cell: (row: RecordRow) => (
      <a href="#" className="inline-flex items-center gap-1 font-mono text-xs hover:underline">
        {row.key}
        <ExternalLink aria-hidden className="size-3" />
      </a>
    ),
    sortValue: (row: RecordRow) => row.key,
  },
  {
    id: "title",
    header: "Title",
    cell: (row: RecordRow) => <span className="truncate">{row.title}</span>,
    sortValue: (row: RecordRow) => row.title,
    className: "w-full max-w-0 min-w-0 overflow-hidden",
  },
  {
    id: "state",
    header: "State",
    // The tracker's own word, not deevy's.
    cell: (row: RecordRow) => (
      <Badge
        variant="outline"
        className={row.state === "Closed" ? "text-muted-foreground" : undefined}
      >
        {row.state}
      </Badge>
    ),
    sortValue: (row: RecordRow) => row.state,
  },
  {
    id: "routed",
    header: "Routed to",
    cell: (row: RecordRow) =>
      row.routedTo ? (
        <MemberChip member={row.routedTo} size="xs" />
      ) : (
        <span className="text-muted-foreground">Nobody</span>
      ),
    sortValue: (row: RecordRow) => row.routedTo?.user.name ?? "",
  },
  {
    id: "gate",
    header: "Gate",
    cell: (row: RecordRow) =>
      row.gate ? (
        <Badge variant="outline" className="border-gate/50 text-gate-foreground dark:text-gate">
          {row.gate}
        </Badge>
      ) : null,
  },
  {
    id: "changed",
    header: "Changed",
    cell: (row: RecordRow) => <span className="text-xs text-muted-foreground">{row.changed}</span>,
    className: "whitespace-nowrap",
  },
];

/** Work: every record deevy projected, read-only; the key links out to where it lives. */
export const Work = () => (
  <DataTable aria-label="Work" columns={recordColumns} rows={records} getRowId={(row) => row.key} />
);

/** Grouped, one header row per group; a folded group shows only its header. */
export const Grouped = () => (
  <DataTable
    aria-label="Runs by Agent"
    columns={runColumns.filter((column) => column.id !== "agent")}
    groups={[
      {
        id: "planner",
        header: <MemberChip member={runs[0]!.agent} size="xs" />,
        rows: runs.filter((run) => run.agent.handle === "planner"),
        onToggle: () => {},
      },
      {
        id: "builder",
        header: <MemberChip member={runs[1]!.agent} size="xs" />,
        rows: runs.filter((run) => run.agent.handle === "builder"),
        collapsed: true,
        onToggle: () => {},
      },
    ]}
    getRowId={(row) => row.id}
  />
);

export const Comfortable = () => (
  <DataTable
    aria-label="Runs"
    columns={runColumns}
    rows={runs.slice(0, 3)}
    getRowId={(row) => row.id}
    density="comfortable"
  />
);

export const Loading = () => (
  <DataTable aria-label="Runs" columns={runColumns} rows={[]} getRowId={(row) => row.id} loading />
);

/** The words say what emptied the list. */
export const Empty = () => (
  <DataTable
    aria-label="Runs"
    columns={runColumns}
    rows={[]}
    getRowId={(row) => row.id}
    empty={{
      icon: PlayCircle,
      title: "No Runs match your filters",
      description: "A Run starts when a record is routed to an Agent, or when one is mentioned.",
    }}
  />
);

/** Nothing has arrived yet, as Work says it before any tool has. */
export const NothingYet = () => (
  <DataTable
    aria-label="Work"
    columns={recordColumns}
    rows={[]}
    getRowId={(row) => row.key}
    empty={{
      icon: ClipboardList,
      title: "Nothing has arrived yet",
      description:
        "A record shows up here when its tracker tells deevy about it, or when deevy asks.",
    }}
  />
);
