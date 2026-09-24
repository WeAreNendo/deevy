/**
 * What a Notification says, precisely (docs/plans/ui-redesign-2.md slice C):
 * the actor is drawn as a chip by the caller; this gives the verb with its
 * object — which Gate, which State — the tone the row takes, and the words
 * a Human or an Agent wrote when there are any: the comment, the note, the
 * question, the summary. Everything comes from the Event the row carries.
 */
import type { EventTone } from "@/lib/event-text";
import { plainLine } from "@/lib/plain-text";

/** A Notification speaks in the same tones an Event does; one palette serves both. */
export type NotificationTone = EventTone;

export interface NotificationText {
  verb: string;
  excerpt: string | null;
  tone: NotificationTone;
}

export interface DescribableNotification {
  kind: string;
  issue: { externalKey: string; title: string } | null;
  event: { kind: string; payload: unknown };
  comment?: { id: string; body: string | null } | null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * The row's words, with the excerpt as one line: what an Agent or a Human wrote
 * is markdown, and a quote in a list is not the place to render it.
 */
export function describeNotification(row: DescribableNotification): NotificationText {
  const said = describe(row);
  return { ...said, excerpt: said.excerpt === null ? null : plainLine(said.excerpt) || null };
}

function describe(row: DescribableNotification): NotificationText {
  const payload =
    row.event.payload && typeof row.event.payload === "object" && !Array.isArray(row.event.payload)
      ? (row.event.payload as Record<string, unknown>)
      : {};

  switch (row.kind) {
    case "assignment":
      return {
        verb: payload.byRouting ? "routed it to you" : "assigned it to you",
        excerpt: null,
        tone: "human",
      };
    case "mention": {
      if (row.event.kind.startsWith("comment.")) {
        return {
          verb: "mentioned you",
          excerpt: row.comment ? (row.comment.body ?? "(the comment was withdrawn)") : null,
          tone: "human",
        };
      }
      const edits = payload as { description?: { to?: unknown }; title?: { to?: unknown } };
      return {
        verb: "mentioned you in the description",
        excerpt: text(edits.description?.to) ?? text(edits.title?.to),
        tone: "human",
      };
    }
    case "delegation":
      /*
       * One line for a whole wave of sub-issues, or for the moment they are all
       * finished (docs/plans/sub-issue-delegation.md). It names the parent,
       * because the parent is the only place the work is whole — and it does
       * not say how many, because the row is written when the first of them is
       * opened and the wave is not finished being opened yet. The excerpt is
       * that first one's title, which is the most useful thing there is.
       */
      return row.event.kind === "issue.children_closed"
        ? { verb: "finished every sub-issue of this", excerpt: null, tone: "agent" }
        : { verb: "opened sub-issues under this", excerpt: text(payload.title), tone: "agent" };
    case "gate_awaiting": {
      // A Gate is a request on a Run, and what a Human needs first is which
      // Checkpoint it stopped at and what it is proposing (ADR-0024).
      const checkpoint = text(payload.checkpoint);
      return {
        verb: checkpoint ? `wants your ruling at ${checkpoint}` : "wants your ruling",
        excerpt: text(payload.question),
        tone: "gate",
      };
    }
    case "run_awaiting_input":
      return { verb: "asks a question", excerpt: text(payload.question), tone: "agent" };
    case "run_finished":
      return row.event.kind === "run.failed"
        ? { verb: "failed a Run", excerpt: text(payload.summary), tone: "destructive" }
        : { verb: "finished a Run", excerpt: text(payload.summary), tone: "agent" };
    case "run_answered": {
      // A Gate ruling carries `ruling` and the Gate's name; a plain answer to
      // an Agent's question carries neither, and claims no ruling.
      const ruling =
        payload.ruling === "rejected"
          ? "rejected"
          : payload.ruling === "approved"
            ? "approved"
            : null;
      if (!ruling) {
        return { verb: "answered your Agent's question", excerpt: null, tone: "muted" };
      }
      return {
        verb: `${ruling} the Gate your Agent asked about`,
        excerpt: text(payload.note),
        tone: "muted",
      };
    }
    default:
      return { verb: row.kind, excerpt: null, tone: "muted" };
  }
}
