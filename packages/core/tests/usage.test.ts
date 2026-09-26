import { run as runTable } from "@deevy/db";
import { eq } from "drizzle-orm";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, seedProject, testDb } from "./helpers.ts";

/**
 * What a Run spent, as the client running its Agent reports it
 * (docs/plans/run-usage.md, slice 0). deevy never runs an Agent, so every
 * number here is a report: added up per Run, replaced when the same report
 * comes again, and never priced by deevy itself.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function workspaceWithAgent() {
  const { db, close } = testDb();
  closers.push(close);
  const admin = await memberContext(db, { role: "admin", name: "Ada" });
  const { sockets } = fakeSockets();
  const asAdmin = createRouterClient(router, { context: { ...admin, sockets } });
  const seeded = await seedProject(db, admin.workspace.id);
  const issue = await seeded.record({ externalId: "1", title: "Ship the thing" });
  const agent = await agentContext(db, { sponsor: admin.member, grants: [seeded.project.id] });
  const other = await agentContext(db, {
    name: "Builder",
    handle: "builder",
    email: "builder@example.com",
    sponsor: admin.member,
    grants: [seeded.project.id],
  });
  const asAgent = createRouterClient(router, { context: { ...agent, sockets } });
  const run = await asAgent.runs.start({ issue: issue.url });
  return {
    db,
    asAdmin,
    asAgent,
    asOther: createRouterClient(router, { context: { ...other, sockets } }),
    issue,
    run,
    seeded,
  };
}

/** One session of Claude Code, as its result reports it per model. */
const claudeSession = {
  harness: "claude-code",
  models: [
    {
      model: "claude-opus-5-5",
      inputTokens: 1_200,
      outputTokens: 3_400,
      cacheReadTokens: 250_000,
      cacheWriteTokens: 18_000,
      costUsd: 1.25,
      costBasis: "list" as const,
    },
    {
      model: "claude-haiku-4-5",
      inputTokens: 900,
      outputTokens: 300,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.05,
      costBasis: "list" as const,
    },
  ],
};

describe("a usage report", () => {
  it("adds what a session spent to the Run, by model, and says the Run's totals", async () => {
    const { asAgent, asAdmin, run } = await workspaceWithAgent();

    const totals = await asAgent.runs.reportUsage({
      runId: run.id,
      report: "session-1",
      ...claudeSession,
    });

    const expected = {
      inputTokens: 2_100,
      outputTokens: 3_700,
      cacheReadTokens: 250_000,
      cacheWriteTokens: 18_000,
      costUsd: 1.3,
      unpricedTokens: 0,
      reports: 1,
    };
    expect(totals).toEqual(expected);
    const read = await asAdmin.runs.get({ runId: run.id });
    expect(read.usage).toMatchObject(expected);
    expect(read.usage.models).toEqual([
      {
        harness: "claude-code",
        model: "claude-haiku-4-5",
        inputTokens: 900,
        outputTokens: 300,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.05,
        costBasis: "list",
      },
      {
        harness: "claude-code",
        model: "claude-opus-5-5",
        inputTokens: 1_200,
        outputTokens: 3_400,
        cacheReadTokens: 250_000,
        cacheWriteTokens: 18_000,
        costUsd: 1.25,
        costBasis: "list",
      },
    ]);
    const listed = await asAdmin.runs.list({});
    expect(listed.runs[0]?.usage).toEqual(expected);
  });

  it("replaces itself when it comes again, because a harness's totals run on", async () => {
    const { asAgent, run } = await workspaceWithAgent();
    await asAgent.runs.reportUsage({ runId: run.id, report: "session-1", ...claudeSession });

    // The same session later, or the same call retried: its latest totals.
    const totals = await asAgent.runs.reportUsage({
      runId: run.id,
      report: "session-1",
      harness: "claude-code",
      models: [{ model: "claude-opus-5-5", inputTokens: 5_000, outputTokens: 6_000, costUsd: 2 }],
    });

    expect(totals).toMatchObject({
      inputTokens: 5_000,
      outputTokens: 6_000,
      cacheReadTokens: 0,
      costUsd: 2,
      reports: 1,
    });
  });

  it("adds up across sessions, as a Run resumed after a Gate is a new one", async () => {
    const { asAgent, run } = await workspaceWithAgent();
    await asAgent.runs.reportUsage({ runId: run.id, report: "session-1", ...claudeSession });

    const totals = await asAgent.runs.reportUsage({
      runId: run.id,
      report: "session-2",
      ...claudeSession,
    });

    expect(totals).toMatchObject({ inputTokens: 4_200, costUsd: 2.6, reports: 2 });
  });

  it("keeps tokens nobody priced apart from the cost, and never prices them", async () => {
    const { asAgent, asAdmin, run } = await workspaceWithAgent();
    await asAgent.runs.reportUsage({
      runId: run.id,
      report: "cursor-1",
      harness: "cursor",
      models: [{ model: "gpt-5", inputTokens: 1_000, outputTokens: 500 }],
    });

    const unpriced = await asAdmin.runs.get({ runId: run.id });
    expect(unpriced.usage).toMatchObject({ costUsd: null, unpricedTokens: 1_500 });
    expect(unpriced.usage.models[0]).toMatchObject({ costUsd: null, costBasis: null });

    const mixed = await asAgent.runs.reportUsage({
      runId: run.id,
      report: "session-1",
      ...claudeSession,
    });
    expect(mixed).toMatchObject({ costUsd: 1.3, unpricedTokens: 1_500 });
  });

  it("keeps money in whole micro-dollars, so a hundred reports of ten cents are ten dollars", async () => {
    const { asAgent, run } = await workspaceWithAgent();

    let totals = null;
    for (let index = 0; index < 100; index += 1) {
      totals = await asAgent.runs.reportUsage({
        runId: run.id,
        report: `session-${String(index)}`,
        harness: "opencode",
        models: [{ model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0.1 }],
      });
    }

    expect(totals).toMatchObject({ costUsd: 10, reports: 100 });
  });

  it("appends an Event with the Run's new totals, so the Run's page moves", async () => {
    const { asAgent, asAdmin, run } = await workspaceWithAgent();
    await asAgent.runs.reportUsage({ runId: run.id, report: "session-1", ...claudeSession });

    const { events } = await asAdmin.events.list({ kindPrefix: "run" });
    const reported = events.filter((event) => event.kind === "run.usage_reported");

    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      kind: "run.usage_reported",
      subjectType: "run",
      subjectId: run.id,
      payload: { report: "session-1", harness: "claude-code", costUsd: 1.3, reports: 1 },
    });
  });
});

