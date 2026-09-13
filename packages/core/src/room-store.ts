import {
  document as documentTable,
  documentVersion as documentVersionTable,
  documentVersionAuthor as documentVersionAuthorTable,
  gateDecisionDocument as gateDecisionDocumentTable,
  issue as issueTable,
  roomState as roomStateTable,
  type Db,
  type Document,
} from "@deevy/db";
import { loadMarkdown, markdownOf } from "@deevy/editor";
import { and, desc, eq } from "drizzle-orm";
import * as Y from "yjs";
import { appendEvent, type EventSource } from "./events.ts";
import { clearApprovalsIfGated } from "./gate-freshness.ts";
import { newId } from "./ids.ts";
import type { LiveRooms } from "./live-rooms.ts";
import type { OpenedRoom } from "./rooms.ts";

/**
 * How long after a version was cut a further quiet still belongs to it. One
 * session of writing leaves one version rather than one per pause (ADR-0021).
 */
const AMEND_WITHIN_MS = 10 * 60_000;

/** The room, and who is asking about it. */
export interface RoomWork {
  db: Db;
  room: OpenedRoom;
  doc: Y.Doc;
}

/** Where a room's state is kept, by ids rather than by keys, so renaming a Project moves nothing. */
export function roomStateKey(room: OpenedRoom): string {
  return room.document ? `document:${room.document.id}` : `description:${room.issue.id}`;
}

/**
 * Fill a room with what it should open holding: the state it was left in, or —
 * the first time, or if that state is ever lost — the Document's latest version
 * (an Issue's description, for a description's room). Markdown is what a
 * Document is made of, so markdown is what a room is rebuilt from.
 */
export async function openRoom({ db, room, doc }: RoomWork): Promise<void> {
  const saved = await db.query.roomState.findFirst({ where: { room: roomStateKey(room) } });
  if (saved) {
    Y.applyUpdate(doc, decodeState(saved.state));
    return;
  }

  loadMarkdown(doc, await currentMarkdown(db, room));
}

/** What the Document (or the description) says right now, outside the room. */
async function currentMarkdown(db: Db, room: OpenedRoom): Promise<string> {
  if (!room.document) {
    const found = await db.query.issue.findFirst({ where: { id: room.issue.id } });
    return found?.description ?? "";
  }
  const version = await db.query.documentVersion.findFirst({
    where: { documentId: room.document.id, version: room.document.currentVersion },
  });
  return version?.body ?? "";
}

export interface StoreRoom extends RoomWork {
  /** Every Member whose keystrokes are in what is about to be written. */
  authors: string[];
  now: Date;
  /**
   * Where the Event goes. Absent in a test that only wants the rows; present
   * everywhere else, because the log is the only record of what happened and a
   * version cut in a room is something that happened.
   */
  log?: Omit<EventSource, "db">;
}

/**
 * Everything a quiet room owes the database: its state, so the next connection
 * picks up mid-sentence, and a version of the markdown it now holds.
 *
 * The version is cut unless the last one is young enough to still be this
 * session's — under ten minutes, the same authors, and not pinned by a Gate
 * ruling — in which case it is amended. A ruling's version is never touched
 * again: text somebody approved cannot change under its own approval.
 */
export async function storeRoom({ db, room, doc, authors, now, log }: StoreRoom): Promise<void> {
  const markdown = markdownOf(doc);
  await saveState({ db, room, doc, now });

  if (!room.document) {
    // A description has no versions. It is saved where the Issue keeps it.
    await db
      .update(issueTable)
      .set({ description: markdown === "" ? null : markdown, updatedAt: now })
      .where(eq(issueTable.id, room.issue.id));
    return;
  }

  const document = room.document;
  const last = await db.query.documentVersion.findFirst({
    where: { documentId: document.id },
    orderBy: { version: "desc" },
  });
  if (last?.body === markdown) return;

  if (last && (await amendable(db, last, authors, now))) {
    await db
      .update(documentVersionTable)
      .set({ body: markdown })
      .where(eq(documentVersionTable.id, last.id));
    await db.update(documentTable).set({ updatedAt: now }).where(eq(documentTable.id, document.id));
    await nameAuthors(db, last.id, authors);
    // No Event: the log said "wrote intent v2" a few minutes ago and this is
    // still that. A line per pause is what the amend rule exists to prevent.
    return;
  }

  const version = (last?.version ?? 0) + 1;
  const id = newId("documentVersion");
  await db.insert(documentVersionTable).values({
    id,
    documentId: document.id,
    version,
    body: markdown,
    // The one who cut it; `document_version_author` is whose words are in it.
    authorMemberId: authors[0] ?? null,
    createdAt: now,
  });
  await db
    .update(documentTable)
    .set({ currentVersion: version, updatedAt: now })
    .where(eq(documentTable.id, document.id));
  await nameAuthors(db, id, authors);
  // A Gate that wants two Humans must not collect approvals of two different
  // texts, so a change under an open one starts the counting again (ADR-0021).
  await clearApprovalsIfGated(db, log, room.issue, document.name);
  if (log) {
    await appendEvent(
      { db, ...log, member: authors[0] ? { id: authors[0] } : null },
      {
        kind: "document.updated",
        subjectType: "issue",
        subjectId: room.issue.id,
        ...(room.issue.projectId ? { projectId: room.issue.projectId } : {}),
        // Every author, so the Activity can say "Ada and Planner wrote spec v4"
        // rather than crediting whoever happened to pause last.
        payload: { name: document.name, version, authorMemberIds: [...new Set(authors)] },
      },
    );
  }
}

