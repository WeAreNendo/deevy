import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DataTable, type DataColumn } from "@/components/data-table";
import { Label as FieldLabel } from "@/components/ui/label";
import { type ChipMember } from "@/components/member-chip";
import { SettingsPage } from "@/components/settings-page";
import { Badge } from "@/components/ui/badge";
import { ScrollText, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeEvent, toneClass } from "@/lib/event-text";
import { useEventContext } from "@/lib/mentions";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE = 100;
/** Base UI's Select wants a value for "everything"; the empty string is not one. */
const ANY = "__any";

/**
 * The Event kinds by what they are about, so the filter reads as the log does.
 * A prefix nothing appends is a filter that always answers nothing, which reads
 * as a bug in the log rather than in this list — `event-log.test.tsx` holds it
 * against the core's own union.
 */
export const kindFamilies = [
  { label: "Records", prefixes: ["issue", "comment"] },
  { label: "Runs", prefixes: ["run"] },
  {
    label: "Workspace",
    prefixes: ["member", "invitation", "allowlist", "agent", "socket", "project", "workspace"],
  },
];
export const subjectFamilies = [
  { label: "Work", types: ["issue", "run", "project"] },
  {
    label: "Workspace",
    types: ["member", "invitation", "allowlist_rule", "socket", "channel", "webhook", "workspace"],
  },
];

interface EventRow {
  seq: number;
  kind: string;
  actorMemberId: string | null;
  /** Who did it, joined by the server; null when deevy itself did. */
  actor: ChipMember | null;
  subjectType: string;
  subjectId: string;
  projectId: string | null;
  payload: unknown;
  createdAt: string | Date;
}

/**
 * The Workspace's Event log, newest first: the audit trail deevy's design
 * turns on, which until here could only be read with sqlite3
 * (docs/plans/ui-redesign.md slice 10). One `events.list` per page, paged
 * back with `before`; `useLiveEvents` re-reads it as Events arrive.
 */
