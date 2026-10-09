import { member as memberTable } from "@deevy/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { createAuth, type Auth } from "../src/auth.ts";
import { appendEvent } from "../src/events.ts";
import { newId } from "../src/ids.ts";
import { onEventAppended, type LiveReader } from "../src/live.ts";
import { memberContext, testDb } from "./helpers.ts";

/**
 * A hosted Workspace's open tabs (ADR-0032): the log tells whoever listens to
 * its database that it grew, and `/api/live` admits a reader by the rule
 * `events.subscribe` has before the runtime answers the upgrade. The runtime's
 * half — the socket, hibernation, the push — runs on workerd in
 * apps/hosted/scripts/smoke-hosted.ts.
 */

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const secret = "test-secret-that-is-at-least-32-characters";
const baseURL = "https://deevy.example.com";

/** A signed session cookie for a user, as Better Auth would have set it. */
async function cookieFor(auth: Auth, userId: string): Promise<string> {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(session.token));
  const value = `${session.token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
  return `${context.authCookies.sessionToken.name}=${encodeURIComponent(value)}`;
}

function pushing() {
  const { db, close } = testDb();
  closers.push(close);
  const auth = createAuth({ db, env: { baseURL, secret, providers: {} } });
  const accepted: LiveReader[] = [];
  const app = createApp({
    db,
    auth,
    baseURL,
    origin: [baseURL],
    // Node cannot build a 101, so the stand-in answers what the object would
    // have upgraded; what matters here is who reached it.
    liveSocket: {
      accept: (_request, reader) => {
        accepted.push(reader);
        return new Response("accepted");
      },
    },
  });
  return { db, auth, app, accepted };
}

const upgrade = { upgrade: "websocket", connection: "Upgrade" };

describe("onEventAppended", () => {
  it("hears every Event appended through its database, and only those", async () => {
    const mine = testDb();
    const theirs = testDb();
    closers.push(mine.close, theirs.close);
    const here = await memberContext(mine.db);
    const there = await memberContext(theirs.db);
    const heard: number[] = [];
    const stop = onEventAppended(mine.db, (event) => heard.push(event.seq));

    const first = await appendEvent(here, {
      kind: "issue.created",
      subjectType: "issue",
      subjectId: newId("issue"),
    });
    // Another Workspace's log, in the same isolate: nothing of it reaches here.
    await appendEvent(there, {
      kind: "issue.created",
      subjectType: "issue",
      subjectId: newId("issue"),
    });
    stop();
    await appendEvent(here, {
      kind: "issue.synced",
      subjectType: "issue",
      subjectId: newId("issue"),
    });

    expect(heard).toEqual([first.seq]);
  });

  it("never turns a write into a failure", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await memberContext(db);
    const stop = onEventAppended(db, () => {
      throw new Error("the socket is gone");
    });
    await expect(
      appendEvent(context, { kind: "issue.created", subjectType: "issue", subjectId: "i1" }),
    ).resolves.toMatchObject({ kind: "issue.created" });
    stop();
  });
});

describe("/api/live", () => {
  it("is offered where the runtime can push, and said so on health.ping", async () => {
    const plain = testDb();
    closers.push(plain.close);
    const streaming = createApp({ db: plain.db });
    const ping = async (app: typeof streaming) =>
      ((await (await app.request("/api/health/ping")).json()) as { live: string }).live;
    expect(await ping(streaming)).toBe("stream");
    expect((await streaming.request("/api/live", { headers: upgrade })).status).toBe(501);

    const { app } = pushing();
    expect(await ping(app)).toBe("websocket");
  });

  it("admits a Member by events.subscribe's rule, with the head of the log", async () => {
    const { db, auth, app, accepted } = pushing();
    const ada = await memberContext(db);
    const last = await appendEvent(ada, {
      kind: "issue.created",
      subjectType: "issue",
      subjectId: newId("issue"),
    });
    const cookie = await cookieFor(auth, ada.member.userId);

    const opened = await app.request("/api/live", {
      headers: { ...upgrade, cookie, origin: baseURL },
    });
    expect(opened.status).toBe(200);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      memberId: ada.member.id,
      workspaceId: ada.workspace.id,
      head: last.seq,
    });
    expect(accepted[0]!.expiresAt).toBeGreaterThan(Date.now());
  });

  it("refuses whoever events.subscribe would", async () => {
    const { db, auth, app, accepted } = pushing();
    const ada = await memberContext(db);
    const cookie = await cookieFor(auth, ada.member.userId);

    // Not a socket at all.
    expect((await app.request("/api/live", { headers: { cookie } })).status).toBe(426);
    // Nobody.
    expect((await app.request("/api/live", { headers: upgrade })).status).toBe(401);
    // A page on another origin, carrying the visitor's cookie.
    const foreign = await app.request("/api/live", {
      headers: { ...upgrade, cookie, origin: "https://evil.example" },
    });
    expect(foreign.status).toBe(403);
    // A suspended Member, who is no Member.
    await db
      .update(memberTable)
      .set({ suspendedAt: new Date() })
      .where(eq(memberTable.id, ada.member.id));
    expect((await app.request("/api/live", { headers: { ...upgrade, cookie } })).status).toBe(403);

    expect(accepted).toEqual([]);
  });
});
