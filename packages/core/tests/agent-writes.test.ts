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

const SPEC = [
  "## Requirements",
  "",
  "1. A Checkout is one server-side object.",
  "",
  "## Design",
  "",
  "`checkout.create` opens the object.",
].join("\n");

async function withSpec(db: MemberContext["db"]) {
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const client = createRouterClient(router, { context: admin });
  await client.projects.create({ name: "deevy", key: "DEV" });
  await client.issues.create({ projectKey: "DEV", title: "Ship it" });
  await client.documents.write({ issueKey: "DEV-1", name: "intent", body: SPEC });
  return { admin, client };
}

/** Somebody is in the room, and it holds what they have typed. */
async function typingIn(context: MemberContext, markdown: string) {
  const room = await authorizeRoom(context, "document:DEV-1:intent");
  const doc = new Y.Doc();
  await openRoom({ db: context.db, room, doc });
  loadMarkdown(doc, markdown);
  await storeRoom({
    db: context.db,
    room,
    doc,
    authors: [context.member.id],
    now: new Date(),
  });
  return doc;
}

describe("what an Agent reads", () => {
  it("gets the live text, not the last version, and something to write back with", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withSpec(db);
    await typingIn(admin, `${SPEC}\n\n## Concerns\n\nTyped just now.`);

    const read = await client.documents.get({ issueKey: "DEV-1", name: "intent" });

    expect(read.body).toContain("Typed just now.");
    expect(read.basis).toBeTruthy();
  });

  it("gets an older version exactly as it was, with no basis to write from", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await withSpec(db);

    const read = await client.documents.get({ issueKey: "DEV-1", name: "intent", version: 1 });

    // Version 1 is the State's template: reading history is not a starting
    // point for a write, and saying so is better than implying it.
    expect(read.version).toBe(1);
    expect(read.basis).toBeNull();
  });
});

describe("what an Agent writes", () => {
  it("lands beside what a Human typed while it was thinking", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withSpec(db);
    const read = await client.documents.get({ issueKey: "DEV-1", name: "intent" });

    // While the Agent composes, a Human adds a section of their own.
    await typingIn(admin, `${SPEC}\n\n## Concerns\n\nA Human's worry.`);

    const planner = await memberContext(db, { kind: "agent", name: "Planner" });
    const asPlanner = createRouterClient(router, { context: planner });
    await asPlanner.documents.write({
      issueKey: "DEV-1",
      name: "intent",
      body: read.body.replace(
        "`checkout.create` opens the object.",
        "`checkout.create` returns an id.",
      ),
      basis: read.basis,
    });

    const after = await client.documents.get({ issueKey: "DEV-1", name: "intent" });
    expect(after.body).toContain("`checkout.create` returns an id.");
    expect(after.body).toContain("A Human's worry.");
  });

  it("is refused, and the Human is not, when they wrote over each other", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withSpec(db);
    const read = await client.documents.get({ issueKey: "DEV-1", name: "intent" });

    await typingIn(
      admin,
      SPEC.replace("1. A Checkout is one server-side object.", "1. A Checkout is a receipt."),
    );

    const planner = await memberContext(db, { kind: "agent", name: "Planner" });
    const asPlanner = createRouterClient(router, { context: planner });

    await expect(
      asPlanner.documents.write({
        issueKey: "DEV-1",
        name: "intent",
        body: read.body.replace(
          "1. A Checkout is one server-side object.",
          "1. A Checkout is one object, server-side.",
        ),
        basis: read.basis,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // The Human's words are untouched: the room is for typing, the API retries.
    const after = await client.documents.get({ issueKey: "DEV-1", name: "intent" });
    expect(after.body).toContain("1. A Checkout is a receipt.");
  });

  it("reaches the room somebody has open, and merges against what it holds", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { client } = await withSpec(db);

    // A room nobody has stored yet, holding a sentence typed seconds ago: the
    // stored state is behind, and merging against it would lose those words.
    const open = new Y.Doc();
    loadMarkdown(open, `${SPEC}\n\n## Concerns\n\nTyped ten seconds ago.`);
    const applied: string[] = [];
    const rooms = {
      read: (room: string) =>
        Promise.resolve(room.startsWith("document:") ? markdownOf(open) : null),
      apply: (_room: string, markdown: string) => {
        applied.push(markdown);
        loadMarkdown(open, markdown);
        return Promise.resolve();
      },
    };
    const planner = await memberContext(db, { kind: "agent", name: "Planner" });
    const asPlanner = createRouterClient(router, { context: { ...planner, liveRooms: rooms } });

    const read = await asPlanner.documents.get({ issueKey: "DEV-1", name: "intent" });
    expect(read.body).toContain("Typed ten seconds ago.");

    await asPlanner.documents.write({
      issueKey: "DEV-1",
      name: "intent",
      body: read.body.replace(
        "`checkout.create` opens the object.",
        "`checkout.create` returns an id.",
      ),
      basis: read.basis,
    });

    // The room heard about it, and what it now holds has both.
    expect(applied).toHaveLength(1);
    expect(markdownOf(open)).toContain("`checkout.create` returns an id.");
    expect(markdownOf(open)).toContain("Typed ten seconds ago.");

    // And the same text is what anybody reading the Document gets.
    const after = await client.documents.get({ issueKey: "DEV-1", name: "intent" });
    expect(after.body).toContain("Typed ten seconds ago.");
  });

  it("writes one section without sending the rest of the Document", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin, client } = await withSpec(db);
    await typingIn(admin, `${SPEC}\n\n## Concerns\n\nUntouched.`);
    const planner = await memberContext(db, { kind: "agent", name: "Planner" });
    const asPlanner = createRouterClient(router, { context: planner });

    await asPlanner.documents.writeSection({
      issueKey: "DEV-1",
      name: "intent",
      section: "Design",
      body: "`checkout.create` opens it, `checkout.confirm` pays.",
    });

    const after = await client.documents.get({ issueKey: "DEV-1", name: "intent" });
    expect(after.body).toContain("`checkout.create` opens it, `checkout.confirm` pays.");
    expect(after.body).toContain("Untouched.");
    expect(after.body).toContain("1. A Checkout is one server-side object.");
  });

  it("refuses a section the Document does not have, rather than inventing one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await withSpec(db);
    const planner = await memberContext(db, { kind: "agent", name: "Planner" });
    const asPlanner = createRouterClient(router, { context: planner });

    await expect(
      asPlanner.documents.writeSection({
        issueKey: "DEV-1",
        name: "intent",
        section: "Open questions",
        body: "Anything.",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
