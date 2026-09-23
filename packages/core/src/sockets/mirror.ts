import { delivery as deliveryTable, type Db, type Event, type Project } from "@deevy/db";
import { newId } from "../ids.ts";
import type { EventKind } from "../events.ts";

/**
 * What deevy says back where the work lives (ADR-0024).
 *
 * The whole point of the Sockets milestone is that a team keeps reading their
 * own tracker: so a Gate an Agent is waiting at, and the ruling that let it
 * past, show up as comments on the record itself. A Human who never opens
 * deevy still knows what is happening, and can rule from there once ADR-0025's
 * identities land.
 *
 * The derivation is the fourth in `appendEvent`'s tail, after the webhook one,
 * and it owes a `delivery` row exactly as those do: the row is the record that
 * something is owed, and the words are rendered at send time from the Event.
 * Nothing is copied into the row, because the Event is the source (ADR-0003).
 */

/** What a Gate's mirrored comment marks the record with while it waits. */
export const AWAITING_LABEL = "deevy:awaiting-approval";

/** The kinds a Project that mirrors Gates says something about. */
const gateKinds: ReadonlySet<string> = new Set<EventKind>([
  "gate.requested",
  "gate.approval",
  "gate.approved",
  "gate.rejected",
  // A Ruling made in the tracker that ruled nothing is answered where it was
  // made, because that is where its author is reading (ADR-0025).
  "gate.ruling_refused",
]);

/** And the ones it adds when a Project mirrors Runs as well. */
const runKinds: ReadonlySet<string> = new Set<EventKind>([
  "run.started",
  "run.completed",
  "run.failed",
]);

/**
 * Whether this kind is worth a comment at all, before anything is read.
 *
 * Pure and first, because this runs in the tail of every write deevy makes:
 * the busy paths — a record syncing, a comment arriving — must not pay for a
 * Project lookup to be told they have nothing to say.
 */
export function mirrorsKind(kind: string, mirror: Project["mirror"]): boolean {
  if (mirror === "off") return false;
  if (gateKinds.has(kind)) return true;
  return mirror === "runs" && runKinds.has(kind);
}

/** Which kinds could ever mirror, whatever a Project is set to. */
export function couldMirror(kind: string): boolean {
  return gateKinds.has(kind) || runKinds.has(kind);
}

/**
 * The delivery a Project's tracker is owed for this Event, if any.
 *
 * One row per Event: a Project has one tracker, and the same Event mirrored
 * twice would be the same comment twice.
 */
export async function deriveSocketMirrors(db: Db, event: Event): Promise<string[]> {
  if (!couldMirror(event.kind) || !event.projectId) return [];
  // A Ruling refused in Slack was answered in Slack, to the one who clicked:
  // telling the record's tracker too would say it to everybody else
  // (sockets/chat.ts).
  if (event.kind === "gate.ruling_refused" && payloadVia(event) === "slack") return [];

  const project = await db.query.project.findFirst({
    where: { id: event.projectId },
    columns: { mirror: true, trackerSocketId: true },
  });
  if (!project || !mirrorsKind(event.kind, project.mirror)) return [];

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

function payloadVia(event: Event): string | null {
  const via = (event.payload as { via?: unknown } | null)?.via;
  return typeof via === "string" ? via : null;
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
  /** Where a Human opens the ruling in deevy. */
  origin?: string;
}

/** What one Event becomes in a tracker: something to say, something to label. */
export interface MirrorAction {
  comment: string;
  labels: { add: string[]; remove: string[] };
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

/** What the tracker is told about this Event, or null when it is told nothing. */
export function mirrorFor(
  event: Pick<Event, "kind" | "payload">,
  subject: MirrorSubject,
): MirrorAction | null {
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
    return {
      comment: [
        `**Waiting on a ruling at the \`${gate.checkpoint}\` Checkpoint.**`,
        "",
        gate.proposal,
        links ? `\n${links}` : "",
        "",
        // The two ways to answer: here, in a comment, or in deevy. Both end up
        // in the same place (ADR-0025).
        "Reply `/approve` or `/reject <why>` to rule from here.",
        url ? `Or open it in deevy: ${url}` : "",
        "",
        signature(subject),
      ]
        .filter((line) => line !== "")
        .join("\n"),
      labels: { add: [AWAITING_LABEL], remove: [] },
    };
  }

  if (event.kind === "gate.approval") {
    const approvals = number("approvals") ?? 0;
    const required = number("required") ?? 0;
    const note = text("note");
    return {
      comment: [
        `Approved: **${String(approvals)} of ${String(required)}**${
          approvals < required ? ", still waiting" : ""
        }.`,
        note ? `\n> ${note}` : "",
        "",
        signature(subject),
      ]
        .filter((line) => line !== "")
        .join("\n"),
      // Still waiting, so the label stays.
      labels: { add: [], remove: [] },
    };
  }

  if (event.kind === "gate.approved" || event.kind === "gate.rejected") {
    const approved = event.kind === "gate.approved";
    const note = text("note");
    const approvals = number("approvals");
    const required = number("required");
    return {
      comment: [
        approved
          ? `**Approved** at the \`${text("checkpoint")}\` Checkpoint${
              approvals !== null && required !== null
                ? ` — ${String(approvals)} of ${String(required)}`
                : ""
            }.`
          : `**Rejected** at the \`${text("checkpoint")}\` Checkpoint.`,
        note ? `\n> ${note}` : "",
        "",
        signature(subject),
      ]
        .filter((line) => line !== "")
        .join("\n"),
      // Whatever was decided, nothing is waiting on this record any more.
      labels: { add: [], remove: [AWAITING_LABEL] },
    };
  }

  if (event.kind === "gate.ruling_refused") {
    const who = text("externalActor");
    const origin = subject.origin ?? "";
    const why =
      text("reason") === "unknown_identity"
        ? `This account isn't linked to anybody in deevy yet: link it at ${origin}/settings/identities, then say it again.`
        : text("reason") === "nothing_waiting"
          ? "Nothing on this record is waiting on a ruling."
          : text("message") || "deevy would not take it.";
    return {
      comment: [`${who ? `@${who}, that` : "That"} ruled nothing. ${why}`, "", "— deevy"].join(
        "\n",
      ),
      // Nothing changed, so nothing about the record's labels does either.
      labels: { add: [], remove: [] },
    };
  }

  if (event.kind === "run.started") {
    return {
      comment: [
        `A deevy Agent started work here, by ${text("trigger") || "assignment"}.`,
        "",
        signature(subject),
      ].join("\n"),
      labels: { add: [], remove: [] },
    };
  }

  if (event.kind === "run.completed" || event.kind === "run.failed") {
    const summary = text("summary");
    return {
      comment: [
        event.kind === "run.completed" ? "**Finished.**" : "**Failed.**",
        summary ? `\n${summary}` : "",
        "",
        signature(subject),
      ]
        .filter((line) => line !== "")
        .join("\n"),
      labels: { add: [], remove: [] },
    };
  }

  return null;
}