export function EventLogPage() {
  const [kindPrefix, setKindPrefix] = useState(ANY);
  const [subjectType, setSubjectType] = useState(ANY);
  const [projectId, setProjectId] = useState(ANY);
  const [before, setBefore] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const events = useQuery(
    orpc.events.list.queryOptions({
      input: {
        order: "desc",
        limit: PAGE,
        ...(before === null ? {} : { before }),
        ...(kindPrefix !== ANY ? { kindPrefix } : {}),
        ...(subjectType !== ANY ? { subjectType } : {}),
        ...(projectId !== ANY ? { projectId } : {}),
      },
      // A changed filter, or a page back, keeps the rows on screen until the
      // next answer lands rather than emptying the log to a skeleton.
      placeholderData: keepPreviousData,
    }),
  );
  const projects = useQuery(orpc.projects.list.queryOptions({ input: {} }));
  // Names for what an older payload only numbers; the actor rides on the row.
  const eventContext = useEventContext();
  const projectById = useMemo(
    () => new Map((projects.data?.projects ?? []).map((project) => [project.id, project])),
    [projects.data],
  );

  // Every filter is the server's, so a page is always a full page of matches.
  const rows = (events.data?.events ?? []) as EventRow[];

  const columns = useMemo<DataColumn<EventRow>[]>(
    () => [
      {
        id: "seq",
        header: "Seq",
        cell: (row) => <span className="font-mono text-muted-foreground">{row.seq}</span>,
        className: "w-16",
      },
      {
        id: "time",
        header: "When",
        cell: (row) => (
          <span className="font-mono text-muted-foreground">
            {new Date(row.createdAt).toLocaleString()}
          </span>
        ),
        className: "w-44",
      },
      {
        id: "kind",
        header: "Kind",
        // In the tone the sentence takes, so a rejection reads red here as it
        // does in the Activity, and a Gate amber.
        cell: (row) => {
          const said = describeEvent(
            { kind: row.kind, payload: row.payload, actorKind: row.actor?.kind ?? null },
            eventContext,
          );
          return (
            <Badge
              variant="outline"
              className={cn("font-mono font-normal", said ? toneClass[said.tone] : "")}
            >
              {row.kind}
            </Badge>
          );
        },
        className: "w-48",
      },
      {
        id: "actor",
        header: "Actor",
        // A name, not a chip: 300 rows of avatars is a column of noise. The
        // kind still shows, in the colour the rest of the app gives it, so the
        // log keeps saying who is a Human and who is an Agent.
        cell: (row) =>
          row.actor ? (
            <span className={row.actor.kind === "agent" ? "text-agent" : "text-human"}>
              {row.actor.user.name}
            </span>
          ) : (
            <span className="text-muted-foreground">deevy</span>
          ),
        className: "w-44",
      },
      {
        id: "what",
        header: "What",
        cell: (row) => {
          const said = describeEvent(
            { kind: row.kind, payload: row.payload, actorKind: row.actor?.kind ?? null },
            eventContext,
          );
          if (!said) return <span className="text-muted-foreground">a Run step</span>;
          return (
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{said.text}</span>
              {said.detail ? (
                <span className="truncate text-muted-foreground">“{said.detail}”</span>
              ) : null}
            </span>
          );
        },
        className: "max-w-0 w-full",
      },
      {
        id: "subject",
        header: "Subject",
        cell: (row) => {
          const project = row.projectId ? projectById.get(row.projectId) : undefined;
          return (
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">{row.subjectType}</span>
              {project ? <span className="font-mono">{project.slug}</span> : null}
              {row.subjectType === "project" && project ? (
                <Link
                  to="/projects/$key"
                  params={{ key: project.slug }}
                  className="hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {project.name}
                </Link>
              ) : null}
            </span>
          );
        },
        className: "w-56",
      },
    ],
    [eventContext, projectById],
  );

  return (
    <SettingsPage title="Event log">
      {/* Each filter says what it filters on: "Every kind" alone reads as a
          value with no field, and three of them side by side read as three
          unrelated words. The label is the control's name, so `aria-label` on
          the trigger would only shadow it. */}
      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="event-kind">Kind</FieldLabel>
          <Select
            value={kindPrefix}
            onValueChange={(next) => {
              if (next === null) return;
              setKindPrefix(next);
              setBefore(null);
            }}
          >
            <SelectTrigger id="event-kind" className="w-44">
              <SelectValue>
                {(selected: string) => (selected === ANY ? "Every kind" : `${selected}.*`)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ANY}>Every kind</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              {kindFamilies.map((family) => (
                <SelectGroup key={family.label}>
                  <SelectLabel>{family.label}</SelectLabel>
                  {family.prefixes.map((prefix) => (
                    <SelectItem key={prefix} value={prefix}>
                      {prefix}.*
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="event-subject">Subject</FieldLabel>
          <Select
            value={subjectType}
            onValueChange={(next) => {
              if (next === null) return;
              setSubjectType(next);
              setBefore(null);
            }}
          >
            <SelectTrigger id="event-subject" className="w-40">
              <SelectValue>
                {(selected: string) => (selected === ANY ? "Any subject" : selected)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ANY}>Any subject</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              {subjectFamilies.map((family) => (
                <SelectGroup key={family.label}>
                  <SelectLabel>{family.label}</SelectLabel>
                  {family.types.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="event-project">Project</FieldLabel>
          <Select
            value={projectId}
            onValueChange={(next) => {
              if (next === null) return;
              setProjectId(next);
              setBefore(null);
            }}
          >
            <SelectTrigger id="event-project" className="w-48">
              <SelectValue>
                {(selected: string) => {
                  if (selected === ANY) return "All Projects";
                  const project = projectById.get(selected);
                  return project ? `${project.slug} — ${project.name}` : selected;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ANY}>All Projects</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                {(projects.data?.projects ?? []).map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.slug} — {project.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <span className="flex-1" />
        {before !== null ? (
          <Button variant="ghost" size="sm" onClick={() => setBefore(null)}>
            Newest
          </Button>
        ) : null}
      </div>

      {events.isError ? (
        <p className="text-sm text-destructive">Could not load the log: {events.error.message}</p>
      ) : (
        <DataTable
          // A log of meta, so 12px throughout rather than the 14px of a list
          // somebody works in; the cells inherit it instead of each saying so.
          className="text-xs"
          aria-label="Event log"
          columns={columns}
          rows={rows}
          getRowId={(row) => String(row.seq)}
          selectedId={open === null ? null : String(open)}
          onOpen={(id) => setOpen((current) => (current === Number(id) ? null : Number(id)))}
          loading={events.isPending}
          empty={
            kindPrefix !== ANY || subjectType !== ANY || projectId !== ANY
              ? {
                  icon: SearchX,
                  title: "No Events match your filters",
                  description: "Try adjusting or clearing your filters.",
                  action: (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setKindPrefix(ANY);
                        setSubjectType(ANY);
                        setProjectId(ANY);
                        setBefore(null);
                      }}
                    >
                      Clear filters
                    </Button>
                  ),
                }
              : before !== null
                ? {
                    icon: ScrollText,
                    title: "Nothing older",
                    description: "You have reached the beginning of the log.",
                  }
                : {
                    icon: ScrollText,
                    title: "Nothing yet",
                    description: "Events will appear here as soon as anything happens.",
                  }
          }
        />
      )}

      {open !== null ? (
        <pre
          aria-label={`Payload of ${String(open)}`}
          className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs"
        >
          {JSON.stringify(rows.find((row) => row.seq === open)?.payload ?? null, null, 2)}
        </pre>
      ) : null}

      {events.data && events.data.events.length === PAGE && events.data.nextCursor !== null ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => setBefore(events.data.nextCursor)}>
            Older
          </Button>
        </div>
      ) : null}
    </SettingsPage>
  );
}
