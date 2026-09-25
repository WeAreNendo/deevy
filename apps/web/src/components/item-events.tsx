import { useQuery } from "@tanstack/react-query";
import { MemberChip } from "@/components/member-chip";
import { RailHeading } from "@/components/rail-heading";
import { describeEvent } from "@/lib/event-text";
import { useEventContext } from "@/lib/mentions";
import { orpc } from "@/lib/orpc";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  human: "bg-human",
  agent: "bg-agent",
  gate: "bg-gate",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground/40",
};

/**
 * What has happened to one record, in deevy's words (`lib/event-text.ts`).
 *
 * The Activity stream without a composer: the conversation lives in the
 * tracker now, so this is the log of what deevy itself did — synced it, routed
 * it, opened a Run, asked at a Checkpoint (ADR-0024).
 */
export function ItemEvents({ issueId }: { issueId: string }) {
  const events = useQuery(
    orpc.events.list.queryOptions({
      input: { subjectId: issueId, order: "desc", limit: 50 },
    }),
  );
  // Routing writes a Member's id and no name (sockets/apply.ts), so the names
  // come from the Workspace's Members, as the Event log's do.
  const named = useEventContext();
  const rows = (events.data?.events ?? []).map((event) => ({
    event,
    text: describeEvent(
      { kind: event.kind, payload: event.payload, actorKind: event.actor?.kind ?? null },
      named,
    ),
  }));

  return (
    <section className="flex flex-col gap-2">
      <RailHeading>What happened</RailHeading>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ol aria-label="Events" className="flex flex-col gap-2">
          {rows.map(({ event, text }) =>
            text ? (
              <li key={event.seq} className="flex items-baseline gap-2 text-sm">
                <span
                  aria-hidden
                  className={cn(
                    "inline-block size-2.5 shrink-0 translate-y-[4.75px] rounded-full",
                    tones[text.tone] ?? tones.muted,
                  )}
                />
                <span className="flex min-w-0 flex-wrap items-baseline gap-1">
                  {event.actor ? (
                    <MemberChip member={event.actor as never} size="inline" nameOnly />
                  ) : (
                    <span className="text-muted-foreground">deevy</span>
                  )}
                  <span>{text.text}</span>
                  <span className="text-xs text-muted-foreground">{ago(event.createdAt)}</span>
                </span>
              </li>
            ) : null,
          )}
        </ol>
      )}
    </section>
  );
}
