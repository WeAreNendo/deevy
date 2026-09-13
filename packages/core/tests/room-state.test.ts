import { loadMarkdown, markdownOf } from "@deevy/editor";
import { roomState as roomStateTable } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import * as Y from "yjs";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { openRoom, roomStateKey, storeRoom } from "../src/room-store.ts";
import { authorizeRoom } from "../src/rooms.ts";
import { router } from "../src/operations/index.ts";
import { memberContext, testDb, type MemberContext } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function withIssue(db: MemberContext["db"]) {
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const client = createRouterClient(router, { context: admin });
  await client.projects.create({ name: "deevy", key: "DEV" });
  await client.issues.create({ projectKey: "DEV", title: "Ship it" });
  return { admin, client };
}

const storedFor = async (db: MemberContext["db"], key: string) =>
  await db.query.roomState.findFirst({ where: { room: key } });

/** A Document edited the way a Document is edited: many small changes, one text. */
function editedOften(doc: Y.Doc, times: number) {
  for (let edit = 1; edit <= times; edit++) {
    loadMarkdown(doc, `## Problem\n\nThe ${String(edit)}th thing anybody said about this.`);
  }
}

describe("what a room's state costs", () => {
  it("reads back what it wrote", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin } = await withIssue(db);
    const room = await authorizeRoom(admin, "document:DEV-1:intent");

    const doc = new Y.Doc();
    await openRoom({ db, room, doc });
    loadMarkdown(doc, "## Problem\n\nWritten once.");
    await storeRoom({ db, room, doc, authors: [admin.member.id], now: new Date() });

    const reopened = new Y.Doc();
    await openRoom({ db, room, doc: reopened });
    expect(markdownOf(reopened)).toBe("## Problem\n\nWritten once.");
  });

  it("still reads a row written before the encoding changed", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin } = await withIssue(db);
    const room = await authorizeRoom(admin, "document:DEV-1:intent");

    // What the first rooms wrote: a v1 update, base64, with no marker on it.
    const old = new Y.Doc();
    loadMarkdown(old, "## Problem\n\nFrom an older deevy.");
    const bytes = Y.encodeStateAsUpdate(old);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    await db.insert(roomStateTable).values({
      room: roomStateKey(room),
      issueId: room.issue.id,
      documentId: room.document?.id ?? null,
      state: btoa(binary),
    });

    const doc = new Y.Doc();
    await openRoom({ db, room, doc });

    expect(markdownOf(doc)).toBe("## Problem\n\nFrom an older deevy.");
  });

  it("opens the same room twice, so a restart is not a second copy of it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withIssue(db);
    await client.documents.write({
      issueKey: "DEV-1",
      name: "intent",
      body: "## Problem\n\nCheckout is four screens.",
    });
    const room = await authorizeRoom(admin, "document:DEV-1:intent");

    // Nothing stored yet, so both of these are built from the Document's last
    // version: a browser's copy, and the room the server puts back up after it
    // restarts under it.
    const browser = new Y.Doc();
    await openRoom({ db, room, doc: browser });
    const server = new Y.Doc();
    await openRoom({ db, room, doc: server });
    Y.applyUpdate(browser, Y.encodeStateAsUpdate(server));

    expect(markdownOf(browser)).toBe("## Problem\n\nCheckout is four screens.");
  });

  it("compacts a long-lived Document once nobody is in the room", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin } = await withIssue(db);
    const room = await authorizeRoom(admin, "document:DEV-1:intent");
    const doc = new Y.Doc();
    await openRoom({ db, room, doc });
    editedOften(doc, 300);

    // Stored as it stands: every edit that ever happened is in there.
    await storeRoom({
      db,
      room,
      doc,
      authors: [admin.member.id],
      now: new Date(),
      connections: 0,
      compactOver: 4_000,
    });

    const after = await storedFor(db, roomStateKey(room));
    expect(after).toBeTruthy();
    expect(after!.state.length).toBeLessThan(2_000);
    // And it is the same Document: the words are what a version is made of.
    const reopened = new Y.Doc();
    await openRoom({ db, room, doc: reopened });
    expect(markdownOf(reopened)).toBe(markdownOf(doc));
  });

  it("leaves it alone while somebody is still typing in it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin } = await withIssue(db);
    const room = await authorizeRoom(admin, "document:DEV-1:intent");
    const doc = new Y.Doc();
    await openRoom({ db, room, doc });
    editedOften(doc, 300);

    // Compacting is starting the Document's identity again, and a browser
    // holding the old one would merge its copy back in as duplicate text.
    await storeRoom({
      db,
      room,
      doc,
      authors: [admin.member.id],
      now: new Date(),
      connections: 2,
      compactOver: 4_000,
    });

    const after = await storedFor(db, roomStateKey(room));
    expect(after!.state.length).toBeGreaterThan(4_000);
  });
});
