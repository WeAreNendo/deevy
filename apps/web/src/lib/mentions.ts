import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ChipMember } from "@/components/member-chip";
import { orpc } from "@/lib/orpc";

/**
 * Who a `@` may name in this Workspace: every Member, by handle
 * (packages/core/src/mentions.ts resolves the same set). Read once and shared
 * through the query cache, so a screen costs no request of its own.
 */
export function useMembersById(): Map<string, ChipMember & { sponsorId: string | null }> {
  const members = useQuery(orpc.members.list.queryOptions({ input: {} }));
  return useMemo(
    () => new Map((members.data?.members ?? []).map((member) => [member.id, member])),
    [members.data],
  );
}

/**
 * What `describeEvent` needs to name what an older payload only numbers: a
 * Member by id. New Events carry the names themselves (lib/event-text.ts), so
 * this is the fallback the Event log has rather than builds.
 */
export function useEventContext() {
  const memberById = useMembersById();
  return useMemo(
    () => ({ memberName: (id: string) => memberById.get(id)?.user.name ?? null }),
    [memberById],
  );
}
