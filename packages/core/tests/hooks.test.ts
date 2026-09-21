import { socket as socketTable, type Db } from "@deevy/db";
import { eq } from "drizzle-orm";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { router } from "../src/operations/index.ts";
import type { InboundEvent } from "../src/sockets/port.ts";
import {
  agentContext,
  externalIssue,
  fakeSockets,
  memberContext,
  seedProject,
  testDb,
  testSealingSecret,
} from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * The door a tracker knocks on (ADR-0024).
 *
 * Everything about this route is about being a good citizen of somebody else's
 * webhook machinery: a provider that gets a 500 disables the hook, a provider
 * that gets no answer retries the same delivery, and both of those turn one
 * record into either silence or two Runs. So the route verifies, writes down
 * that this delivery happened, applies what it can, and answers 200 with what
 * it did — the failure lives in the row, not in the status.
 */
const webhookSecret = "a-secret-the-tracker-and-deevy-share";

async function workspace(db: Db) {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const seeded = await seedProject(db, ada.workspace.id, { webhookSecret });
  const planner = await agentContext(db, {
    name: "Planner",
    handle: "planner",
    email: "planner@example.com",
    sponsor: ada.member,
    grants: [seeded.project.id],
  });
  const { sockets } = fakeSockets();
  const app = createApp({ db, sockets, socketSecret: testSealingSecret });
  return {
    ada,
    planner,
    seeded,
    app,
    asPlanner: createRouterClient(router, { context: planner }),
  };
}

/** A delivery the fake tracker will vouch for, or, with a wrong secret, will not. */
function delivery(
  events: InboundEvent[],
  options: { id?: string; secret?: string; socketId?: string } = {},
) {
  const body = JSON.stringify({ events });
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-event": "events",
      "x-test-delivery": options.id ?? "delivery-1",
      "x-test-signature": `${options.secret ?? webhookSecret}:${String(body.length)}`,
    },
    body,
  };
}

const labelled: InboundEvent[] = [
  {
    kind: "issue",
    scopeKey: "acme/deevy",
    issue: externalIssue({
      externalId: "42",
      title: "Checkout rewrite",
      labels: ["agent:planner"],
    }),
    actor: { login: "ada-on-github", id: "gh-1", isBot: false },
  },
];

describe("a delivery arriving at a Socket's hook", () => {
  it("opens exactly one Run, and says what it did", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { app, seeded, asPlanner } = await workspace(db);

    const response = await app.request(`/hooks/${seeded.socketId}`, delivery(labelled));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "applied", applied: 1 });
    expect((await asPlanner.runs.list({})).runs).toHaveLength(1);

    const rows = await db.query.inboundDelivery.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deliveryId: "delivery-1",
      eventName: "events",
      status: "applied",
    });
    // The Socket's own clock, which is what the catch-up poll reads.
    const socket = await db.query.socket.findFirst({ where: { id: seeded.socketId } });
    expect(socket?.lastInboundAt).toBeInstanceOf(Date);
  });

  it("is one Run and one row however many times the provider sends it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { app, seeded, asPlanner } = await workspace(db);

    await app.request(`/hooks/${seeded.socketId}`, delivery(labelled));
    const again = await app.request(`/hooks/${seeded.socketId}`, delivery(labelled));

    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ status: "duplicate" });
    expect((await asPlanner.runs.list({})).runs).toHaveLength(1);
    expect(await db.query.inboundDelivery.findMany({})).toHaveLength(1);
  });

  it("refuses a signature that does not check out, and writes nothing down", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { app, seeded } = await workspace(db);

    const response = await app.request(
      `/hooks/${seeded.socketId}`,
      delivery(labelled, { secret: "not-the-shared-secret" }),
    );

    expect(response.status).toBe(401);
    expect(await db.query.inboundDelivery.findMany({})).toEqual([]);
    expect(await db.query.issue.findFirst({})).toBeUndefined();
  });

  it("is a 404 for a Socket nobody connected, and a 404 once one is removed", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { app, seeded } = await workspace(db);

    expect((await app.request("/hooks/sock_000000000000", delivery(labelled))).status).toBe(404);

    await db
      .update(socketTable)
      .set({ status: "removed" })
      .where(eq(socketTable.id, seeded.socketId));

    expect((await app.request(`/hooks/${seeded.socketId}`, delivery(labelled))).status).toBe(404);
  });

  it("takes a paused Socket's deliveries without acting on them", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { app, seeded, asPlanner } = await workspace(db);
    await db
      .update(socketTable)
      .set({ status: "paused" })
      .where(eq(socketTable.id, seeded.socketId));

    const response = await app.request(`/hooks/${seeded.socketId}`, delivery(labelled));

    // Not a refusal: a provider whose deliveries fail long enough disables the
    // hook, and a pause is an operator resting a tool rather than ending it.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "paused" });
    expect((await asPlanner.runs.list({})).runs).toEqual([]);
  });

  it("keeps the reason a delivery meant nothing", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { app, seeded } = await workspace(db);

    const response = await app.request(
      `/hooks/${seeded.socketId}`,
      delivery([{ kind: "ignored", why: "a ping" }]),
    );

    expect(await response.json()).toMatchObject({ status: "skipped" });
    const [row] = await db.query.inboundDelivery.findMany({});
    expect(row).toMatchObject({ status: "skipped" });
    expect(row?.error).toContain("a ping");
  });

  it("records a delivery it could not read, and still answers 200", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { app, seeded } = await workspace(db);
    const body = "not json at all";

    const response = await app.request(`/hooks/${seeded.socketId}`, {
      method: "POST",
      headers: {
        "x-test-event": "events",
        "x-test-delivery": "delivery-2",
        "x-test-signature": `${webhookSecret}:${String(body.length)}`,
      },
      body,
    });

    expect(response.status).toBe(200);
    const [row] = await db.query.inboundDelivery.findMany({});
    expect(row).toMatchObject({ status: "failed" });
  });
});
