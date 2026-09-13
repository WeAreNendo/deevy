import { markdownOf } from "@deevy/editor";
import type { Db, Document } from "@deevy/db";
import * as Y from "yjs";
import type { LiveRooms } from "./live-rooms.ts";
import { applyState } from "./room-store.ts";

/**
 * What a Document says right now: the room's text when somebody is writing in
 * it, and the last version's when nobody is (ADR-0021). Everything an Agent
 * reads and writes goes through this, so it never sees text that is minutes
 * out of date while a Human is typing.
 */
export async function liveMarkdown(
  db: Db,
  document: Pick<Document, "id" | "currentVersion">,
  /**
   * What the room is called on the wire — `roomName()`, the same string the
   * browser opened its socket with. Not the row's key: a room is named after
   * the Issue a person can see, and a row is keyed by the id that outlives it.
   */
  room: string,
  rooms?: LiveRooms,
): Promise<{ body: string; live: boolean }> {
  // An open room first, and only then what was last stored: the state is
  // written when a room goes quiet, so somebody mid-sentence has words in the
  // room that are in no row yet, and merging against the row would lose them.
  const open = await rooms?.read(room);
  if (open !== null && open !== undefined) return { body: open, live: true };

  const state = await db.query.roomState.findFirst({
    where: { room: `document:${document.id}` },
  });
  if (state) {
    const doc = new Y.Doc();
    applyState(doc, state.state);
    return { body: markdownOf(doc), live: true };
  }

  const version = await db.query.documentVersion.findFirst({
    where: { documentId: document.id, version: document.currentVersion },
  });
  return { body: version?.body ?? "", live: false };
}

/*
 * The basis is the text itself, encoded — not a hash and not a pointer. A hash
 * cannot be merged against, and a pointer would be a row to keep and expire on
 * two runtimes; the text is exact, stateless, and worth the bytes on a write
 * that is already carrying a whole Document.
 */
export function encodeBasis(body: string): string {
  return btoa(unescape(encodeURIComponent(body)));
}

export function decodeBasis(basis: string): string | null {
  try {
    return decodeURIComponent(escape(atob(basis)));
  } catch {
    // Somebody else's token, or a truncated one: no base is better than a
    // wrong one, and a write with no base is the write.
    return null;
  }
}

/** The lines of one markdown section, by its heading, and where they sit. */
export function sectionRange(body: string, heading: string): { from: number; to: number } | null {
  const lines = body.split("\n");
  const wanted = heading
    .replace(/^#+\s*/, "")
    .trim()
    .toLowerCase();
  let from = -1;
  let level = 0;
  for (const [at, line] of lines.entries()) {
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line ?? "");
    if (!match) continue;
    if (from === -1) {
      if (match[2]?.trim().toLowerCase() !== wanted) continue;
      from = at;
      level = match[1]?.length ?? 1;
      continue;
    }
    // The next heading at the same level or above ends it.
    if ((match[1]?.length ?? 1) <= level) return { from, to: at };
  }
  return from === -1 ? null : { from, to: lines.length };
}

/** That section's body replaced, and the rest of the Document exactly as it was. */
export function replaceSection(body: string, heading: string, written: string): string | null {
  const range = sectionRange(body, heading);
  if (!range) return null;
  const lines = body.split("\n");
  const title = lines[range.from] ?? `## ${heading}`;
  const replaced = [title, "", written.trim(), ""];
  return [...lines.slice(0, range.from), ...replaced, ...lines.slice(range.to)]
    .join("\n")
    .trimEnd();
}
