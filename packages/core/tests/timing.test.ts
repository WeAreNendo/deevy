import { run as runTable } from "@deevy/db";
import { eq } from "drizzle-orm";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";

/**
 * How long a Run took, which deevy derives rather than being told
 * (docs/plans/run-usage.md, slice 1): the time before it started, the time it
 * was working, and the time it waited on a Human. The clocks are moved by
 * writing the Run's own timestamps back, since nothing here fakes time.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const minute = 60_000;
/** Enough for the statements between two reads of the clock, and no more. */
const slack = 5_000;

async function workspaceWithAgent() {
  const { db, close } = testDb();
  closers.push(close);
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const { sockets } = fakeSockets();
  const asAdmin = createRouterClient(router, { context: { ...admin, sockets } });
  const seeded = await seedProject(db, admin.workspace.id);
  const issue = await seeded.record({ externalId: "1", title: "Ship the thing" });
  const agent = await agentContext(db, { sponsor: admin.member, grants: [seeded.project.id] });
  const asAgent = createRouterClient(router, { context: { ...agent, sockets } });
  const run = await asAgent.runs.start({ issue: issue.url });
  /** Moves the Run's clocks back, as if that much time had passed. */
  const earlier = (set: Partial<typeof runTable.$inferInsert>) =>
    db.update(runTable).set(set).where(eq(runTable.id, run.id));
  return { asAdmin, asAgent, run, earlier };
}

const ago = (ms: number) => new Date(Date.now() - ms);

function expectAbout(actual: number, expected: number) {
  expect(actual).toBeGreaterThanOrEqual(expected);
  expect(actual).toBeLessThan(expected + slack);
}

describe("how long a Run took", () => {
  it("is queued until it starts, and nothing else before then", async () => {
    const { asAdmin, asAgent, run, earlier } = await workspaceWithAgent();
    await earlier({ createdAt: ago(2 * minute) });

    const pending = await asAdmin.runs.get({ runId: run.id });
    expectAbout(pending.timing.queuedMs, 2 * minute);
    expect(pending.timing).toMatchObject({ workingMs: 0, waitingMs: 0 });

    await asAgent.runs.postActivity({ runId: run.id, kind: "thought", body: "Reading" });
    const started = await asAdmin.runs.get({ runId: run.id });
    expectAbout(started.timing.queuedMs, 2 * minute);
  });

  it("counts a wait at a Gate as waiting, until somebody rules", async () => {
    const { asAdmin, asAgent, run, earlier } = await workspaceWithAgent();
    await asAgent.runs.postActivity({ runId: run.id, kind: "thought", body: "Planning" });
    const asked = await asAgent.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Cap the discount at the subtotal.",
    });
    await earlier({ startedAt: ago(20 * minute), waitingSince: ago(7 * minute) });

    await asAdmin.gates.approve({ requestId: asked.id, note: "Reads right" });

    const read = await asAdmin.runs.get({ runId: run.id });
    expect(read.status).toBe("active");
    expectAbout(read.timing.waitingMs, 7 * minute);
    expectAbout(read.timing.workingMs, 13 * minute);
  });

  it("adds up a Run's waits at two Gates, ruled on one after the other", async () => {
    const { asAdmin, asAgent, run, earlier } = await workspaceWithAgent();
    await asAgent.runs.postActivity({ runId: run.id, kind: "thought", body: "Planning" });
    await earlier({ startedAt: ago(40 * minute) });

    const plan = await asAgent.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Cap the discount at the subtotal.",
    });
    await earlier({ waitingSince: ago(12 * minute) });
    await asAdmin.gates.approve({ requestId: plan.id });

    const ship = await asAgent.gates.request({
      runId: run.id,
      checkpoint: "ship",
      proposal: "The pull request is up.",
    });
    await earlier({ waitingSince: ago(8 * minute) });
    await asAdmin.gates.approve({ requestId: ship.id });

    const read = await asAdmin.runs.get({ runId: run.id });
    expect(read.status).toBe("active");
    expectAbout(read.timing.waitingMs, 20 * minute);
    expectAbout(read.timing.workingMs, 20 * minute);
    // The feed says the same; only the working clock is still running.
    const [listed] = (await asAdmin.runs.list({})).runs;
    expect(listed?.timing.waitingMs).toBe(read.timing.waitingMs);
    expectAbout(listed?.timing.workingMs ?? 0, 20 * minute);
  });

  /**
   * Time is the one thing deevy says about what a Run cost, because it is the
   * one thing deevy saw: a token or a dollar is only ever a client's report,
   * and deevy no longer takes one (docs/plans/simplify.md, slice 3).
   */
  it("is all a Run says about what it cost, on its page and in the feed", async () => {
    const { asAdmin, asAgent, run } = await workspaceWithAgent();
    await asAgent.runs.postActivity({ runId: run.id, kind: "thought", body: "Reading" });

    const read = await asAdmin.runs.get({ runId: run.id });
    const [listed] = (await asAdmin.runs.list({})).runs;

    for (const shown of [read, listed]) {
      expect(shown).toHaveProperty("timing");
      expect(shown).not.toHaveProperty("usage");
    }
  });

  it("counts a wait still going until now, and a finished Run until it finished", async () => {
    const { asAdmin, asAgent, run, earlier } = await workspaceWithAgent();
    await asAgent.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });
    await earlier({ startedAt: ago(8 * minute), waitingSince: ago(3 * minute) });

    const waiting = await asAdmin.runs.get({ runId: run.id });
    expectAbout(waiting.timing.waitingMs, 3 * minute);
    expectAbout(waiting.timing.workingMs, 5 * minute);

    // Finishing while it waits closes the wait, and the clocks stop.
    await asAgent.runs.finish({ runId: run.id, status: "failed", summary: "Gave up" });
    const finished = await asAdmin.runs.get({ runId: run.id });
    expectAbout(finished.timing.waitingMs, 3 * minute);
    const later = await asAdmin.runs.list({});
    expect(later.runs[0]?.timing).toEqual(finished.timing);
  });

  it("calls a stale Run's silence working time: nobody was waiting on a Human", async () => {
    const { asAdmin, asAgent, run, earlier } = await workspaceWithAgent();
    await asAgent.runs.postActivity({ runId: run.id, kind: "thought", body: "Reading" });
    await earlier({ startedAt: ago(60 * minute), status: "stale" });

    const read = await asAdmin.runs.get({ runId: run.id });

    expectAbout(read.timing.workingMs, 60 * minute);
    expect(read.timing.waitingMs).toBe(0);
  });

  it("starts waiting from its first act when its first act is a Gate", async () => {
    const { asAdmin, asAgent, run, earlier } = await workspaceWithAgent();
    await asAgent.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });
    await earlier({ startedAt: ago(4 * minute), waitingSince: ago(4 * minute) });

    const read = await asAdmin.runs.get({ runId: run.id });

    expectAbout(read.timing.waitingMs, 4 * minute);
    expect(read.timing.workingMs).toBeLessThan(slack);
  });
});
