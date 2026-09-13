import { ORPCError } from "@orpc/server";
import type { Document, Issue } from "@deevy/db";
import type { ContextFor } from "./operations/registry.ts";
import { requireDocument, requireIssue } from "./operations/shared.ts";

/**
 * A room is one text several Members may be typing in at the same time
 * (docs/plans/collaborative-documents.md, ADR-0021): a Document on an Issue, or
 * an Issue's description. Its name travels on the socket, so it is a string
 * somebody else chose — every rule about who may join hangs off parsing it.
 */
export type Room =
  | { kind: "document"; issueKey: string; document: string }
  | { kind: "description"; issueKey: string };

/** One path segment: no colons to confuse the parser, nothing that walks a path. */
const SEGMENT = /^[A-Za-z0-9_-]+$/;

export function roomName(room: Room): string {
  return room.kind === "document"
    ? `document:${room.issueKey}:${room.document}`
    : `description:${room.issueKey}`;
}

/** The room a name asks for, or `null` when it is not one of ours. */
export function parseRoomName(name: string): Room | null {
  const parts = name.split(":");
  const [kind, issueKey, document] = parts;
  if (!issueKey || !SEGMENT.test(issueKey)) return null;
  if (kind === "document" && parts.length === 3 && document && SEGMENT.test(document)) {
    return { kind: "document", issueKey, document };
  }
  if (kind === "description" && parts.length === 2) return { kind: "description", issueKey };
  return null;
}

export interface OpenedRoom {
  /** The room as its name asked for it, parsed and checked. */
  room: Room;
  issue: Issue & { key: string };
  /** The Document row for a Document's room; null for a description's. */
  document: Document | null;
}

/**
 * Whether this Member may join this room, and what the room is about. The rules
 * are the ones the Document's own operations apply — the Project has to be
 * visible, the Issue has to exist — with one addition: an **Agent never joins a
 * room**. It reads markdown and writes markdown (ADR-0021), so a socket asking
 * to join on an Agent's behalf is a mistake rather than a feature.
 */
export async function authorizeRoom(
  context: ContextFor<"member">,
  name: string,
): Promise<OpenedRoom> {
  const room = parseRoomName(name);
  if (!room) throw new ORPCError("NOT_FOUND", { message: `No such room: ${name}` });
  if (context.member.kind === "agent") {
    throw new ORPCError("FORBIDDEN", {
      message: "An Agent writes a Document through documents.write rather than joining its room",
    });
  }

  const { issue, project } = await requireIssue(context, room.issueKey);
  const withKey = { ...issue, key: `${project.key}-${String(issue.number)}` };
  if (room.kind === "description") return { room, issue: withKey, document: null };

  const document = await requireDocument(context, issue.id, room.document);
  return { room, issue: withKey, document };
}
