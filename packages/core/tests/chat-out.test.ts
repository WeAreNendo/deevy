import { memberIdentity, socket as socketTable, type Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { newId } from "../src/ids.ts";
import { router } from "../src/operations/index.ts";
import { sealSecret } from "../src/secrets.ts";
import type { ChatInteraction } from "../src/sockets/port.ts";
import { deliverDueChatMessages } from "../src/work.ts";
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
 * What deevy says in Slack (ADR-0025): a Gate in the channel its Project binds
 * (docs/plans/simplify.md, slice 8), with its two buttons, and the same
 * message changed wherever the Ruling came from.
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
      message: chat.posted.find((one) => one.message.kind === "gate")?.ref ?? null,
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
  /** The Project's channel, bound as an admin binds it: deevy says hello there first. */
  const bind = () =>
    asAda.projects.update({ slug: "deevy", chat: { socketId: slackId, channel: "C0DEEVY" } });
  /** The Gate's one message, whichever else was posted. */
  const gateMessage = () => chat.posted.find((one) => one.message.kind === "gate");
  return {
    ada,
    grace,
    asAda,
    asGrace,
    asPlanner,
    run,
    chat,
    slackId,
    send,
    click,
    bind,
    gateMessage,
    seeded,
    issue,
  };
}

describe("a Gate in a Project's Slack channel", () => {
  it("is posted with its buttons where the Project binds, and deevy remembers where", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asPlanner, run, slackId, send, bind, gateMessage } = await posting(db);
    await bind();

    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Ship it",
    });
    const sent = await send();

    expect(sent.delivered).toBe(1);
    const inRoom = gateMessage();
    expect(inRoom?.channel).toBe("C0DEEVY");
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
    // The message it posted about the Gate, so a Ruling can change it.
    const kept = await db.query.socketMirror.findMany({ where: { gateRequestId: gate.id } });
    expect(kept).toContainEqual(
      expect.objectContaining({
        socketId: slackId,
        kind: "message",
        externalRef: { channel: "C0DEEVY", ts: inRoom?.ref.ts },
      }),
    );
    expect(kept).toHaveLength(1);
  });

  it("is changed through the outbox when somebody rules in Slack, and when they rule in deevy", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asPlanner, run, chat, send, click, bind, gateMessage } = await posting(db);
    await bind();
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
    const posted = gateMessage();

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
    await send();
    expect(inRoom().at(-1)).toMatchObject({
      message: { kind: "gate", gate: { status: "approved", approvals: 2 } },
    });
  });

  it("names the approvals its Checkpoint wants after the Project's Checkpoints are saved", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asPlanner, run, chat, send, click, bind, gateMessage } = await posting(db);
    await bind();
    await asAda.checkpoints.set({
      projectSlug: "deevy",
      checkpoints: [{ name: "plan", approvalsRequired: 3 }],
    });
    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Ship it",
    });
    await send();
    const posted = gateMessage();

    // Lowered to more than it has: it stays open, and wants two from now on.
    await asAda.checkpoints.set({
      projectSlug: "deevy",
      checkpoints: [{ name: "plan", approvalsRequired: 2 }],
    });
    await click("U0GRACE", gate.id);
    await send();

    const inRoom = chat.updated.filter((one) => one.ref.ts === posted?.ref.ts);
    expect(inRoom.at(-1)).toMatchObject({
      message: { kind: "gate", gate: { status: "open", approvals: 1, required: 2 } },
    });
  });

  it("is changed when an admin lowers Approvals to what the Gate already has", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asPlanner, run, chat, send, click, bind, gateMessage } = await posting(db);
    await bind();
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
    const posted = gateMessage();
    await click("U0GRACE", gate.id);
    await send();

    await asAda.checkpoints.set({
      projectSlug: "deevy",
      checkpoints: [{ name: "plan", approvalsRequired: 1 }],
    });
    await send();

    const inRoom = chat.updated.filter((one) => one.ref.ts === posted?.ref.ts);
    expect(inRoom.at(-1)).toMatchObject({
      message: { kind: "gate", gate: { status: "approved", approvals: 1 } },
    });
  });
});
