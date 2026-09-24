import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { GateControls } from "@/components/gate-controls";
import { Markdown } from "@/components/markdown";
import { MemberChip } from "@/components/member-chip";
import { PageHeader } from "@/components/page-header";
import { RunStatus, type RunStatusValue } from "@/components/run-status";
import { RailHeading } from "@/components/rail-heading";
import { plainLine } from "@/lib/plain-text";
import { NotFoundPage } from "@/routes/not-found";
import { Badge } from "@/components/ui/badge";
import { orpc } from "@/lib/orpc";
import { isNotFound } from "@/routes/not-found";
import { providerLabel } from "@/lib/providers";
import { useMembersById } from "@/lib/members";
import { ago } from "@/lib/time";

/**
 * The ruling screen: `/gates/$requestId` (docs/plans/sockets.md, slice 3).
 *
 * It is the one link an Agent hands a Human, so it has to answer four things
 * at a glance: what is being proposed, which record it is about, where the
 * count stands, and whether this Human may rule. Everything else — the Run's
 * feed, the Rulings so far — is context in the rail.
 */
export function GatePage({ requestId, focused = true }: { requestId: string; focused?: boolean }) {
  const gate = useQuery(orpc.gates.get.queryOptions({ input: { requestId } }));
  const issueId = gate.data?.issueId;
  const issue = useQuery({
    ...orpc.issues.get.queryOptions({ input: { issue: issueId ?? "" } }),
    enabled: Boolean(issueId),
  });
  const run = useQuery({
    ...orpc.runs.get.queryOptions({ input: { runId: gate.data?.runId ?? "" } }),
    enabled: Boolean(gate.data?.runId),
  });
  const nameOf = useMembersById();

  if (gate.isError && isNotFound(gate.error)) {
    return <NotFoundPage what="Gate" detail={gate.error.message} />;
  }
  if (gate.isPending) return <p className="text-muted-foreground">Loading the Gate…</p>;
  if (gate.isError) return <p className="text-sm text-destructive">{gate.error.message}</p>;

  const found = gate.data;
  const record = issue.data;
  const agent = nameOf(found.requestedBy);

  return (
    <div className="@container flex flex-1 flex-col gap-6">
      <PageHeader
        title={record?.title ?? found.run.issueKey}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {/* The record is the tracker's; the key is the way back to it. */}
            {record ? (
              <a
                href={record.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
              >
                {record.externalKey}
                <ExternalLink aria-hidden className="size-3" />
              </a>
            ) : (
              <span className="font-mono text-xs">{found.run.issueKey}</span>
            )}
            <span aria-hidden>·</span>
            <span>
              {agent ? (
                <MemberChip member={agent} size="inline" />
              ) : (
                <span className="text-xs">An Agent</span>
              )}{" "}
              asked at the <span className="font-medium">{found.checkpoint}</span> Checkpoint
              {found.visit > 1 ? `, visit ${String(found.visit)}` : ""}
            </span>
            <span aria-hidden>·</span>
            <span className="text-xs">{ago(found.askedAt)}</span>
          </span>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-label="Proposal" className="flex flex-col gap-2">
            <Markdown>{found.proposal}</Markdown>
          </section>

          {found.links.length > 0 ? (
            <section aria-label="Evidence" className="flex flex-col gap-2">
              <RailHeading>Evidence</RailHeading>
              <ul className="flex flex-col gap-1">
                {found.links.map((link) => (
                  <li key={link.url}>
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

        {/* The rail: the ruling first, then what was already said, then the
            Run that stopped here — the order a Human reads them in. */}
        <div className="flex flex-col gap-6 -order-1 @3xl:order-none">
          <GateControls gate={found} focused={focused && found.status === "open"} />

          <section className="flex flex-col gap-2">
            <RailHeading>Gate decisions</RailHeading>
            {found.decisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody has ruled yet.</p>
            ) : (
              <ul aria-label="Gate decisions" className="flex flex-col gap-2">
                {found.decisions.map((decision) => {
                  const who = nameOf(decision.memberId);
                  return (
                    <li key={decision.id} className="flex flex-col gap-1 rounded-md border p-2">
                      <span className="flex flex-wrap items-center gap-2 text-sm">
                        {who ? <MemberChip member={who} size="inline" /> : <span>Somebody</span>}
                        <Badge
                          variant="outline"
                          className={
                            decision.decision === "approved"
                              ? "border-state-done/40 text-state-done"
                              : "border-destructive/40 text-destructive"
                          }
                        >
                          {decision.decision === "approved" ? "Approved" : "Rejected"}
                        </Badge>
                        {/* Where it was made, which is what ADR-0025 is about. */}
                        <span className="text-xs text-muted-foreground">
                          {decision.via === "web"
                            ? "in deevy"
                            : decision.via === "slack"
                              ? "in Slack"
                              : `via ${providerLabel(decision.socket?.provider, decision.socket?.name)}`}
                          {/* The weak proof, said wherever the Ruling is shown:
                              the tool only reported an address (ADR-0025). */}
                          {decision.verifiedBy === "email" ? " (email)" : ""}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {ago(decision.createdAt)}
                        </span>
                      </span>
                      {decision.note ? <p className="text-sm">{decision.note}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {run.data ? (
            <section className="flex flex-col gap-2">
              <RailHeading>The Run that stopped here</RailHeading>
              <div className="flex items-center gap-2">
                <RunStatus status={run.data.status as RunStatusValue} />
                <span className="font-mono text-xs text-muted-foreground">{found.runId}</span>
              </div>
              <ol
                aria-label={`Activity of ${found.runId}`}
                className="flex flex-col gap-1 text-sm text-muted-foreground"
              >
                {run.data.activities.slice(-6).map((activity) => (
                  <li key={activity.id} data-kind={activity.kind} className="truncate">
                    {plainLine(activity.body)}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
