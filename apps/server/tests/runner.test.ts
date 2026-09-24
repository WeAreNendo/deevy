import { createTimerCron, openDatabase } from "@deevy/adapters/node";
import type { Cron } from "@deevy/core";
import {
  agent as agentTable,
  issue as issueTable,
  member as memberTable,
  project as projectTable,
  run as runTable,
  socket as socketTable,
  user as userTable,
  workspace as workspaceTable,
  type Db,
} from "@deevy/db";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { startRunner } from "../src/runner.ts";
import { newId } from "@deevy/core";

const migrationsFolder = new URL("../../../packages/db/drizzle", import.meta.url).pathname;
const MINUTE = 60_000;

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

function emptyDatabase() {
  const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
  closers.push(close);
  return db;
}

interface SeedOptions {
  /** The Agent's schedule trigger, in minutes. Absent is no schedule. */
  scheduleMinutes?: number;
  /** Whether the record is routed to that Agent. */
  assigned?: boolean;
}

/** A Workspace with one Agent and one projected record, straight into the tables. */
async function seedWorkspace(db: Db, options: SeedOptions = {}) {
  const workspaceId = newId("workspace");
  await db.insert(workspaceTable).values({ id: workspaceId, name: "deevy", slug: "deevy" });
  const userId = newId("user");
  await db.insert(userTable).values({ id: userId, name: "Planner", email: "planner@example.com" });
  const agentMemberId = newId("member");
  await db.insert(memberTable).values({ id: agentMemberId, workspaceId, userId, kind: "agent" });
  await db
    .insert(agentTable)
    .values({ memberId: agentMemberId, scheduleMinutes: options.scheduleMinutes ?? null });
  // An Issue is a projection of a record in a tracker Socket (ADR-0024), so a
  // Project is a binding and every row below hangs off the Socket.
  const socketId = newId("socket");
  await db.insert(socketTable).values({
    id: socketId,
    workspaceId,
    provider: "stub",
    capabilities: ["tracker"],
    name: "Example tracker",
    identity: { login: "deevy", id: "bot-1", mentionHandle: "@deevy" },
    config: {},
  });
  const projectId = newId("project");
  await db.insert(projectTable).values({
    id: projectId,
    workspaceId,
    slug: "acme-deevy",
    name: "deevy",
    trackerSocketId: socketId,
    trackerScope: { scopeKey: "acme/deevy" },
    trackerScopeKey: "stub:acme/deevy",
  });
  const issueId = newId("issue");
  await db.insert(issueTable).values({
    id: issueId,
    projectId,
    socketId,
    externalId: "1",
    externalKey: "acme/deevy#1",
    url: "https://tracker.test/acme/deevy/issues/1",
    title: "Ship the thing",
    state: "open",
    stateName: "open",
    externalUpdatedAt: new Date(),
    assigneeMemberId: options.assigned ? agentMemberId : null,
  });
  return { workspaceId, agentMemberId, issueId };
}

/**
 * Silent Runs, `silentMinutes` since anyone heard from the Agent — each on an
 * Issue of its own, because one Agent cannot hold two open Runs on one Issue
 * and the database says so (`schema/run.ts`). The sweep does not care which
 * Issue a silent Run is on; the one passed in is the template.
 */
async function seedRuns(
  db: Db,
  where: { issueId: string; agentMemberId: string },
  count: number,
  silentMinutes: number,
) {
  const on = await db.query.issue.findFirst({ where: { id: where.issueId } });
  if (!on) throw new Error("seedRuns: no such Issue");
  const rows = Array.from({ length: count }, (_unused, at) => ({
    id: newId("run"),
    issueId: newId("issue"),
    agentMemberId: where.agentMemberId,
    externalId: String(at + 2),
  }));
  await db.insert(issueTable).values(
    rows.map((row) => ({
      id: row.issueId,
      projectId: on.projectId,
      socketId: on.socketId,
      externalId: row.externalId,
      externalKey: `acme/deevy#${row.externalId}`,
      url: `https://tracker.test/acme/deevy/issues/${row.externalId}`,
      title: `Silent ${row.externalId}`,
      state: "open" as const,
      stateName: "open",
      externalUpdatedAt: new Date(),
    })),
  );
  await db.insert(runTable).values(
    rows.map((row) => ({
      id: row.id,
      issueId: row.issueId,
      agentMemberId: row.agentMemberId,
      trigger: "manual" as const,
      status: "active" as const,
      lastActivityAt: new Date(Date.now() - silentMinutes * MINUTE),
    })),
  );
}

