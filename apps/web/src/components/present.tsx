import { MemberChip } from "@/components/member-chip";
import { useMembersById } from "@/lib/mentions";
import { presenceIn, useRoom } from "@/lib/rooms";

/**
 * Who else is in this Document right now. Carets say where they are; this says
 * that they are here at all, which is what stops two people starting the same
 * paragraph (docs/plans/collaborative-documents.md).
 *
 * An Agent is never here: it writes markdown through `documents.write` and
 * never joins a room (ADR-0021).
 */
export function Present({ room: name }: { room: string | undefined }) {
  const room = useRoom(name);
  const members = useMembersById();
  const others = presenceIn(room).filter((one) => !one.self);
  if (others.length === 0) return null;

  return (
    <span
      role="group"
      aria-label="Also in this Document"
      className="flex items-center gap-1"
      title={others.map((one) => one.name).join(", ")}
    >
      {others.map((one) => {
        const member = members.get(one.id);
        return member ? (
          <MemberChip key={one.id} member={member} size="inline" avatarOnly />
        ) : (
          <span key={one.id} className="text-xs text-muted-foreground">
            {one.name}
          </span>
        );
      })}
    </span>
  );
}
