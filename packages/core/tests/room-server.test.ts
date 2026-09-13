import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { roomAuthenticator, roomSocket } from "../src/room-server.ts";
import { router } from "../src/operations/index.ts";
import type { AppContext } from "../src/operations/registry.ts";
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
  return admin;
}

/** What Hocuspocus hands `onAuthenticate`: a document name and the upgrade request. */
function joining(documentName: string) {
  const request = new Request("https://deevy.test/collab", {
    headers: { cookie: "deevy.session=whatever" },
  });
  return { documentName, request, requestHeaders: request.headers, token: "" };
}

describe("joining a room", () => {
  it("hands the room's Member and Issue to the connection", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await withIssue(db);
    const authenticate = roomAuthenticator({ contextFrom: async () => admin });

    const context = await authenticate(joining("document:DEV-1:intent"));

    // What every later hook sees: who is typing, and what they are typing in.
    expect(context.member.id).toBe(admin.member.id);
    expect(context.room).toMatchObject({ kind: "document", document: "intent" });
    expect(context.issueKey).toBe("DEV-1");
    expect(context.documentId).toBe(context.documentId as string);
  });

  it("refuses a caller with no Member: a session is not membership", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await withIssue(db);
    const stranger = { ...admin, member: undefined } as unknown as AppContext;
    const authenticate = roomAuthenticator({ contextFrom: async () => stranger });

    await expect(authenticate(joining("document:DEV-1:intent"))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("refuses an Agent, which writes markdown rather than joining", async () => {
    const { db, close } = testDb();
    closers.push(close);
    await withIssue(db);
    const planner = await memberContext(db, { kind: "agent", name: "Planner" });
    const authenticate = roomAuthenticator({ contextFrom: async () => planner });

    await expect(authenticate(joining("document:DEV-1:intent"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses a room that is not one of ours, before it reaches a query", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const admin = await withIssue(db);
    const authenticate = roomAuthenticator({ contextFrom: async () => admin });

    await expect(authenticate(joining("../../etc/passwd"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("a socket from a runtime", () => {
  it("feeds what the client sent to the room, and says when it hung up", () => {
    const sent: Uint8Array[] = [];
    const listeners: Record<string, (event: unknown) => void> = {};
    const ws = {
      readyState: 1,
      send: (data: ArrayBuffer | Uint8Array | string) => {
        sent.push(data as Uint8Array);
      },
      close: () => undefined,
      addEventListener: (type: string, listener: (event: never) => void) => {
        listeners[type] = listener as (event: unknown) => void;
      },
    };

    const socket = roomSocket(ws);
    const heard: Uint8Array[] = [];
    let closed = false;
    socket.deliver = (data) => heard.push(data);
    socket.onClientClose = () => {
      closed = true;
    };

    // Every runtime hands the bytes over differently; all three shapes arrive.
    listeners.message?.({ data: new Uint8Array([1, 2]).buffer });
    listeners.message?.({ data: new Uint8Array([3]) });
    listeners.close?.({});

    expect(heard.map((one) => [...one])).toEqual([[1, 2], [3]]);
    expect(closed).toBe(true);

    socket.send(new Uint8Array([9]));
    expect(sent).toHaveLength(1);
    expect(socket.readyState).toBe(1);
  });
});
