import { matchQuery, useQueryClient, type Query, type QueryKey } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { client, orpc } from "@/lib/orpc";

/** What one Event may have changed on screen, by what it was about. */
export interface LiveEvent {
  subjectType: string;
  projectId: string | null;
}

/**
 * The queries an Event could have changed. Every Event touches the log; what
 * else it touches follows from its subject, so a Run's Activity re-reads Runs
 * and the inbox and nothing about Members. The list errs towards re-reading:
 * an Issue Event covers its comments, Documents and Links too, because those
 * are shown on the same screen and their Events are Issue Events.
 */
export function keysFor(event: LiveEvent): QueryKey[] {
  const keys: QueryKey[] = [orpc.events.key()];
  switch (event.subjectType) {
    case "issue":
      keys.push(orpc.issues.key(), orpc.comments.key(), orpc.links.key(), orpc.inbox.key());
      break;
    case "run":
      keys.push(orpc.runs.key(), orpc.inbox.key());
      break;
    case "project":
      keys.push(orpc.projects.key(), orpc.issues.key());
      break;
    case "member":
      // me.get carries the caller's role and suspension, which are Member Events.
      keys.push(orpc.members.key(), orpc.agents.key(), orpc.inbox.key(), orpc.me.key());
      break;
    case "allowlist_rule":
      keys.push(orpc.allowlist.key());
      break;
    case "invitation":
      // A Member joined by one, or an admin issued or revoked one: the Invited
      // row and the Members list are both a screen behind until they re-read.
      keys.push(orpc.invitations.key(), orpc.members.key());
      break;
    case "channel":
      keys.push(orpc.channels.key(), orpc.routing.key());
      break;
    case "webhook":
      keys.push(orpc.webhooks.key());
      break;
    case "workspace":
      // routing.updated is a Workspace Event, and me.get carries the Workspace's name.
      keys.push(orpc.workspace.key(), orpc.routing.key(), orpc.me.key());
      break;
    default:
      if (event.projectId) keys.push(orpc.issues.key());
  }
  return keys;
}

/** How long invalidations are gathered before one pass re-reads each key once. */
export const COALESCE_MS = 16;

/**
 * Whether an Event could still change what a query holds. A finished Run's
 * detail never changes — its Activities are written, its clocks stopped — so
 * an Issue with twenty-five finished Runs does not re-read all of them on
 * every Activity tick of the one still working (review of #8, item 3).
 */
export function stillChanging(query: Query): boolean {
  if (!matchQuery({ queryKey: orpc.runs.get.key() }, query)) return true;
  const data = query.state.data as { finishedAt?: unknown } | undefined;
  return !data?.finishedAt;
}

/**
 * Keeps this browser in step with the Workspace by reading the Event log as it
 * happens (docs/plans/m1.md slice 7). Every Event invalidates the queries that
 * could show it, so nothing here decides what changed: the Event log does.
 *
 * Invalidations are coalesced: an Agent posting an Activity a second while a
 * list, a peek and the inbox are all mounted must cost one refetch per key per
 * tick, not one per Event per key (docs/plans/ui-redesign.md, slice 1).
 */
export function useLiveEvents(enabled: boolean) {
  const queryClient = useQueryClient();
  const cursor = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let stopped = false;

    const pending = new Map<string, QueryKey>();
    let flush: ReturnType<typeof setTimeout> | null = null;
    function invalidateLater(keys: QueryKey[]) {
      for (const key of keys) pending.set(JSON.stringify(key), key);
      flush ??= setTimeout(() => {
        flush = null;
        const batch = [...pending.values()];
        pending.clear();
        void Promise.all(
          batch.map((queryKey) =>
            queryClient.invalidateQueries({ queryKey, predicate: stillChanging }),
          ),
        );
      }, COALESCE_MS);
    }

    async function run() {
      // Reconnect from the last seq seen, so a drop costs nothing.
      while (!stopped) {
        // A stream that ends of its own accord is not a failure. On Workers
        // every stream does: it spends its query budget and signs off with a
        // heartbeat carrying the cursor it reached, so the next one resumes
        // exactly and the board is one poll behind rather than two seconds
        // behind (docs/plans/m3.md slice 7). A stream that ends having said
        // nothing at all is a different thing — nothing to resume from, and
        // reconnecting at once would be a hot loop — so it waits like a
        // failure does.
        let delivered = 0;
        try {
          const stream = await client.events.subscribe(
            { after: cursor.current },
            { signal: controller.signal },
          );
          for await (const message of stream) {
            if (stopped) return;
            delivered += 1;
            if (message.type === "heartbeat") {
              cursor.current = message.cursor ?? cursor.current;
              continue;
            }
            cursor.current = message.event.seq;
            invalidateLater(keysFor(message.event));
          }
          if (delivered > 0) continue;
        } catch {
          if (stopped) return;
        }
        // The stream failed, or ended before it said anything; wait a moment.
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    void run();
    return () => {
      stopped = true;
      controller.abort();
      if (flush) clearTimeout(flush);
    };
  }, [enabled, queryClient]);
}
