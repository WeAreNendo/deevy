import { memberIdentity, socket as socketTable, type Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { newId } from "../src/ids.ts";
import { router } from "../src/operations/index.ts";
import { sealSecret } from "../src/secrets.ts";
import type { ChatInteraction } from "../src/sockets/port.ts";
import { deliverDueChannelMessages, deliverDueChatMessages } from "../src/work.ts";
import {
  agentContext,
  fakeChat,
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

const signingSecret = "a-slack-signing-secret-for-tests";

/**
 * What deevy says in Slack (ADR-0025): a Gate in a room, with its two buttons,
 * and the same message changed wherever the Ruling came from.
 */
async function posting(db: Db) {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const grace = await memberContext(db, { name: "Grace", email: "grace@example.com" });
  await memberContext(db, { name: "Omar", email: "omar@example.com" });
  const seeded = await seedProject(db, ada.workspace.id);
  const issue = await seeded.record({ externalId: "42", title: "Checkout rewrite" });
  const planner = await agentContext(db, {
    name: "Planner",
    handle: "planner",
    email: "planner@example.com",
    sponsor: ada.member,
    grants: [seeded.project.id],
  });
  const chat = fakeChat();
  const sockets = { ...fakeSockets().sockets, ...chat.sockets };

  const slackId = newId("socket");
  await db.insert(socketTable).values({
    id: slackId,
    workspaceId: ada.workspace.id,
    provider: "slack",
    capabilities: ["chat"],
    name: "Acme Slack",
    identity: { login: "deevy", id: "U0DEEVY", mentionHandle: "@deevy" },
    config: { teamId: "T0TEST" },
    webhookSecret: await sealSecret(testSealingSecret, signingSecret),
  });
  await db.insert(memberIdentity).values({
    id: newId("memberIdentity"),
    workspaceId: ada.workspace.id,
    memberId: grace.member.id,
    provider: "slack",
    instance: "T0TEST",
    externalUserId: "U0GRACE",
    externalLogin: "grace",
    verifiedBy: "link_code",
  });

  const asAda = createRouterClient(router, { context: { ...ada, sockets } });
  const asGrace = createRouterClient(router, { context: { ...grace, sockets } });
  const asPlanner = createRouterClient(router, { context: { ...planner, sockets } });
  const app = createApp({
    db,
    sockets,
    socketSecret: testSealingSecret,
    webURL: "https://deevy.test",
  });

  const run = await asPlanner.runs.start({ issue: issue.url });
  const send = () =>
    deliverDueChatMessages({
      db,
      workspaceId: ada.workspace.id,
      sockets,
      socketSecret: testSealingSecret,
      baseUrl: "https://deevy.test",
    });
  const click = async (user: string, gateRequestId: string) => {
    const body = JSON.stringify({
      kind: "ruling",
      actor: { team: "T0TEST", user, login: user },
      gateRequestId,
      decision: "approved",
      note: null,
      wantsNote: false,
      message: chat.posted[0]?.ref ?? null,
      responseUrl: "https://hooks.slack.test/actions/1",
      triggerId: null,
    } satisfies ChatInteraction);
    return app.request(`/hooks/${slackId}`, {
      method: "POST",
      headers: {
        "x-test-event": "block_actions",
        "x-test-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-test-signature": `${signingSecret}:${String(body.length)}`,
      },
      body,
    });
  };
  return { ada, grace, asAda, asGrace, asPlanner, run, chat, slackId, send, click, seeded, issue };
}

describe("a Gate in a Slack room", () => {
  it("is posted with its buttons where a rule sends it, and deevy remembers where", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asPlanner, run, chat, slackId, send } = await posting(db);
    const room = await asAda.channels.createInSocket({
      name: "#deevy",
      socketId: slackId,
      conversation: "C0DEEVY",
    });
    await asAda.routing.set({
      rules: [{ notificationKind: "gate_awaiting", projectId: null, channelId: room.id }],
    });

    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Ship it",
    });
    const sent = await send();

    expect(sent.delivered).toBeGreaterThanOrEqual(1);
    const inRoom = chat.posted.find((one) => one.channel === "C0DEEVY");
    expect(inRoom?.message).toMatchObject({
      kind: "gate",
      gate: {
        gateRequestId: gate.id,
        checkpoint: "plan",
        proposal: "Ship it",
        status: "open",
        approvals: 0,
        required: 1,
        url: `https://deevy.test/gates/${gate.id}`,
        agentName: "Planner",
      },
    });
    // Every message it posted about the Gate — the room's, and Grace's direct
    // message, since she is linked and may rule — so a Ruling can change them all.
    const kept = await db.query.socketMirror.findMany({ where: { gateRequestId: gate.id } });
    expect(kept).toContainEqual(
      expect.objectContaining({
        socketId: slackId,
        kind: "message",
        externalRef: { channel: "C0DEEVY", ts: inRoom?.ref.ts },
      }),
    );
    expect(kept).toHaveLength(chat.posted.length);
    expect(room).toMatchObject({ kind: "slack_app", socketId: slackId, conversation: "C0DEEVY" });
  });

  it("is changed through the outbox when somebody rules in Slack, and when they rule in deevy", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asGrace, asPlanner, run, chat, slackId, send, click } = await posting(db);
    const room = await asAda.channels.createInSocket({
      name: "#deevy",
      socketId: slackId,
      conversation: "C0DEEVY",
    });
    await asAda.routing.set({
      rules: [{ notificationKind: "gate_awaiting", projectId: null, channelId: room.id }],
    });
    await asAda.checkpoints.set({
      projectSlug: "deevy",
      checkpoints: [{ name: "plan", approvalsRequired: 2 }],
    });
    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Ship it",
    });
    await send();
    const posted = chat.posted.find((one) => one.channel === "C0DEEVY");

    // From Slack: the click answers at once, and the message changes after.
    expect((await click("U0GRACE", gate.id)).status).toBe(200);
    expect(chat.updated).toEqual([]);
    await send();
    const inRoom = () => chat.updated.filter((one) => one.ref.ts === posted?.ref.ts);
    expect(inRoom().at(-1)).toMatchObject({
      message: { kind: "gate", gate: { status: "open", approvals: 1, required: 2 } },
    });

    // From deevy: the same message, because the Ruling is the same Ruling.
    await asAda.gates.approve({ requestId: gate.id, note: "Fine by me" });
    void asGrace;
    await send();
    expect(inRoom().at(-1)).toMatchObject({
      message: { kind: "gate", gate: { status: "approved", approvals: 2 } },
    });
  });
});

