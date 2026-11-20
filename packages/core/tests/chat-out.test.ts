import { socket as socketTable, type Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { newId } from "../src/ids.ts";
import { router } from "../src/operations/index.ts";
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

/**
 * What deevy says in Slack: a Gate in the channel its Project binds
 * (docs/plans/simplify.md, slice 8), with a link to rule on it in deevy (slice
 * 10, ADR-0036), and the same message changed when somebody rules.
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
  });
  const asAda = createRouterClient(router, { context: { ...ada, sockets } });
  const asGrace = createRouterClient(router, { context: { ...grace, sockets } });
  const asPlanner = createRouterClient(router, { context: { ...planner, sockets } });
  const run = await asPlanner.runs.start({ issue: issue.url });
  const send = () =>
    deliverDueChatMessages({
      db,
      workspaceId: ada.workspace.id,
      sockets,
      socketSecret: testSealingSecret,
      baseUrl: "https://deevy.test",
    });
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
    bind,
    gateMessage,
    seeded,
    issue,
  };
}

describe("a Gate in a Project's Slack channel", () => {
  it("is posted with its link where the Project binds, and deevy remembers where", async () => {
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

  it("is changed through the outbox on each Ruling, never while it is made", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asGrace, asPlanner, run, chat, send, bind, gateMessage } = await posting(db);
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

    // The Ruling is answered at once, and the message changes after.
    await asGrace.gates.approve({ requestId: gate.id });
    expect(chat.updated).toEqual([]);
    await send();
    const inRoom = () => chat.updated.filter((one) => one.ref.ts === posted?.ref.ts);
    expect(inRoom().at(-1)).toMatchObject({
      message: { kind: "gate", gate: { status: "open", approvals: 1, required: 2 } },
    });

    // The second Ruling changes the same message.
    await asAda.gates.approve({ requestId: gate.id, note: "Fine by me" });
    await send();
    expect(inRoom().at(-1)).toMatchObject({
      message: { kind: "gate", gate: { status: "approved", approvals: 2 } },
    });
  });

  it("names the approvals its Checkpoint wants after the Project's Checkpoints are saved", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asGrace, asPlanner, run, chat, send, bind, gateMessage } = await posting(db);
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
    await asGrace.gates.approve({ requestId: gate.id });
    await send();

    const inRoom = chat.updated.filter((one) => one.ref.ts === posted?.ref.ts);
    expect(inRoom.at(-1)).toMatchObject({
      message: { kind: "gate", gate: { status: "open", approvals: 1, required: 2 } },
    });
  });

  it("is changed when an admin lowers Approvals to what the Gate already has", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asGrace, asPlanner, run, chat, send, bind, gateMessage } = await posting(db);
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
    await asGrace.gates.approve({ requestId: gate.id });
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
