import { project as projectTable, socket as socketTable, type Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import type { ExternalIssue } from "../src/sockets/port.ts";
import { runDueWork, syncSockets } from "../src/work.ts";
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
 * Asking a tool what changed, for the instance it cannot reach (ADR-0024).
 *
 * Polling is the fallback that keeps a laptop working: no public URL, no
 * tunnel, no webhook — deevy asks instead of being told, through the same
 * `applyInbound` a delivery goes through, so a team gets the same behaviour
 * either way, one interval later.
 */
async function pollable(db: Db, records: ExternalIssue[]) {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const seeded = await seedProject(db, ada.workspace.id);
  const planner = await agentContext(db, {
    name: "Planner",
    handle: "planner",
    email: "planner@example.com",
    sponsor: ada.member,
    grants: [seeded.project.id],
  });
  const held = new Map(records.map((record) => [record.externalId, record]));
  const { sockets } = fakeSockets(held);
  await db.update(socketTable).set({ pollMinutes: 5 }).where(eq(socketTable.id, seeded.socketId));

  return {
    ada,
    seeded,
    planner,
    held,
    asPlanner: createRouterClient(router, { context: planner }),
    sync: (options: { limit?: number; now?: Date } = {}) =>
      syncSockets({
        db,
        workspaceId: ada.workspace.id,
        sockets,
        socketSecret: testSealingSecret,
        ...options,
      }),
  };
}

describe("polling a tool deevy was not told about", () => {
  it("projects what it finds, and routes it as a delivery would", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { sync, asPlanner } = await pollable(db, [
      externalIssue({ externalId: "1", title: "Checkout rewrite", labels: ["agent:planner"] }),
    ]);

    const result = await sync();

    expect(result).toMatchObject({ scanned: 1, applied: 1, more: false });
    expect(await db.query.issue.findFirst({ where: { externalId: "1" } })).toMatchObject({
      title: "Checkout rewrite",
    });
    expect((await asPlanner.runs.list({})).runs).toHaveLength(1);
  });

  it("takes one page and says there is more, rather than draining the tracker", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const records = Array.from({ length: 21 }, (_, index) =>
      externalIssue({
        externalId: String(index + 1),
        updatedAt: new Date(2026, 8, 1, 0, index),
      }),
    );
    const { sync } = await pollable(db, records);

    const result = await sync({ limit: 20 });

    expect(result).toMatchObject({ scanned: 20, applied: 20, more: true });
    expect(await db.query.issue.findMany({})).toHaveLength(20);
  });

  it("writes the poll down where the tool's own deliveries are", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { sync } = await pollable(db, [externalIssue({ externalId: "1" })]);

    await sync();

    const [delivery] = await db.query.inboundDelivery.findMany({});
    // A poll is a delivery deevy made to itself, so a settings page listing
    // what a tool has said lately shows the asking as well as the telling.
    expect(delivery).toMatchObject({ eventName: "poll", status: "applied" });
  });

  it("leaves a tool that is not due, and one an operator has rested", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { sync, seeded } = await pollable(db, [externalIssue({ externalId: "1" })]);

    await sync();
    const second = await sync();
    // Polled a moment ago, and its interval is five minutes.
    expect(second).toMatchObject({ scanned: 0, more: false });

    await db
      .update(projectTable)
      .set({ lastPolledAt: null })
      .where(eq(projectTable.id, seeded.project.id));
    await db
      .update(socketTable)
      .set({ status: "paused" })
      .where(eq(socketTable.id, seeded.socketId));

    expect(await sync()).toMatchObject({ scanned: 0, more: false });
  });

  it("asks only for what changed since the newest record it holds", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const first = new Date("2026-09-20T10:00:00Z");
    const { sync, held, seeded } = await pollable(db, [
      externalIssue({ externalId: "1", title: "Known", updatedAt: first }),
    ]);
    await sync();

    // The tracker moves on, and the next poll is an hour later.
    held.set(
      "2",
      externalIssue({
        externalId: "2",
        title: "New since",
        updatedAt: new Date("2026-09-20T11:00:00Z"),
      }),
    );
    await db
      .update(projectTable)
      .set({ lastPolledAt: null })
      .where(eq(projectTable.id, seeded.project.id));

    const result = await sync();

    // One record, not two: the one the tracker changed after the watermark.
    expect(result).toMatchObject({ scanned: 1, applied: 1 });
    expect(await db.query.issue.findMany({})).toHaveLength(2);
  });
});

describe("the background pass", () => {
  it("polls as one of its arms, and forgets deliveries nobody can replay", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const records = [externalIssue({ externalId: "1", labels: ["agent:planner"] })];
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const seeded = await seedProject(db, ada.workspace.id);
    await agentContext(db, {
      name: "Planner",
      handle: "planner",
      email: "planner@example.com",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    const { sockets } = fakeSockets(new Map(records.map((one) => [one.externalId, one])));
    await db.update(socketTable).set({ pollMinutes: 5 }).where(eq(socketTable.id, seeded.socketId));

    const result = await runDueWork({
      db,
      sockets,
      socketSecret: testSealingSecret,
      limits: { maxPasses: 1 },
    });

    expect(result.syncedRecords).toBe(1);
    expect(await db.query.issue.findFirst({ where: { externalId: "1" } })).toBeTruthy();

    // A delivery older than any provider's retry window is bookkeeping, and
    // the sweep that forgets it appends nothing.
    const later = new Date(Date.now() + 40 * 24 * 60 * 60_000);
    const swept = await runDueWork({
      db,
      sockets,
      socketSecret: testSealingSecret,
      now: later,
      limits: { maxPasses: 1 },
    });
    expect(swept.forgottenDeliveries).toBeGreaterThan(0);
  });
});
