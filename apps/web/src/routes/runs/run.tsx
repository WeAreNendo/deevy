import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { MemberChip } from "@/components/member-chip";
import { PageHeader } from "@/components/page-header";
import { Markdown } from "@/components/markdown";
import { RailHeading } from "@/components/rail-heading";
import { RunStatus, type RunStatusValue } from "@/components/run-status";
import { Badge } from "@/components/ui/badge";
import { NotFoundPage, isNotFound } from "@/routes/not-found";
import { orpc } from "@/lib/orpc";
import { useMembersById } from "@/lib/members";
import { ago } from "@/lib/time";

/** How an Activity reads, by kind: the Agent's voice, a Human's, an error. */
const tones: Record<string, string> = {
  thought: "text-muted-foreground italic",
  action: "",
  elicitation: "text-gate-foreground dark:text-gate",
  response: "text-agent",
  error: "font-mono text-destructive",
  prompt: "text-human",
};

/**
 * One Run: `/runs/$runId` (docs/plans/sockets.md, slice 3).
 *
 * The feed in time order, and beside it the Gates this Run asked for — which
 * is where a Run stops, and the only thing on the page a Human acts on.
 */
export function RunPage({ runId }: { runId: string }) {
  const run = useQuery(orpc.runs.get.queryOptions({ input: { runId } }));
  const gates = useQuery(orpc.gates.list.queryOptions({ input: { runId } }));
  const nameOf = useMembersById();

  if (run.isError && isNotFound(run.error)) {
    return <NotFoundPage what="Run" detail={run.error.message} />;
  }
  if (run.isPending) return <p className="text-muted-foreground">Loading the Run…</p>;
  if (run.isError) return <p className="text-sm text-destructive">{run.error.message}</p>;

  const found = run.data;
  const agent = nameOf(found.agentMemberId);
  const asked = gates.data?.gates ?? [];

  return (
    <div className="@container flex flex-1 flex-col gap-6">
      <PageHeader
        title={<span className="font-mono">{found.issueKey}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <RunStatus status={found.status as RunStatusValue} />
            {agent ? <MemberChip member={agent} size="inline" /> : null}
            <span className="text-xs">started by {found.trigger}</span>
            <span aria-hidden>·</span>
            <span className="text-xs">{ago(found.lastActivityAt)}</span>
          </span>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <section className="flex min-w-0 flex-col gap-2">
          <RailHeading>Activity</RailHeading>
          {found.activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ol aria-label={`Activity of ${found.id}`} className="flex flex-col gap-2">
              {found.activities.map((activity) => (
                <li
                  key={activity.id}
                  data-kind={activity.kind}
                  className="flex flex-col gap-0.5 border-l-2 pl-3"
                >
                  {/* An Agent writes its Activities in markdown, a Proposal most of all:
                      read here in full, so rendered, in the kind's own tone. */}
                  <Markdown className={`text-sm ${tones[activity.kind] ?? ""}`}>
                    {activity.body}
                  </Markdown>
                  <span className="text-xs text-muted-foreground">{ago(activity.createdAt)}</span>
                </li>
              ))}
            </ol>
          )}
          {found.summary ? (
            <p className="rounded-md border bg-card p-3 text-sm">{found.summary}</p>
          ) : null}
        </section>

        <div className="flex flex-col gap-6 -order-1 @3xl:order-none">
          <section className="flex flex-col gap-2">
            <RailHeading>Gates</RailHeading>
            {asked.length === 0 ? (
              <p className="text-sm text-muted-foreground">This Run has asked for nothing yet.</p>
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
                      <span className="flex-1 truncate text-muted-foreground">
                        {gate.status === "open"
                          ? `${gate.approvals} of ${gate.policy.approvalsRequired}`
                          : gate.status}
                      </span>
                      <ExternalLink aria-hidden className="size-3 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
