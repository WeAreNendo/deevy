import { loadMarkdown, markdownOf } from "@deevy/editor";
import { createRouterClient } from "@orpc/server";
import * as Y from "yjs";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { openRoom, storeRoom } from "../src/room-store.ts";
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

/** The room as the server holds it: what `onLoadDocument` and `onStoreDocument` are given. */
async function roomFor(context: MemberContext, name = "document:DEV-1:intent") {
  const opened = await authorizeRoom(context, name);
  return { ...opened, member: context.member };
}

describe("opening a room", () => {
  it("starts from the Document's latest version when there is no state yet", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withIssue(db);
    await client.documents.write({
      issueKey: "DEV-1",
      name: "intent",
      body: "## Problem\n\nReal.",
    });

    const doc = new Y.Doc();
    await openRoom({ db, room: await roomFor(admin), doc });

    expect(markdownOf(doc)).toBe("## Problem\n\nReal.");
  });

  it("starts from the room's own state once there is one, words and all", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withIssue(db);
    await client.documents.write({
      issueKey: "DEV-1",
      name: "intent",
      body: "## Problem\n\nReal.",
    });
    const room = await roomFor(admin);

    // Somebody typed, and the room was stored before a version was cut.
    const typed = new Y.Doc();
    await openRoom({ db, room, doc: typed });
    loadMarkdown(typed, "## Problem\n\nReal. And urgent.");
    await storeRoom({ db, room, doc: typed, authors: [admin.member.id], now: new Date() });

    const reopened = new Y.Doc();
    await openRoom({ db, room, doc: reopened });

    expect(markdownOf(reopened)).toBe("## Problem\n\nReal. And urgent.");
  });
});

describe("what a quiet room writes", () => {
  it("cuts a version of the merged markdown, naming everybody in it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withIssue(db);
    const planner = await memberContext(db, { kind: "agent", name: "Planner" });
    const room = await roomFor(admin);

    const doc = new Y.Doc();
    await openRoom({ db, room, doc });
    loadMarkdown(doc, "## Problem\n\nTwo of us wrote this.");
    await storeRoom({
      db,
      room,
      doc,
      authors: [admin.member.id, planner.member.id],
      now: new Date(),
    });

    const written = await client.documents.get({ issueKey: "DEV-1", name: "intent" });
    expect(written.body).toBe("## Problem\n\nTwo of us wrote this.");
    expect(written.version).toBe(2);

    const versions = await client.documents.versions({ issueKey: "DEV-1", name: "intent" });
    expect(versions.versions[0]?.authorMemberIds.toSorted()).toEqual(
      [admin.member.id, planner.member.id].toSorted(),
    );
  });

  it("amends the version it just cut rather than adding another", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withIssue(db);
    const room = await roomFor(admin);
    const doc = new Y.Doc();
    await openRoom({ db, room, doc });

    const at = new Date("2026-09-13T10:00:00Z");
    loadMarkdown(doc, "First thought.");
    await storeRoom({ db, room, doc, authors: [admin.member.id], now: at });
    loadMarkdown(doc, "First thought, better said.");
    await storeRoom({
      db,
      room,
      doc,
      authors: [admin.member.id],
      now: new Date(at.getTime() + 4 * 60_000),
    });

    // One session, one version — not one per pause.
    const versions = await client.documents.versions({ issueKey: "DEV-1", name: "intent" });
    expect(versions.versions).toHaveLength(2);
    const current = await client.documents.get({ issueKey: "DEV-1", name: "intent" });
    expect(current.version).toBe(2);
    expect(current.body).toBe("First thought, better said.");
  });

  it("cuts a new version once the session is over", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withIssue(db);
    const room = await roomFor(admin);
    const doc = new Y.Doc();
    await openRoom({ db, room, doc });

    const at = new Date("2026-09-13T10:00:00Z");
    loadMarkdown(doc, "This morning.");
    await storeRoom({ db, room, doc, authors: [admin.member.id], now: at });
    loadMarkdown(doc, "This afternoon.");
    await storeRoom({
      db,
      room,
      doc,
      authors: [admin.member.id],
      now: new Date(at.getTime() + 11 * 60_000),
    });

    const versions = await client.documents.versions({ issueKey: "DEV-1", name: "intent" });
    expect(versions.versions).toHaveLength(3);
  });

  it("never amends a version a Gate ruled on", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withIssue(db);
    const room = await roomFor(admin);
    const doc = new Y.Doc();
    await openRoom({ db, room, doc });

    const at = new Date("2026-09-13T10:00:00Z");
    loadMarkdown(doc, "What the Gate will see.");
    await storeRoom({ db, room, doc, authors: [admin.member.id], now: at });
    // Approving the Intent Gate pins whatever the intent says right now.
    await client.gates.approve({ key: "DEV-1", note: "Go" });

    loadMarkdown(doc, "What somebody typed after the ruling.");
    await storeRoom({
      db,
      room,
      doc,
      authors: [admin.member.id],
      now: new Date(at.getTime() + 60_000),
    });

    // The approved words are still there, under the version the ruling pinned.
    const pinned = await client.documents.get({ issueKey: "DEV-1", name: "intent", version: 2 });
    expect(pinned.body).toBe("What the Gate will see.");
    const current = await client.documents.get({ issueKey: "DEV-1", name: "intent" });
    expect(current.version).toBe(3);
  });

  it("writes nothing at all when the room says what the version says", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withIssue(db);
    await client.documents.write({ issueKey: "DEV-1", name: "intent", body: "Unchanged." });
    const room = await roomFor(admin);

    const doc = new Y.Doc();
    await openRoom({ db, room, doc });
    await storeRoom({ db, room, doc, authors: [admin.member.id], now: new Date() });

    const versions = await client.documents.versions({ issueKey: "DEV-1", name: "intent" });
    expect(versions.versions).toHaveLength(2);
  });
});

describe("an Issue's description", () => {
  it("is saved where the Issue keeps it, and has no versions", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withIssue(db);
    const room = await roomFor(admin, "description:DEV-1");

    const doc = new Y.Doc();
    await openRoom({ db, room, doc });
    loadMarkdown(doc, "Why this Issue is.");
    await storeRoom({ db, room, doc, authors: [admin.member.id], now: new Date() });

    const issue = await client.issues.get({ key: "DEV-1" });
    expect(issue.description).toBe("Why this Issue is.");
  });
});
