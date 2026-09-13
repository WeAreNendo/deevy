import { MemberChip } from "@/components/member-chip";
import { useMembersById } from "@/lib/mentions";
import { JUST_WROTE_MS, presenceIn, useRoom } from "@/lib/rooms";

/**
 * Who else is in this Document, and what an Agent has just done to it
 * (docs/plans/collaborative-documents.md).
 *
 * Carets say where the other Humans are; the avatars here say that they are
 * here at all, which is what stops two people starting the same paragraph. An
 * Agent gets neither: it never joins a room (ADR-0021), its write arrives as a
 * block rather than as typing, and a cursor for something that is not there to
 * follow would be a lie. It gets a line instead, for as long as the change it
 * made is still a surprise.
 */
export function Present({ room: name }: { room: string | undefined }) {
  const room = useRoom(name);
  const members = useMembersById();
  const here = presenceIn(room).filter((one) => !one.self);
  const humans = here.filter((one) => one.kind !== "agent");
  const wrote = here.find(
    (one) => one.kind === "agent" && one.wroteAt && Date.now() - one.wroteAt < JUST_WROTE_MS,
  );
  if (humans.length === 0 && !wrote) return null;

  return (
    <>
      {humans.length > 0 ? (
        <span
          role="group"
          aria-label="Also in this Document"
          className="flex items-center gap-1"
          title={humans.map((one) => one.name).join(", ")}
        >
          {humans.map((one) => {
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
      ) : null}
      {wrote ? (
        <span role="status" className="text-xs text-agent">
          {wrote.name} just wrote this
        </span>
      ) : null}
    </>
  );
}
