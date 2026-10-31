import type { Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { setAgentWebhook } from "../src/agents.ts";
import { router } from "../src/operations/index.ts";
import type { InboundEvent } from "../src/sockets/port.ts";
import { sweepStaleRuns } from "../src/work.ts";
import { agentContext, externalIssue, memberContext, seedProject, testDb } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * A question goes in the tracker (docs/plans/simplify.md, slice 5).
 *
 * An Agent that needs to know something asks on the record, in a comment it
 * writes with its own access, and a Human answers there too. The reply that
 * mentions it is what reaches it: a `mention` in its inbox and on its webhook.
 * So deevy has nothing for asking and nothing for answering, and a Run waits
 * only at a Gate, the one thing in deevy a Human has to come and do.
 */
async function workspace(db: Db) {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const seeded = await seedProject(db, ada.workspace.id);
  const planner = await agentContext(db, {
    name: "Planner",
    handle: "planner",
    email: "planner@example.com",
    sponsor: ada.member,
    grants: [seeded.project.id],
  });
  await seeded.deliver([record({ labels: ["agent:planner"] })]);
  const asPlanner = createRouterClient(router, { context: planner });
  const [run] = (await asPlanner.runs.list({})).runs;
  if (!run) throw new Error("the routing label opened no Run");
  return {
    ada,
    planner,
    seeded,
    run,
    asAda: createRouterClient(router, { context: ada }),
    asPlanner,
  };
}

/** Record 42, as the tracker delivers it. */
function record(over: { labels?: string[] } = {}): InboundEvent {
  return {
    kind: "issue",
    scopeKey: "acme/deevy",
    issue: externalIssue({ externalId: "42", title: "Cap the coupon", ...over }),
    actor: { login: "ada-on-github", id: "gh-1", isBot: false },
  };
}

/** A Human's comment on record 42, as the tracker delivers it. */
function reply(body: string, externalId = "c1"): InboundEvent {
  return {
    kind: "comment",
    scopeKey: "acme/deevy",
    issueExternalId: "42",
    comment: {
      externalId,
      url: `https://tracker.test/acme/deevy#42-${externalId}`,
      body,
      author: { login: "ada-on-github", id: "gh-1", isBot: false },
      createdAt: new Date(),
    },
  };
}

describe("a Run", () => {
  it("is not left waiting by anything the Agent posts, only by a Gate", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, run } = await workspace(db);

    for (const kind of ["thought", "action", "response", "error"] as const) {
      const posted = await asPlanner.runs.postActivity({ runId: run.id, kind, body: `A ${kind}` });
      expect(posted.run.status).toBe("active");
    }
    // A question is not a kind of Activity: the Agent asks it on the record.
    await expect(
      asPlanner.runs.postActivity({
        runId: run.id,
        kind: "elicitation" as "thought",
        body: "Which currency should the cap use?",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await asPlanner.runs.get({ runId: run.id })).status).toBe("active");
    expect(await db.query.event.findMany({ where: { kind: "run.awaiting_input" } })).toEqual([]);
  });

  it("waits at its Gate and carries on when it is ruled, with nothing written in its feed for it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asPlanner, planner, run } = await workspace(db);
    await asPlanner.runs.postActivity({ runId: run.id, kind: "thought", body: "Reading it" });

    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Cap the discount at the subtotal.",
    });
    expect((await asPlanner.runs.get({ runId: run.id })).status).toBe("awaiting_input");
    await asAda.gates.approve({ requestId: gate.id, note: "Reads right" });

    const after = await asPlanner.runs.get({ runId: run.id });
    expect(after.status).toBe("active");
    // The feed is what the Agent said. The Gate, its Proposal and its Ruling
    // are the Gate's own, beside the feed, and `gates_get` reads them.
    expect(after.activities.map((one) => one.kind)).toEqual(["thought"]);
    // Told once that somebody ruled, beside the assignment that routed it.
    const told = await db.query.notification.findMany({
      where: { recipientMemberId: planner.member.id },
    });
    expect(told.map((row) => row.kind).sort()).toEqual(["assignment", "run_answered"]);
  });

  it("waiting at a Gate is left alone by the stale sweep", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asPlanner, run } = await workspace(db);
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Cap it." });

    const swept = await sweepStaleRuns({
      db,
      workspaceId: ada.workspace.id,
      now: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    expect(swept.changed).toBe(0);
    expect((await asPlanner.runs.get({ runId: run.id })).status).toBe("awaiting_input");
  });
});

