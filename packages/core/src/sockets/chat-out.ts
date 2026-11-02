import {
  delivery as deliveryTable,
  socketMirror as socketMirrorTable,
  type Db,
  type Event,
} from "@deevy/db";
import { and, eq } from "drizzle-orm";
import type { EventKind } from "../events.ts";
import { newId } from "../ids.ts";
import { gateRequestIdOf } from "../notifications.ts";
import type { ChatGateMessage, ChatMessage } from "./port.ts";

/**
 * What deevy says in a chat tool, and how it keeps it true (ADR-0025).
 *
 * A Project may bind one chat channel (docs/plans/simplify.md, slice 8), and
 * each Gate a Run waits at there is posted in it as one message with two
 * buttons. A Ruling made anywhere — Slack, deevy, the tracker — changes what
 * that message should say, so the message is remembered where it landed
 * (`socket_mirror`, kind `message`), and every Event that changes a Gate owes
 * each chat tool holding one of its messages an update. Both are rendered at
 * send time from the Gate's own rows, like everything else the outbox sends
 * (ADR-0003), so a message posted after somebody already ruled says so rather
 * than offering a button that would be refused.
 */

/** The kinds that change what a Gate's message says. */
const updateKinds: ReadonlySet<string> = new Set<EventKind>([
  "gate.approval",
  "gate.approved",
  "gate.rejected",
  "gate.superseded",
]);

/**
 * What a chat tool is owed for this Event. A Run waiting at a Gate on a
 * Project that binds a channel owes it the Gate's message, named by the
 * Project so the sweep posts where the Project binds when it sends; an Event
 * that changes a Gate owes each chat tool holding one of its messages an
 * update. Pure on the kind first, so nothing else pays a query.
 */
export async function deriveChatMessages(db: Db, event: Event): Promise<string[]> {
  if (gateRequestIdOf(event) && event.projectId) return derivePost(db, event, event.projectId);
  return deriveUpdates(db, event);
}

/** The Gate's one message, owed when the Project its Run waits in binds a channel. */
async function derivePost(db: Db, event: Event, projectId: string): Promise<string[]> {
  const bound = await db.query.project.findFirst({
    where: { id: projectId, workspaceId: event.workspaceId },
    columns: { chatSocketId: true, chatChannel: true },
  });
  if (!bound?.chatSocketId || !bound.chatChannel) return [];
  const owed = await db
    .insert(deliveryTable)
    .values({
      id: newId("delivery"),
      workspaceId: event.workspaceId,
      target: "chat",
      targetId: projectId,
      eventSeq: event.seq,
    })
    .onConflictDoNothing()
    .returning({ id: deliveryTable.id });
  return owed.map((row) => row.id);
}

/**
 * One update per chat tool that holds any of the Gate's messages, because one
 * update pass changes every message of that Gate on that tool.
 */
async function deriveUpdates(db: Db, event: Event): Promise<string[]> {
  if (!updateKinds.has(event.kind) || event.subjectType !== "gate") return [];
  const holding = await db
    .selectDistinct({ socketId: socketMirrorTable.socketId })
    .from(socketMirrorTable)
    .where(
      and(
        eq(socketMirrorTable.gateRequestId, event.subjectId),
        eq(socketMirrorTable.kind, "message"),
      ),
    );
  if (holding.length === 0) return [];
  const owed = await db
    .insert(deliveryTable)
    .values(
      holding.map(({ socketId }) => ({
        id: newId("delivery"),
        workspaceId: event.workspaceId,
        target: "chat" as const,
        targetId: socketId,
        eventSeq: event.seq,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: deliveryTable.id });
  return owed.map((row) => row.id);
}

/** Where a Ruling came from, as a line on the message says it. */
function whereFrom(via: string, provider: string | null): string {
  if (via === "web") return "in deevy";
  if (via === "slack") return "in Slack";
  const named: Record<string, string> = { github: "GitHub", gitlab: "GitLab", linear: "Linear" };
  return `in ${(provider && named[provider]) ?? "the tracker"}`;
}

export interface GateForChat {
  id: string;
  checkpoint: string;
  proposal: string;
  status: ChatGateMessage["status"];
  runId: string;
  issue: { externalKey: string; url: string };
  run: { agent: { user: { name: string } } | null } | null;
  checkpointPolicy: { approvalsRequired: number } | null;
  decisions: Array<{
    decision: "approved" | "rejected";
    via: string;
    socket: { provider: string } | null;
    member: { user: { name: string } } | null;
  }>;
}

/** A Gate, as a chat message shows it, from the rows it is rendered from. */
export function chatGateMessage(gate: GateForChat, origin: string): ChatGateMessage {
  return {
    gateRequestId: gate.id,
    issueKey: gate.issue.externalKey,
    issueUrl: gate.issue.url,
    checkpoint: gate.checkpoint,
    proposal: gate.proposal,
    agentName: gate.run?.agent?.user.name ?? null,
    runId: gate.runId,
    status: gate.status,
    approvals: gate.decisions.filter((one) => one.decision === "approved").length,
    // A Checkpoint the Project never listed asks one approval of anybody
    // (checkpoints.ts), which is what an absent policy means here too.
    required: gate.checkpointPolicy?.approvalsRequired ?? 1,
    url: `${origin.replace(/\/+$/, "")}/gates/${gate.id}`,
    rulings: gate.decisions.map(
      (one) =>
        `${one.member?.user.name ?? "Somebody"} ${one.decision}, ${whereFrom(one.via, one.socket?.provider ?? null)}`,
    ),
  };
}

/**
 * The line a channel is bound with (docs/plans/simplify.md, slice 8): posting
 * it is what proves the app may post there, while the admin is still on the
 * page, and it tells the channel what is coming.
 */
export function chatHello(project: { name: string }, origin: string): ChatMessage {
  return {
    kind: "text",
    text: `deevy will post the Gates of ${project.name} here, with Approve and Reject. A Gate waits until somebody who may rule on it does.`,
    link: { url: origin.replace(/\/+$/, "") || "/", label: "Open deevy" },
  };
}
