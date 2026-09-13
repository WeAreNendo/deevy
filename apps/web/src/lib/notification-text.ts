/**
 * What a Notification says, precisely (docs/plans/ui-redesign-2.md slice C):
 * the actor is drawn as a chip by the caller; this gives the verb with its
 * object — which Gate, which State — the tone the row takes, and the words
 * a Human or an Agent wrote when there are any: the comment, the note, the
 * question, the summary. Everything comes from the Event the row carries.
 */
import type { EventTone } from "@/lib/event-text";

/** A Notification speaks in the same tones an Event does; one palette serves both. */
export type NotificationTone = EventTone;

export interface NotificationText {
  verb: string;
  excerpt: string | null;
  tone: NotificationTone;
}

export interface DescribableNotification {
  kind: string;
  issue: { state?: { name: string } | null } | null;
  event: { kind: string; payload: unknown };
  comment?: { id: string; body: string | null } | null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** "3 sub-issues", or "a sub-issue" where the number is not worth saying. */
const count = (value: unknown): string =>
  typeof value === "number" && value > 1 ? `${String(value)} sub-issues` : "a sub-issue";

export function describeNotification(row: DescribableNotification): NotificationText {
  const payload =
    row.event.payload && typeof row.event.payload === "object" && !Array.isArray(row.event.payload)
      ? (row.event.payload as Record<string, unknown>)
      : {};
  const stateName = row.issue?.state?.name ?? "a";
  const gate = text(payload.state) ?? stateName;

  switch (row.kind) {
    case "assignment":
      return {
        verb: payload.byStateRule
          ? `assigned it to you, entering ${stateName}`
          : "assigned it to you",
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
      // One line for a whole wave of sub-issues, or for the moment they are all
      // finished (docs/plans/sub-issue-delegation.md). It names the parent,
      // because the parent is the only place the work is whole.
      return row.event.kind === "issue.children_closed"
        ? { verb: "finished every sub-issue of this", excerpt: null, tone: "agent" }
        : {
            verb: `opened ${count(payload.siblings)} under this`,
            excerpt: text(payload.title),
            tone: "agent",
          };
    case "gate_awaiting":
      switch (row.event.kind) {
        case "gate.rejected":
          return { verb: `rejected the ${gate} Gate`, excerpt: text(payload.note), tone: "gate" };
        case "gate.approved":
          return {
            verb: `approved the ${gate} Gate → ${text(payload.to) ?? stateName}`,
            excerpt: text(payload.note),
            tone: "gate",
          };
        case "gate.approval": {
          // Short of the threshold, so the row is still a question: say how
          // many more Humans it wants (docs/plans/four-eyes-gates.md).
          const remaining = typeof payload.remaining === "number" ? payload.remaining : null;
          const more =
            remaining === null
              ? ""
              : `; it wants ${remaining} more ${remaining === 1 ? "Human" : "Humans"}`;
          return {
            verb: `approved the ${gate} Gate${more}`,
            excerpt: text(payload.note),
            tone: "gate",
          };
        }
        case "issue.moved":
          return {
            verb: `moved it into the ${text(payload.to) ?? stateName} Gate`,
            excerpt: null,
            tone: "gate",
          };
        case "issue.created":
          // The first State's name rides in the payload; older Events fall
          // back to where the Issue is now.
          return { verb: `created it in the ${gate} Gate`, excerpt: null, tone: "gate" };
        default:
          // run.awaiting_input carries the Gate's name as `state`.
          return { verb: `is waiting at the ${gate} Gate`, excerpt: null, tone: "gate" };
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
        verb: `${ruling} the ${gate} Gate your Agent asked about`,
        excerpt: text(payload.note),
        tone: "muted",
      };
    }
    default:
      return { verb: row.kind, excerpt: null, tone: "muted" };
  }
}
