import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { MemberChip } from "@/components/member-chip";
import { PageHeader } from "@/components/page-header";
import { Markdown } from "@/components/markdown";
import { RailHeading } from "@/components/rail-heading";
import { RunStatus, type RunStatusValue } from "@/components/run-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotFoundPage, isNotFound } from "@/routes/not-found";
import { orpc } from "@/lib/orpc";
import { useMembersById } from "@/lib/members";
import { startedBy } from "@/lib/run-trigger";
import { ago } from "@/lib/time";
import {
  dollars,
  duration,
  harnessName,
  harnessesOf,
  tokens,
  totalTokens,
  type UsageTotals,
} from "@/lib/usage";

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
  const navigate = useNavigate();
  // A fresh attempt for the same Agent, asked for by its Sponsor or an admin;
  // anybody else is told so by the server, in its words.
  const retry = useMutation(
    orpc.runs.retry.mutationOptions({
      onSuccess: (fresh) => navigate({ to: "/runs/$runId", params: { runId: fresh.id } }),
    }),
  );

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
            <span className="text-xs">started {startedBy(found.trigger)}</span>
            <span aria-hidden>·</span>
            <span className="text-xs">{ago(found.lastActivityAt)}</span>
          </span>
        }
        actions={
          found.status === "failed" || found.status === "stale" ? (
            <div className="flex flex-col items-end gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={retry.isPending}
                onClick={() => retry.mutate({ runId: found.id })}
              >
                Try again
              </Button>
              {retry.error ? (
                <span className="text-xs text-destructive">{retry.error.message}</span>
              ) : null}
            </div>
          ) : null
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

          <UsageSection usage={found.usage} />

          <section aria-label="Time" className="flex flex-col gap-2">
            <RailHeading>Time</RailHeading>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Working</dt>
              <dd className="tabular-nums">{duration(found.timing.workingMs)}</dd>
              <dt className="text-muted-foreground">Waiting on a Human</dt>
              <dd className="tabular-nums">{duration(found.timing.waitingMs)}</dd>
              <dt className="text-muted-foreground">Queued</dt>
              <dd className="tabular-nums">{duration(found.timing.queuedMs)}</dd>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

/** What the rail reads of a Run's usage (`runs.get`). */
interface RunUsage extends UsageTotals {
  models: Array<{
    harness: string;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number | null;
  }>;
}

/**
 * What the Run spent, as the client running its Agent reported it
 * (docs/plans/run-usage.md). The cost is always the harness's estimate and
 * says whose; where nothing priced the tokens it says that, and deevy never
 * puts a price on them itself.
 */
function UsageSection({ usage }: { usage: RunUsage }) {
  if (usage.reports === 0) {
    return (
      <section aria-label="Usage" className="flex flex-col gap-2">
        <RailHeading>Usage</RailHeading>
        <p className="text-sm">No usage reported</p>
        <p className="text-xs text-muted-foreground">
          Whatever runs this Agent has not said what the Run spent.
        </p>
      </section>
    );
  }
  const by = harnessesOf(usage.models);
  return (
    <section aria-label="Usage" className="flex flex-col gap-2">
      <RailHeading>Usage</RailHeading>
      <p className="text-sm">
        {usage.costUsd === null
          ? `Cost not reported by ${by}`
          : `≈ ${dollars(usage.costUsd)}, estimated by ${by}`}
      </p>
      {usage.costUsd !== null && usage.unpricedTokens > 0 ? (
        <p className="text-xs text-muted-foreground">
          {tokens(usage.unpricedTokens)} tokens were reported with no cost, and are not in it.
        </p>
      ) : null}
      <p className="text-sm tabular-nums">{tokens(totalTokens(usage))} tokens</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Input</dt>
        <dd className="tabular-nums">{tokens(usage.inputTokens)}</dd>
        <dt className="text-muted-foreground">Output</dt>
        <dd className="tabular-nums">{tokens(usage.outputTokens)}</dd>
        <dt className="text-muted-foreground">Cache read</dt>
        <dd className="tabular-nums">{tokens(usage.cacheReadTokens)}</dd>
        <dt className="text-muted-foreground">Cache written</dt>
        <dd className="tabular-nums">{tokens(usage.cacheWriteTokens)}</dd>
      </dl>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          By model ({usage.models.length})
        </summary>
        <ul aria-label="Models" className="mt-1 flex flex-col gap-1">
          {usage.models.map((model) => (
            <li key={`${model.harness}:${model.model ?? ""}`} className="flex flex-col">
              <span className="font-mono">{model.model ?? "a model it did not name"}</span>
              <span className="text-muted-foreground tabular-nums">
                {tokens(totalTokens(model))} tokens ·{" "}
                {model.costUsd === null ? "not priced" : `≈ ${dollars(model.costUsd)}`} ·{" "}
                {harnessName(model.harness)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
