// The stories for ResizablePanelGroup and its parts. Kept under lib/ with a non-component
// file name: a sibling named like an export is shimmed to the package by the
// story-imports plugin, so `export * from "./ResizablePanelGroup"` would re-export all of it.
import {
  Badge,
  Markdown,
  MemberChip,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  RunStatus,
} from "@deevy/design-system";
import { ada, gates, planner, proposal, runs } from "./fixtures";

const run = runs[0]!;
const gate = gates[0]!;

// What Planner narrated on its way to the Gate, each in its kind's tone.
const activity = [
  { tone: "", body: "Read `acme/deevy#412` and the three list operations it names." },
  {
    tone: "text-muted-foreground italic",
    body: "An offset skips a row whenever one arrives mid-page, so the cursor is the last row's `seq`.",
  },
  {
    tone: "text-gate-foreground dark:text-gate",
    body: "Stopped at **plan** and handed the Proposal to a Human.",
  },
];

/** A Run's page: its Activity in the main panel, the rail at 300px, a handle between. */
export const RunPage = () => (
  <div className="h-80 w-full">
    <ResizablePanelGroup orientation="horizontal" className="rounded-md border bg-background">
      <ResizablePanel minSize={240} className="min-w-0">
        <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{run.record}</span>
            <RunStatus status={run.status} />
          </div>
          <h2 className="text-lg font-semibold tracking-tight">{gate.title}</h2>
          <ol className="flex flex-col gap-2">
            {activity.map((line) => (
              <li key={line.body} className="border-l-2 pl-3">
                <Markdown className={`text-sm ${line.tone}`}>{line.body}</Markdown>
              </li>
            ))}
          </ol>
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={300} minSize={220} className="min-w-0">
        <dl className="flex h-full flex-col gap-3 bg-muted/30 p-4 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Gate</dt>
            <dd className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="border-gate/50 text-gate-foreground dark:text-gate"
              >
                {gate.checkpoint}
              </Badge>
              <span className="text-xs tabular-nums text-muted-foreground">
                {gate.approvals} of {gate.required}
              </span>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Agent</dt>
            <dd>
              <MemberChip member={planner} size="sm" sponsorName="Ada Lovelace" />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">May rule</dt>
            <dd>
              <MemberChip member={ada} size="sm" />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Working</dt>
            <dd className="tabular-nums">{run.time}</dd>
          </div>
        </dl>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
);

/** Stacked: the Run's Activity above, the Proposal it stopped with below; the handle is a horizontal bar. */
export const Vertical = () => (
  <div className="h-72 w-full">
    <ResizablePanelGroup orientation="vertical" className="rounded-md border bg-background">
      <ResizablePanel defaultSize={110} minSize={60} className="min-h-0">
        <ol className="flex h-full flex-col gap-1 overflow-hidden p-3 text-xs text-muted-foreground">
          <li>
            <span className="tabular-nums">10:02:14</span>{" "}
            <span className="font-mono">{run.id}</span> started for{" "}
            <span className="font-mono">@planner</span>
          </li>
          <li>
            <span className="tabular-nums">10:02:15</span> read{" "}
            <span className="font-mono">{run.record}</span>
          </li>
          <li>
            <span className="tabular-nums">10:02:41</span> wrote the plan for cursor paging
          </li>
          <li className="text-foreground">
            <span className="tabular-nums">10:02:42</span> stopped at{" "}
            <span className="font-mono">plan</span> — waiting for input
          </li>
        </ol>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel minSize={80} className="min-h-0">
        <div className="h-full overflow-hidden p-3">
          <Markdown>{proposal}</Markdown>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
);

// The latest few lines of the Event log, and the payload of the one selected.
const events = [
  { kind: "gate.requested", subject: "acme/deevy#412", when: "12m" },
  { kind: "run.started", subject: "acme/deevy#409", when: "41m" },
  { kind: "socket.connected", subject: "GitHub · acme", when: "2d" },
];

const payload = `{
  "issueId": "iss_4f7k2m9q1x8c",
  "runId": "${run.id}",
  "checkpoint": "plan",
  "visit": 1,
  "required": ${String(gate.required)}
}`;

/** Without the grip: a plain hairline, still draggable — the Event log beside one Event's payload. */
export const PlainHandle = () => (
  <div className="h-40 w-full">
    <ResizablePanelGroup orientation="horizontal" className="rounded-md border bg-background">
      <ResizablePanel className="min-w-0">
        <div className="flex h-full flex-col gap-1 p-3 text-sm">
          <span className="text-xs text-muted-foreground">Event log</span>
          {events.map((event) => (
            <span key={event.kind} className="flex items-center gap-2 truncate">
              <span className="font-mono text-xs">{event.kind}</span>
              <span className="truncate text-muted-foreground">{event.subject}</span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {event.when}
              </span>
            </span>
          ))}
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel className="min-w-0">
        <div className="flex h-full flex-col gap-2 p-3 text-sm">
          <span className="text-xs text-muted-foreground">Payload</span>
          <pre className="overflow-hidden font-mono text-xs text-muted-foreground">{payload}</pre>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
);
