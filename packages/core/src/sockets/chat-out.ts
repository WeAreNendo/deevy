import {
  delivery as deliveryTable,
  socketMirror as socketMirrorTable,
  type Db,
  type Event,
} from "@deevy/db";
import { and, eq } from "drizzle-orm";
import type { EventKind } from "../events.ts";
import { newId } from "../ids.ts";
import type { ChatGateMessage } from "./port.ts";

/**
 * What deevy says in a chat tool, and how it keeps it true (ADR-0025).
 *
 * A Gate posted to a Slack room or a Human's direct messages carries two
 * buttons, and a Ruling made anywhere — Slack, deevy, the tracker — changes
 * what the message should say. So the message is remembered where it landed
 * (`socket_mirror`, kind `message`), and every Event that changes a Gate owes
 * each chat tool holding one of its messages an update. The update is
 * rendered at send time from the Gate's own rows, like everything else the
 * outbox sends (ADR-0003).
 */

/** The kinds that change what a Gate's message says. */
const updateKinds: ReadonlySet<string> = new Set<EventKind>([
  "gate.approval",
  "gate.approved",
  "gate.rejected",
  "gate.superseded",
]);

/**
 * The deliveries a Gate's messages are owed for this Event: one per chat tool
 * that holds any, because one update pass changes every message of that Gate
 * on that tool. Pure on the kind first, so nothing else pays a query.
 */
export async function deriveChatUpdates(db: Db, event: Event): Promise<string[]> {
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