describe("who may report", () => {
  it("is the Run's own Agent: not another Agent, and not a Human", async () => {
    const { asOther, asAdmin, run } = await workspaceWithAgent();

    await expect(
      asOther.runs.reportUsage({ runId: run.id, report: "s", ...claudeSession }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "This Run belongs to another Agent" });
    await expect(
      asAdmin.runs.reportUsage({ runId: run.id, report: "s", ...claudeSession }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is still the Agent for a day after the Run finished, and then nobody", async () => {
    const { db, asAgent, run } = await workspaceWithAgent();
    await asAgent.runs.finish({ runId: run.id, status: "completed", summary: "Done" });

    // The session that finished the Run reports after it did.
    await expect(
      asAgent.runs.reportUsage({ runId: run.id, report: "s1", ...claudeSession }),
    ).resolves.toMatchObject({ reports: 1 });

    await db
      .update(runTable)
      .set({ finishedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(runTable.id, run.id));
    await expect(
      asAgent.runs.reportUsage({ runId: run.id, report: "s2", ...claudeSession }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This Run finished more than a day ago; its usage is closed",
    });
  });
});

describe("what a report may say", () => {
  it("refuses the same model twice, a negative count, a cost over $10,000, or too many models", async () => {
    const { asAgent, run } = await workspaceWithAgent();
    const one = { model: "m", inputTokens: 1, outputTokens: 1 };

    for (const models of [
      [one, one],
      [{ ...one, inputTokens: -1 }],
      [
        { ...one, costUsd: 6_000 },
        { ...one, model: "n", costUsd: 4_001 },
      ],
      Array.from({ length: 21 }, (_, index) => ({ ...one, model: `m${String(index)}` })),
      [],
    ]) {
      await expect(
        asAgent.runs.reportUsage({ runId: run.id, report: "s", harness: "x", models }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("stops at a hundred reports a Run, while the ones it has may still be replaced", async () => {
    const { asAgent, run } = await workspaceWithAgent();
    const models = [{ model: "m", inputTokens: 1, outputTokens: 1 }];
    for (let index = 0; index < 100; index += 1) {
      await asAgent.runs.reportUsage({
        runId: run.id,
        report: `s${String(index)}`,
        harness: "x",
        models,
      });
    }

    await expect(
      asAgent.runs.reportUsage({ runId: run.id, report: "s100", harness: "x", models }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "A Run takes at most 100 usage reports",
    });
    await expect(
      asAgent.runs.reportUsage({ runId: run.id, report: "s99", harness: "x", models }),
    ).resolves.toMatchObject({ reports: 100 });
  });

  it("is nothing on a Run nobody reported for", async () => {
    const { asAdmin, run } = await workspaceWithAgent();

    const read = await asAdmin.runs.get({ runId: run.id });

    expect(read.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: null,
      unpricedTokens: 0,
      reports: 0,
      models: [],
    });
  });
});
