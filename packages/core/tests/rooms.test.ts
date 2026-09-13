import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { authorizeRoom, parseRoomName, roomName } from "../src/rooms.ts";
import { router } from "../src/operations/index.ts";
import { memberContext, testDb, type MemberContext } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/** A Workspace with one Issue that has an intent Document, as the Intent State opens one. */
async function withIssue(db: MemberContext["db"]) {
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const client = createRouterClient(router, { context: admin });
  await client.projects.create({ name: "deevy", key: "DEV" });
  const issue = await client.issues.create({ projectKey: "DEV", title: "Ship it" });
  return { admin, client, issue };
}

describe("what a room is called", () => {
  it("names a Document by its Issue and its own name, and reads it back", () => {
    const name = roomName({ kind: "document", issueKey: "DEV-1", document: "spec" });

    expect(name).toBe("document:DEV-1:spec");
    expect(parseRoomName(name)).toEqual({ kind: "document", issueKey: "DEV-1", document: "spec" });
  });

  it("names an Issue's description, which has no Document name", () => {
    const name = roomName({ kind: "description", issueKey: "DEV-1" });

    expect(name).toBe("description:DEV-1");
    expect(parseRoomName(name)).toEqual({ kind: "description", issueKey: "DEV-1" });
  });

  it("refuses a name that is not one of ours", () => {
    // Whatever arrives on the socket is a string somebody else chose, so the
    // parser is the boundary: anything it does not recognise reaches no query.
    for (const rubbish of [
      "",
      "document:",
      "document:DEV-1",
      "document:DEV-1:spec:extra",
      "description:DEV-1:spec",
      "../../etc/passwd",
      "document:DEV-1:../spec",
      "documents:DEV-1:spec",
    ]) {
      expect(parseRoomName(rubbish)).toBeNull();
    }
  });
});

describe("who may open a room", () => {
  it("lets a Member into a Document on an Issue they can see", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin } = await withIssue(db);

    const opened = await authorizeRoom(admin, "document:DEV-1:intent");

    expect(opened.room).toEqual({ kind: "document", issueKey: "DEV-1", document: "intent" });
    expect(opened.issue.key).toBe("DEV-1");
    expect(opened.document?.name).toBe("intent");
  });

  it("lets a Member into an Issue's description", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin } = await withIssue(db);

    const opened = await authorizeRoom(admin, "description:DEV-1");

    expect(opened.room).toEqual({ kind: "description", issueKey: "DEV-1" });
    expect(opened.document).toBeNull();
  });

  it("refuses an Agent, because an Agent writes markdown and never joins a room", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await withIssue(db);
    const planner = await memberContext(db, { kind: "agent", name: "Planner" });

    await expect(authorizeRoom(planner, "document:DEV-1:intent")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses a Document the Issue does not have", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin } = await withIssue(db);

    await expect(authorizeRoom(admin, "document:DEV-1:spec")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses an Issue that does not exist, and a name that is not a room", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { admin } = await withIssue(db);

    await expect(authorizeRoom(admin, "document:DEV-99:intent")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(authorizeRoom(admin, "not-a-room")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