/** A Cron that never ticks on its own, so a test decides when time passes. */
function manualCron() {
  const registered: Array<{ seconds: number; run: (signal: AbortSignal) => Promise<void> }> = [];
  let stops = 0;
  const cron: Cron = {
    every(seconds, run) {
      registered.push({ seconds, run });
      return () => {
        stops += 1;
      };
    },
  };
  const tick = () => {
    const first = registered[0];
    if (!first) throw new Error("the runner registered no schedule");
    return first.run(new AbortController().signal);
  };
  return { cron, registered, tick, stopped: () => stops };
}

async function statuses(db: Db) {
  return (await db.query.run.findMany()).map((row) => row.status);
}

function timeouts() {
  return process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length;
}

describe("the runner", () => {
  it("registers the sweep at the configured interval and moves silent Runs on a tick", async () => {
    const db = emptyDatabase();
    const seed = await seedWorkspace(db);
    await seedRuns(db, seed, 1, 31);
    const { cron, registered, tick } = manualCron();

    const runner = startRunner({ db, cron, staleMinutes: 30, sweepIntervalSeconds: 45 });
    await tick();

    expect(registered[0]?.seconds).toBe(45);
    expect(await statuses(db)).toEqual(["stale"]);
    await runner.stop();
  });

  it("does nothing until the Workspace exists, because it is created on the first sign-in", async () => {
    const db = emptyDatabase();
    const { cron, tick } = manualCron();

    const runner = startRunner({ db, cron });

    await expect(tick()).resolves.toBeUndefined();
    await runner.stop();
  });

  it("sweeps again while there is more, but only so many times in one tick", async () => {
    const db = emptyDatabase();
    const seed = await seedWorkspace(db);
    await seedRuns(db, seed, 25, 31);
    const { cron, tick } = manualCron();

    const runner = startRunner({ db, cron, sweepLimit: 10, maxPassesPerTick: 2 });
    await tick();

    // Two passes of ten: the rest waits for the next tick rather than making
    // one tick unbounded.
    expect((await statuses(db)).filter((status) => status === "stale")).toHaveLength(20);
    await tick();
    expect((await statuses(db)).filter((status) => status === "stale")).toHaveLength(25);
    await runner.stop();
  });

  it("runs the schedule sweep on the same tick as the stale sweep", async () => {
    const db = emptyDatabase();
    await seedWorkspace(db, { scheduleMinutes: 60, assigned: true });
    const { cron, registered, tick } = manualCron();

    const runner = startRunner({ db, cron });
    await tick();

    // One Cron for all of deevy's background work: a second schedule would be
    // a second thing to configure and a second thing to forget.
    expect(registered).toHaveLength(1);
    const runs = await db.query.run.findMany();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: "schedule", status: "pending" });
    await runner.stop();
  });

  it("stops only once the sweep in flight has finished", async () => {
    const db = emptyDatabase();
    const seed = await seedWorkspace(db);
    await seedRuns(db, seed, 1, 31);
    const { cron, tick, stopped } = manualCron();
    const runner = startRunner({ db, cron });

    const inFlight = tick();
    await runner.stop();

    expect(await statuses(db)).toEqual(["stale"]);
    expect(stopped()).toBe(1);
    await inFlight;
  });

  it("leaves no timer holding the process open", async () => {
    const db = emptyDatabase();
    const seed = await seedWorkspace(db);
    await seedRuns(db, seed, 1, 31);
    const before = timeouts();

    const runner = startRunner({
      db,
      cron: createTimerCron(),
      sweepIntervalSeconds: 0.005,
    });
    const deadline = Date.now() + 2000;
    while (!(await statuses(db)).includes("stale")) {
      if (Date.now() > deadline) throw new Error("the runner never swept");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    // Nothing the runner started may keep the event loop alive: a process that
    // will not exit is the failure this test exists to catch. The count is
    // process-global, so only a rise in it means anything — the runner leaking
    // its interval would put it at `before + 1`. Equality would also fail on a
    // timer somebody else's test happened to be holding when `before` was
    // sampled and had let go of by now, which is not a failure of anything.
    expect(timeouts()).toBeLessThanOrEqual(before);

    await runner.stop();
    const after = (await db.query.event.findMany()).length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await db.query.event.findMany()).length).toBe(after);
  });
});