describe("a reply in the tracker", () => {
  it("that mentions an Agent working the record reaches its inbox and its webhook, and opens no second Run", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asPlanner, planner, seeded, run } = await workspace(db);
    await setAgentWebhook(
      db,
      planner.member.id,
      ada.workspace.id,
      "https://agents.example.com/planner",
      "a-secret-the-agent-checks",
    );
    await asPlanner.runs.postActivity({
      runId: run.id,
      kind: "action",
      body: "Asked on the record",
    });

    await seeded.deliver([reply("@planner use the basket's currency")]);

    const runs = (await asPlanner.runs.list({})).runs;
    expect(runs.map((one) => one.id)).toEqual([run.id]);
    const inbox = (await asPlanner.inbox.list({ unreadOnly: true })).notifications;
    const mentions = inbox.filter((row) => row.kind === "mention");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({
      issue: { externalKey: "acme/deevy#42" },
      comment: { body: "@planner use the basket's currency" },
    });

    // The webhook carries every comment in the Agent's Projects; what makes
    // this one the answer it is waiting for is that the comment names it.
    const said = await db.query.event.findFirst({ where: { kind: "comment.created" } });
    expect(said?.payload).toMatchObject({ mentionedMemberIds: [planner.member.id] });
    const owed = await db.query.delivery.findMany({
      where: { target: "webhook", eventSeq: said?.seq ?? -1 },
    });
    expect(owed).toHaveLength(1);
  });

  it("reaches an Agent whose asking Run went quiet, which takes it up again", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asPlanner, seeded, run } = await workspace(db);
    await asPlanner.runs.postActivity({
      runId: run.id,
      kind: "action",
      body: "Asked on the record which currency the cap uses",
    });
    // A question is no wait, so half an hour of silence is a stale Run, and
    // that is what agent-loop.md tells the Agent to expect.
    await sweepStaleRuns({
      db,
      workspaceId: ada.workspace.id,
      now: new Date(Date.now() + 31 * 60 * 1000),
    });
    expect((await asPlanner.runs.get({ runId: run.id })).status).toBe("stale");

    await seeded.deliver([reply("@planner the basket's")]);

    expect((await asPlanner.runs.list({})).runs.map((one) => one.id)).toEqual([run.id]);
    const inbox = (await asPlanner.inbox.list({ unreadOnly: true })).notifications;
    expect(inbox.filter((row) => row.kind === "mention")).toHaveLength(1);
    const resumed = await asPlanner.runs.postActivity({
      runId: run.id,
      kind: "thought",
      body: "The basket's currency, then",
    });
    expect(resumed.run.status).toBe("active");
  });

  it("that mentions an Agent with no open Run on the record opens one, as before", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, seeded, run } = await workspace(db);
    await asPlanner.runs.finish({ runId: run.id, status: "completed", summary: "Capped it." });

    await seeded.deliver([reply("@planner and the shipping too", "c2")]);

    const runs = (await asPlanner.runs.list({})).runs;
    expect(runs).toHaveLength(2);
    expect(runs.find((one) => one.id !== run.id)).toMatchObject({
      trigger: "mention",
      status: "pending",
    });
  });
});

describe("what a Human is no longer asked", () => {
  it("answers no question of a Run's, over the API or as a preference", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await workspace(db);

    expect(Object.keys(router.runs)).not.toContain("answer");
    const offered = (await asAda.preferences.get({})).preferences.map((row) => row.kind);
    expect(offered).not.toContain("run_awaiting_input");
  });
});
