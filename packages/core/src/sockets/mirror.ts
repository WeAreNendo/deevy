import { delivery as deliveryTable, type Db, type Event } from "@deevy/db";
import { newId } from "../ids.ts";
import type { EventKind } from "../events.ts";

/**
 * What deevy says back where the work lives (ADR-0024).
 *
 * The whole point of the Sockets milestone is that a team keeps reading their
 * own tracker: so a Gate an Agent is waiting at, and the ruling that let it
 * past, show up as comments on the record itself. A Human who never opens
 * deevy still knows what is happening, and follows the comment's link to rule
 * on it, in deevy, where every Ruling is made (ADR-0036).
 *
 * The derivation is the fourth in `appendEvent`'s tail, after the webhook one,
 * and it owes a `delivery` row exactly as those do: the row is the record that
 * something is owed, and the words are rendered at send time from the Event.
 * Nothing is copied into the row, because the Event is the source (ADR-0003).
 */

/**
 * The kinds a Socket announces: a Gate waiting, and what was ruled on it
 * (docs/plans/simplify.md, slice 4). Nothing about a Run is said on the
 * record — starting, working and finishing are no decision anybody has to
 * make — and no setting turns a Gate's announcement off, because a team that
 * never opens deevy has to see what is waiting on it.
 */
const announcedKinds: ReadonlySet<string> = new Set<EventKind>([
  "gate.requested",
  "gate.approval",
  "gate.approved",
  "gate.rejected",
]);

/**
 * Whether this kind is announced at all. Pure, because this runs in the tail
 * of every write deevy makes: the busy paths — a record arriving, a Run
 * starting — must not pay for a Project lookup to be told they have nothing
 * to say.
 */
export function announces(kind: string): boolean {
  return announcedKinds.has(kind);
}

/**
 * The delivery a Project's tracker is owed for this Event, if any.
 *
 * One row per Event: a Project has one tracker, and the same Event mirrored
 * twice would be the same comment twice.
 */
export async function deriveSocketMirrors(db: Db, event: Event): Promise<string[]> {
  if (!announces(event.kind) || !event.projectId) return [];
  const project = await db.query.project.findFirst({
    where: { id: event.projectId },
    columns: { trackerSocketId: true },
  });
  if (!project) return [];

  const [row] = await db
    .insert(deliveryTable)
    .values({
      id: newId("delivery"),
      workspaceId: event.workspaceId,
      target: "socket" as const,
      targetId: project.trackerSocketId,
      eventSeq: event.seq,
    })
    // One attempt owed per tracker per Event, which the unique index holds
    // rather than this being the only careful writer (docs/plans/m3.md).
    .onConflictDoNothing()
    .returning({ id: deliveryTable.id });
  return row ? [row.id] : [];
}

export interface MirrorSubject {
  /** The Checkpoint a Gate is about, and what the Agent proposed. */
  gate?: {
    id: string;
    checkpoint: string;
    proposal: string;
    links: { url: string; title: string }[];
  } | null;
  /** Who was working, for the signature line. */
  agentName?: string | null;
  runId?: string | null;
  /** Where a Human rules on it, in deevy. */
  origin?: string;
}

/**
 * Every comment ends the same way, because the tracker shows deevy's own App
 * as the author: a reader has to be able to tell which Agent spoke and which
 * attempt it was, without opening deevy to find out.
 */
function signature(subject: MirrorSubject): string {
  const who = subject.agentName ?? "A deevy Agent";
  return `— ${who}${subject.runId ? ` · ${subject.runId}` : ""} · via deevy`;
}

/**
 * A comment as its paragraphs, with a blank line between each. Markdown reads
 * a line that follows a list or a quote with none as more of it, which is how
 * the first real GitHub walk found the footer folded into the last link.
 */
function paragraphs(...blocks: string[]): string {
  return blocks.filter((block) => block.trim() !== "").join("\n\n");
}

/** A Human's note as a quote, every line of it. */
function quoted(note: string): string {
  return note
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
}

/** The comment the tracker is given for this Event, or null when it is told nothing. */
export function mirrorFor(
  event: Pick<Event, "kind" | "payload">,
  subject: MirrorSubject,
): string | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const text = (key: string): string =>
    typeof payload[key] === "string" ? (payload[key] as string) : "";
  const number = (key: string): number | null =>
    typeof payload[key] === "number" ? (payload[key] as number) : null;
  const url = subject.gate && subject.origin ? `${subject.origin}/gates/${subject.gate.id}` : null;

  if (event.kind === "gate.requested") {
    const gate = subject.gate;
    if (!gate) return null;
    const links = gate.links.map((link) => `- [${link.title}](${link.url})`).join("\n");
    return paragraphs(
      `**Waiting on a ruling at the \`${gate.checkpoint}\` Checkpoint.**`,
      gate.proposal,
      links,
      // Where to rule, which is in deevy and nowhere else (ADR-0036): a
      // reply here is a comment, and says nothing to the Gate.
      url ? `Rule on it in deevy: ${url}` : "Rule on it in deevy.",
      signature(subject),
    );
  }

  if (event.kind === "gate.approval") {
    const approvals = number("approvals") ?? 0;
    const required = number("required") ?? 0;
    const note = text("note");
    return paragraphs(
      `Approved: **${String(approvals)} of ${String(required)}**${
        approvals < required ? ", still waiting" : ""
      }.`,
      note ? quoted(note) : "",
      signature(subject),
    );
  }

  if (event.kind === "gate.approved" || event.kind === "gate.rejected") {
    const approved = event.kind === "gate.approved";
    const note = text("note");
    const approvals = number("approvals");
    const required = number("required");
    // A Gate an admin passed by lowering Approvals says so, rather than
    // reading as though the last approval had met the count.
    const loweredFrom = number("loweredFrom");
    const lowered =
      loweredFrom !== null && required !== null
        ? `, once Approvals was lowered from ${String(loweredFrom)} to ${String(required)}`
        : "";
    return paragraphs(
      approved
        ? `**Approved** at the \`${text("checkpoint")}\` Checkpoint${
            approvals !== null && required !== null
              ? ` — ${String(approvals)} of ${String(required)}`
              : ""
          }${lowered}.`
        : `**Rejected** at the \`${text("checkpoint")}\` Checkpoint.`,
      note ? quoted(note) : "",
      signature(subject),
    );
  }

  return null;
}
