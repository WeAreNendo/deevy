import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";

/** A Member as a chip draws one. */
export interface NamedMember {
  id: string;
  kind: "human" | "agent";
  handle: string | null;
  suspendedAt: Date | null;
  user: { name: string; image: string | null };
}

/**
 * Members by id, for the screens that hold ids and have to show names.
 *
 * One query for the page rather than one per row: a Workspace's Members are a
 * short list the shell has usually asked for already, and the alternative is a
 * lookup in every Ruling, Run and feed line.
 */
export function useMembersById(): (id: string | null | undefined) => NamedMember | null {
  const members = useQuery(orpc.members.list.queryOptions({ input: {} }));
  const byId = new Map(
    (members.data?.members ?? []).map((member) => [member.id, member as unknown as NamedMember]),
  );
  return (id) => (id ? (byId.get(id) ?? null) : null);
}