describe("a direct message in Slack", () => {
  it("tells a Human whose account is linked, unless they said not to", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asGrace, asPlanner, run, chat, send } = await posting(db);

    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Ship it",
    });
    await send();

    // Grace linked Slack and is an approver; Omar is an approver who did not.
    expect(chat.dms).toEqual(["U0GRACE"]);
    expect(chat.posted).toMatchObject([
      { channel: "D-U0GRACE", message: { kind: "gate", gate: { gateRequestId: gate.id } } },
    ]);

    await asGrace.preferences.set({
      preferences: [{ kind: "gate_awaiting", inbox: true, slack: true, slackDm: false }],
    });
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Ship it, v2" });
    await send();
    expect(chat.dms).toEqual(["U0GRACE"]);
  });

  it("links anything but a Gate to the record's page in deevy", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, issue, chat, send } = await posting(db);

    await asPlanner.comments.create({ issue: issue.url, body: "@grace can you look?" });
    await send();

    // The Work item, by the id deevy gave the record: `/issues/<key>` went
    // with deevy's own tracker (ADR-0024), and a key is the tracker's.
    expect(chat.posted).toMatchObject([
      {
        channel: "D-U0GRACE",
        message: {
          kind: "text",
          link: {
            url: `https://deevy.test/work/${issue.id}`,
            label: `${issue.externalKey} Checkout rewrite`,
          },
        },
      },
    ]);
  });
});

describe("the incoming-webhook Channel", () => {
  it("still posts a link and nothing to click", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, asAda, asPlanner, run, issue } = await posting(db);
    const hook = await asAda.channels.create({
      name: "#alerts",
      webhookUrl: "https://hooks.slack.com/services/T0/B0/xyz",
    });
    await asAda.routing.set({
      rules: [{ notificationKind: "gate_awaiting", projectId: null, channelId: hook.id }],
    });
    await asPlanner.gates.request({ runId: run.id, checkpoint: "plan", proposal: "Ship it" });

    const bodies: string[] = [];
    await deliverDueChannelMessages({
      db,
      workspaceId: ada.workspace.id,
      baseUrl: "https://deevy.test",
      fetch: async (_url, init) => {
        bodies.push(typeof init.body === "string" ? init.body : "");
        return new Response("ok");
      },
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("A Gate is waiting for a Human");
    expect(bodies[0]).toContain(`<https://deevy.test/work/${issue.id}|`);
    expect(bodies[0]).not.toContain("deevy_approve");
  });
});
