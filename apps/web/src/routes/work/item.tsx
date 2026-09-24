import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { MemberChip } from "@/components/member-chip";
import { PageHeader } from "@/components/page-header";
import { RailHeading } from "@/components/rail-heading";
import { RunStatus, type RunStatusValue } from "@/components/run-status";
import { ItemEvents } from "@/components/item-events";
import { Badge } from "@/components/ui/badge";
import { NotFoundPage, isNotFound } from "@/routes/not-found";
import { orpc } from "@/lib/orpc";
import { ago } from "@/lib/time";
import { providerLabel } from "@/lib/providers";

/**
 * One record, as deevy knows it: `/work/$issueId` (docs/plans/sockets.md).
 *
 * Nothing here is editable, and that is the design rather than a gap: the
 * record belongs to the team's own tool, deevy authors none of it (ADR-0024),
 * and a field that pretended otherwise would be a second place to write the
 * same sentence. What deevy has to add is underneath — the Runs, the Gates and
 * the Events — and the way back to the conversation is a link.
 */
export function WorkItemPage({ issueId }: { issueId: string }) {
  const issue = useQuery(orpc.issues.get.queryOptions({ input: { issue: issueId } }));
  const runs = useQuery(orpc.runs.list.queryOptions({ input: { issue: issueId, limit: 20 } }));
  const gates = useQuery(orpc.gates.list.queryOptions({ input: { issueId, limit: 20 } }));
  const links = useQuery(orpc.links.list.queryOptions({ input: { issue: issueId } }));

  if (issue.isError && isNotFound(issue.error)) {
    return <NotFoundPage what="record" detail={issue.error.message} />;
  }
  if (issue.isPending) return <p className="text-muted-foreground">Loading the record…</p>;
  if (issue.isError) return <p className="text-sm text-destructive">{issue.error.message}</p>;

  const record = issue.data;
  const asked = gates.data?.gates ?? [];
  const where = providerLabel(record.project?.trackerScopeKey?.split(":")[0]);

  return (
    <div className="@container flex flex-1 flex-col gap-6">
      <PageHeader
        title={record.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <a
              href={record.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
            >
              {record.externalKey}
              <ExternalLink aria-hidden className="size-3" />
            </a>
            <Badge variant="outline">{record.stateName}</Badge>
            {record.assignee ? (
              <span className="flex items-center gap-1 text-xs">
                routed to <MemberChip member={record.assignee as never} size="inline" />
              </span>
            ) : null}
            <span className="text-xs">changed {ago(record.externalUpdatedAt)}</span>
          </span>
        }
      />

      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          {record.body ? (
            <section aria-label="What the record says">
              <Markdown>{record.body}</Markdown>
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">This record has no description.</p>
          )}

          {/* Where the composer used to be. The conversation is the tracker's,
              and two places to say one thing is one too many. */}
          <a
            href={record.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
          >
            Read the conversation on {where}
            <ExternalLink aria-hidden className="size-3" />
          </a>

          <ItemEvents issueId={record.id} />
        </div>

        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <RailHeading>Runs</RailHeading>
            {(runs.data?.runs ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No Runs yet.</p>
            ) : (
              <ul aria-label="Runs" className="flex flex-col gap-2">
                {(runs.data?.runs ?? []).map((run) => (
                  <li key={run.id}>
                    <Link
                      to="/runs/$runId"
                      params={{ runId: run.id }}
                      className="flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-accent"
                    >
                      <RunStatus status={run.status as RunStatusValue} />
                      <span className="flex-1 truncate text-muted-foreground">
                        {run.summary ?? run.trigger}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <RailHeading>Gates</RailHeading>
            {asked.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing has been asked here.</p>
            ) : (
              <ul aria-label="Gates" className="flex flex-col gap-2">
                {asked.map((gate) => (
                  <li key={gate.id}>
                    <Link
                      to="/gates/$requestId"
                      params={{ requestId: gate.id }}
                      className="flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-accent"
                    >
                      <Badge variant="outline">{gate.checkpoint}</Badge>
                      <span className="flex-1 truncate text-muted-foreground">{gate.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(links.data?.links ?? []).length > 0 ? (
            <section className="flex flex-col gap-2">
              <RailHeading>Links</RailHeading>
              <ul aria-label="Links" className="flex flex-col gap-1">
                {(links.data?.links ?? []).map((link) => (
                  <li key={link.id}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm hover:underline"
                    >
                      {link.title}
                      <ExternalLink aria-hidden className="size-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