/** Whether this store still belongs to the version before it. */
async function amendable(
  db: Db,
  last: { id: string; createdAt: Date; documentId: string; version: number },
  authors: string[],
  now: Date,
): Promise<boolean> {
  if (now.getTime() - last.createdAt.getTime() > AMEND_WITHIN_MS) return false;

  // A version a Gate ruled on is what somebody approved, and approved text does
  // not change (the pin, and docs/plans/collaborative-documents.md).
  const pinned = await db.query.gateDecisionDocument.findFirst({
    where: { documentId: last.documentId, version: last.version },
  });
  if (pinned) return false;

  const before = await db
    .select({ memberId: documentVersionAuthorTable.memberId })
    .from(documentVersionAuthorTable)
    .where(eq(documentVersionAuthorTable.versionId, last.id));
  const had = new Set(before.map((one) => one.memberId));
  // The same hands, or fewer: somebody joining the session starts a version of
  // their own, so a version never quietly gains an author it did not have.
  return authors.every((one) => had.has(one)) && had.size === new Set(authors).size;
}

async function nameAuthors(db: Db, versionId: string, authors: string[]): Promise<void> {
  const wanted = [...new Set(authors)];
  if (wanted.length === 0) return;
  const already = await db
    .select({ memberId: documentVersionAuthorTable.memberId })
    .from(documentVersionAuthorTable)
    .where(eq(documentVersionAuthorTable.versionId, versionId));
  const had = new Set(already.map((one) => one.memberId));
  const missing = wanted.filter((one) => !had.has(one));
  if (missing.length === 0) return;
  await db
    .insert(documentVersionAuthorTable)
    .values(missing.map((memberId) => ({ versionId, memberId })));
}

/** The room's own state, which is the live truth until the next version is cut. */
async function saveState({ db, room, doc, now }: Omit<StoreRoom, "authors">): Promise<void> {
  const key = roomStateKey(room);
  const state = encode(Y.encodeStateAsUpdate(doc));
  const values = {
    room: key,
    issueId: room.issue.id,
    documentId: room.document?.id ?? null,
    state,
    updatedAt: now,
  };
  await db
    .insert(roomStateTable)
    .values(values)
    .onConflictDoUpdate({ target: roomStateTable.room, set: { state, updatedAt: now } });
}

/*
 * base64 rather than a blob: node:sqlite hands binary back as a Buffer and D1
 * as an ArrayBuffer, and the schema is read by both (packages/db, ADR-0006).
 */
function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeState(state: string): Uint8Array {
  const binary = atob(state);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
 * An Agent's write, into the room rather than around it. Where a room has
 * state, the text goes into the Yjs document and a version is cut from it, so
 * the next connection and the next quiet both see the Agent's words instead of
 * overwriting them. Returns the version it wrote, or null when there is no room
 * and the caller should write one the old way.
 *
 * A browser already connected is a beat behind: it holds its own copy of the
 * room and hears about this when it next loads. Telling a live connection is
 * the runtime's job, because only the runtime knows where the room is running
 * — `liveRooms` on the app, wired in slice 4's second half.
 */
export async function applyToRoom(
  db: Db,
  document: Document,
  body: string,
  author: Wrote,
  rooms?: LiveRooms,
): Promise<number | null> {
  const authorMemberId = author.id;
  const issue = await db.query.issue.findFirst({
    where: { id: document.issueId },
    with: { project: { columns: { key: true } } },
  });
  if (!issue) return null;
  const issueKey = `${issue.project.key}-${String(issue.number)}`;
  // Two names for one Document, and they are not interchangeable: the row is
  // keyed by the id it belongs to, and the room is called what the browser
  // called it when it opened the socket (ADR-0021).
  const key = `document:${document.id}`;
  const live = roomName({ kind: "document", issueKey, document: document.name });
  const saved = await db.query.roomState.findFirst({ where: { room: key } });
  // A room open for ten seconds has been stored nowhere yet — the state is
  // written when the typing stops — so an open room counts even with no row.
  const open = await rooms?.read(live);
  if (!saved && (open === null || open === undefined)) return null;

  const doc = new Y.Doc();
  if (saved) applyState(doc, saved.state);
  else if (open !== null && open !== undefined) loadMarkdown(doc, open);
  loadMarkdown(doc, body);
  // And the room itself, where one is open: a browser holds its own copy, and
  // a write it never hears about is a write its next quiet would undo.
  await rooms?.apply(live, body, author);

  await storeRoom({
    db,
    room: {
      room: { kind: "document", issueKey, document: document.name },
      issue: { ...issue, key: issueKey },
      document,
    },
    doc,
    authors: [authorMemberId],
    now: new Date(),
  });
  const written = await db.query.document.findFirst({ where: { id: document.id } });
  return written?.currentVersion ?? null;
}

/** Only the amend window, for the hooks that have to wait it out. */
export const amendWindowMs = AMEND_WITHIN_MS;

/** Whether this Document's current version is the one a Gate pinned. */
export async function pinnedVersions(db: Db, documentId: string): Promise<number[]> {
  const rows = await db
    .select({ version: gateDecisionDocumentTable.version })
    .from(gateDecisionDocumentTable)
    .where(and(eq(gateDecisionDocumentTable.documentId, documentId)))
    .orderBy(desc(gateDecisionDocumentTable.version));
  return rows.map((one) => one.version);
}
