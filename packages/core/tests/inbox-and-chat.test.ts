import { memberIdentity, socket as socketTable, type Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { newId } from "../src/ids.ts";
import { router } from "../src/operations/index.ts";
import { sealSecret } from "../src/secrets.ts";
import type { ChatInteraction, InboundEvent } from "../src/sockets/port.ts";
import { deliverDueChatMessages, runDueWork } from "../src/work.ts";
import {
  agentContext,
  externalIssue,
  fakeChat,
  fakeSockets,
  memberContext,
  seedProject,
  testDb,
  testSealingSecret,
  type MemberContext,
} from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const signingSecret = "a-slack-signing-secret-for-tests";

/**
 * A Human's attention is the Gates they may rule on (docs/plans/simplify.md,
 * slice 8): Needs me in deevy, and the one chat channel a Project binds, where
 * each Gate is a message with Approve and Reject that changes as Rulings land.
 * Nothing else is sent to a Human: no inbox row, no direct message, no email.
 * An inbox is an Agent's, and says what it was assigned, who mentioned it and
 * how its Gate was ruled.
 */
async function workspace(db: Db, options: { channels?: boolean } = {}) {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const grace = await memberContext(db, { name: "Grace", email: "grace@example.com" });
  const omar = await memberContext(db, { name: "Omar", email: "omar@example.com" });
  const seeded = await seedProject(db, ada.workspace.id);
  const planner = await agentContext(db, {
    name: "Planner",
    handle: "planner",
    email: "planner@example.com",
    sponsor: ada.member,
    grants: [seeded.project.id],
  });
  const chat = fakeChat(
    options.channels === false
      ? { channels: null }
      : {
          channels: [
            { id: "C0DEEVY", name: "deevy" },
            { id: "C0OPS", name: "ops" },
          ],
        },
  );
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

  const app = createApp({
    db,
    sockets,
    socketSecret: testSealingSecret,
    webURL: "https://deevy.test",
  });
  const send = (options: { maxAttempts?: number } = {}) =>
    deliverDueChatMessages({
      db,
      workspaceId: ada.workspace.id,
      sockets,
      socketSecret: testSealingSecret,
      baseUrl: "https://deevy.test",
      ...options,
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
      responseUrl: `https://hooks.slack.test/actions/${user}`,
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
  const as = (context: MemberContext) =>
    createRouterClient(router, {
      context: { ...context, sockets, socketSecret: testSealingSecret },
    });
  return {
    db,
    ada,
    grace,
    omar,
    planner,
    seeded,
    chat,
    slackId,
    app,
    send,
    click,
    asAda: as(ada),
    asGrace: as(grace),
    asOmar: as(omar),
    asPlanner: as(planner),
  };
}

/** A record the tracker delivers with the Planner's label on it, which opens its Run. */
function labelled(externalId: string): InboundEvent {
  return {
    kind: "issue",
    scopeKey: "acme/deevy",
    issue: externalIssue({ externalId, title: `Record ${externalId}`, labels: ["agent:planner"] }),
    actor: { login: "ada-on-github", id: "gh-1", isBot: false },
  };
}

/** A Human's comment on a record, as the tracker delivers it. */
function comment(issueExternalId: string, body: string): InboundEvent {
  return {
    kind: "comment",
    scopeKey: "acme/deevy",
    issueExternalId,
    comment: {
      externalId: `c-${issueExternalId}`,
      url: `https://tracker.test/acme/deevy#${issueExternalId}-c`,
      body,
      author: { login: "ada-on-github", id: "gh-1", isBot: false },
      createdAt: new Date(),
    },
  };
}

/** The Planner's Run on a record it was routed, opened by the label. */
async function runOn(
  context: Awaited<ReturnType<typeof workspace>>,
  externalId: string,
): Promise<string> {
  await context.seeded.deliver([labelled(externalId)]);
  const issue = await context.db.query.issue.findFirst({ where: { externalId } });
  const found = issue
    ? await context.db.query.run.findFirst({ where: { issueId: issue.id } })
    : undefined;
  if (!found) throw new Error(`no Run opened on ${externalId}`);
  return found.id;
}

describe("a Project's chat channel", () => {
  it("is offered from the channels the chat tool lists, and typed where it lists none", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const listing = await workspace(db);
    expect(await listing.asAda.sockets.channels({ socketId: listing.slackId })).toEqual({
      channels: [
        { id: "C0DEEVY", name: "deevy" },
        { id: "C0OPS", name: "ops" },
      ],
      problem: null,
    });
    // A member who is not an admin binds nothing, so lists nothing either.
    await expect(
      listing.asGrace.sockets.channels({ socketId: listing.slackId }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const other = testDb();
    closers.push(other.close);
    const typed = await workspace(other.db, { channels: false });
    expect(await typed.asAda.sockets.channels({ socketId: typed.slackId })).toEqual({
      channels: null,
      problem: null,
    });
  });

  it("is bound by posting a line there, and the binding is in the Project and its Event", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, chat, slackId } = await workspace(db);

    const bound = await asAda.projects.update({
      slug: "deevy",
      chat: { socketId: slackId, channel: "C0DEEVY" },
    });
    expect(bound).toMatchObject({ chatSocketId: slackId, chatChannel: "C0DEEVY" });
    // The line is what proves the app can post there, while the admin is still looking.
    expect(chat.posted).toHaveLength(1);
    expect(chat.posted[0]).toMatchObject({ channel: "C0DEEVY", message: { kind: "text" } });
    expect(JSON.stringify(chat.posted[0]?.message)).toContain("Gates");

    const updated = await db.query.event.findMany({ where: { kind: "project.updated" } });
    expect(updated.at(-1)?.payload).toMatchObject({
      chat: { from: null, to: { socketId: slackId, channel: "C0DEEVY" } },
    });

    // Unbound, it says so, and posts nothing to say it.
    const unbound = await asAda.projects.update({ slug: "deevy", chat: null });
    expect(unbound).toMatchObject({ chatSocketId: null, chatChannel: null });
    expect(chat.posted).toHaveLength(1);
  });

  it("is not bound where the tool refuses the line, and says what the tool said", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, slackId } = await workspace(db);

    await expect(
      asAda.projects.update({ slug: "deevy", chat: { socketId: slackId, channel: "C0NOTIN" } }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/not_in_channel/),
    });
    expect(await asAda.projects.get({ slug: "deevy" })).toMatchObject({
      chatSocketId: null,
      chatChannel: null,
    });
  });

  it("is only a chat tool's, and only an admin's to set", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, asGrace, seeded, slackId } = await workspace(db);

    await expect(
      asAda.projects.update({
        slug: "deevy",
        chat: { socketId: seeded.socketId, channel: "C0DEEVY" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      asGrace.projects.update({ slug: "deevy", chat: { socketId: slackId, channel: "C0DEEVY" } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is undone when its chat tool is removed, and says so on the Project", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, slackId } = await workspace(db);
    await asAda.projects.update({ slug: "deevy", chat: { socketId: slackId, channel: "C0DEEVY" } });

    await asAda.sockets.remove({ socketId: slackId });

    expect(await asAda.projects.get({ slug: "deevy" })).toMatchObject({
      chatSocketId: null,
      chatChannel: null,
    });
    const updated = await db.query.event.findMany({ where: { kind: "project.updated" } });
    expect(updated.at(-1)?.payload).toMatchObject({
      chat: { from: { socketId: slackId, channel: "C0DEEVY" }, to: null },
    });
  });
});

describe("a Gate on a Project bound to a chat channel", () => {
  it("posts one message with Approve and Reject, and changes it in place on each Ruling", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await workspace(db);
    const { asAda, asPlanner, chat, slackId, send, click } = context;
    await asAda.projects.update({ slug: "deevy", chat: { socketId: slackId, channel: "C0DEEVY" } });
    await asAda.checkpoints.set({
      projectSlug: "deevy",
      checkpoints: [{ name: "ship", approvalsRequired: 2 }],
    });
    const runId = await runOn(context, "42");

    const gate = await asPlanner.gates.request({ runId, checkpoint: "ship", proposal: "Ship it" });
    await send();
    // A second pass owes nothing: one Gate is one message.
    await send();
    const posted = chat.posted.filter((one) => one.message.kind === "gate");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      channel: "C0DEEVY",
      message: {
        kind: "gate",
        gate: { gateRequestId: gate.id, status: "open", approvals: 0, required: 2 },
      },
    });
    const ref = posted[0]?.ref;

    // Grace rules from the button, her Slack account linked: it counts.
    expect((await click("U0GRACE", gate.id)).status).toBe(200);
    await send();
    expect(chat.updated.at(-1)).toMatchObject({
      ref,
      message: { gate: { status: "open", approvals: 1, required: 2 } },
    });

    // Ada rules in deevy, and the same message says so.
    await asAda.gates.approve({ requestId: gate.id });
    await send();
    expect(chat.updated.at(-1)).toMatchObject({
      ref,
      message: { gate: { status: "approved", approvals: 2 } },
    });
    expect(chat.updated.every((one) => one.ref.ts === ref?.ts)).toBe(true);
    expect(chat.posted.filter((one) => one.message.kind === "gate")).toHaveLength(1);
  });

  it("answers a click from an account nobody linked in private, and rules nothing", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await workspace(db);
    const { asAda, asPlanner, chat, slackId, send, click } = context;
    await asAda.projects.update({ slug: "deevy", chat: { socketId: slackId, channel: "C0DEEVY" } });
    const runId = await runOn(context, "42");
    const gate = await asPlanner.gates.request({ runId, checkpoint: "plan", proposal: "Ship it" });
    await send();

    expect((await click("U0OMAR", gate.id)).status).toBe(200);
    expect(chat.responses).toEqual([
      expect.objectContaining({
        responseUrl: "https://hooks.slack.test/actions/U0OMAR",
        text: expect.stringMatching(/doesn't know whose Slack account/),
      }),
    ]);
    expect((await asAda.gates.get({ requestId: gate.id })).status).toBe("open");
    const refused = await db.query.event.findMany({ where: { kind: "gate.ruling_refused" } });
    expect(refused.map((row) => (row.payload as { reason?: string }).reason)).toEqual([
      "unknown_identity",
    ]);
  });

  it("is posted nowhere when the Project binds no channel", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await workspace(db);
    const runId = await runOn(context, "42");
    await context.asPlanner.gates.request({ runId, checkpoint: "plan", proposal: "Ship it" });

    expect((await context.send()).scanned).toBe(0);
    expect(context.chat.posted).toEqual([]);
  });

  it("says a Ruling made while it was being posted, rather than offering buttons that would be refused", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await workspace(db);
    const { asAda, asPlanner, chat, slackId, send } = context;
    await asAda.projects.update({ slug: "deevy", chat: { socketId: slackId, channel: "C0DEEVY" } });
    const runId = await runOn(context, "42");
    const gate = await asPlanner.gates.request({ runId, checkpoint: "plan", proposal: "Ship it" });
    // Ada approves in deevy while Slack has the post and has not answered:
    // deevy does not know yet where the message is, so her Ruling owes it
    // nothing, and the message as posted still offers Approve.
    chat.whilePosting = async () => {
      chat.whilePosting = null;
      await asAda.gates.approve({ requestId: gate.id });
    };

    await send();
    const posted = chat.posted.filter((one) => one.message.kind === "gate");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.message).toMatchObject({ gate: { status: "open" } });
    expect(chat.updated).toEqual([
      expect.objectContaining({
        ref: posted[0]?.ref,
        message: expect.objectContaining({
          gate: expect.objectContaining({ status: "approved", approvals: 1 }),
        }),
      }),
    ]);
  });

  it("owes that update to the outbox when the tool refuses it then, and sends it on the next pass", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await workspace(db);
    const { asAda, asPlanner, chat, slackId, send } = context;
    await asAda.projects.update({ slug: "deevy", chat: { socketId: slackId, channel: "C0DEEVY" } });
    const runId = await runOn(context, "42");
    const gate = await asPlanner.gates.request({ runId, checkpoint: "plan", proposal: "Ship it" });
    chat.whilePosting = async () => {
      chat.whilePosting = null;
      await asAda.gates.approve({ requestId: gate.id });
      // Slack has a blip just as deevy goes to correct the message.
      chat.refusing.add("C0DEEVY");
    };

    await send();
    expect(chat.updated).toEqual([]);
    chat.refusing.delete("C0DEEVY");
    expect(await send()).toMatchObject({ delivered: 1 });
    expect(chat.updated).toEqual([
      expect.objectContaining({
        ref: chat.posted[chat.posted.length - 1]?.ref,
        message: expect.objectContaining({
          gate: expect.objectContaining({ status: "approved" }),
        }),
      }),
    ]);
  });

  it("says in its chat tool's history when it could not be posted, and stops trying", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await workspace(db);
    const { asAda, asPlanner, chat, slackId, send } = context;
    await asAda.projects.update({ slug: "deevy", chat: { socketId: slackId, channel: "C0DEEVY" } });
    // The app was taken out of the channel after it said hello.
    chat.refusing.add("C0DEEVY");
    const runId = await runOn(context, "42");
    await asPlanner.gates.request({ runId, checkpoint: "plan", proposal: "Ship it" });

    expect(await send({ maxAttempts: 1 })).toMatchObject({ delivered: 0, gaveUp: 1 });
    const exhausted = await db.query.event.findMany({
      where: { kind: "socket.mirror_exhausted" },
    });
    expect(exhausted).toEqual([
      expect.objectContaining({
        subjectType: "socket",
        subjectId: slackId,
        payload: expect.objectContaining({ name: "Acme Slack" }),
      }),
    ]);
  });

  it("goes to the channel the Project binds when it is sent, and to none once it is unbound", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await workspace(db);
    const { asAda, asPlanner, chat, slackId, send } = context;
    await asAda.projects.update({ slug: "deevy", chat: { socketId: slackId, channel: "C0DEEVY" } });
    const runId = await runOn(context, "42");
    await asPlanner.gates.request({ runId, checkpoint: "plan", proposal: "Ship it" });
    await asAda.projects.update({ slug: "deevy", chat: null });

    const sent = await send();
    expect(sent.gaveUp).toBe(1);
    expect(chat.posted.filter((one) => one.message.kind === "gate")).toEqual([]);
  });
});

describe("Needs me", () => {
  it("lists exactly the Gates the Human may rule on", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await workspace(db);
    const { asAda, asGrace, asOmar, asPlanner, grace } = context;
    await asAda.checkpoints.set({
      projectSlug: "deevy",
      checkpoints: [
        // Grace alone may rule on a ship.
        { name: "ship", approvalsRequired: 1, approverMemberIds: [grace.member.id] },
        // Two of anybody but the Human the work is for, which is Ada, the Sponsor.
        { name: "review", approvalsRequired: 2, excludeRequester: true },
      ],
    });
    const anyone = await asPlanner.gates.request({
      runId: await runOn(context, "1"),
      checkpoint: "plan",
      proposal: "Plan it",
    });
    const named = await asPlanner.gates.request({
      runId: await runOn(context, "2"),
      checkpoint: "ship",
      proposal: "Ship it",
    });
    const twoOthers = await asPlanner.gates.request({
      runId: await runOn(context, "3"),
      checkpoint: "review",
      proposal: "Review it",
    });
    // Somebody who has ruled has nothing left to give it.
    await asGrace.gates.approve({ requestId: twoOthers.id });

    const mine = async (client: typeof asAda) =>
      (await client.gates.list({ mine: true })).gates.map((one) => one.id).sort();
    expect(await mine(asAda)).toEqual([anyone.id].sort());
    expect(await mine(asGrace)).toEqual([anyone.id, named.id].sort());
    expect(await mine(asOmar)).toEqual([anyone.id, twoOthers.id].sort());
  });
});

describe("an inbox", () => {
  it("is an Agent's: no Human has a row after a mention, an assignment, a Gate or a finished Run", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await workspace(db);
    const { ada, grace, planner, asAda, asPlanner, seeded } = context;

    const runId = await runOn(context, "42");
    await seeded.deliver([comment("42", "@grace @planner have a look at the cap")]);
    const gate = await asPlanner.gates.request({ runId, checkpoint: "plan", proposal: "Ship it" });
    await asAda.gates.approve({ requestId: gate.id });
    await asPlanner.runs.finish({ runId, status: "completed", summary: "Capped" });
    // Hours later the Gate would have reminded somebody; nothing does now.
    await runDueWork({
      db,
      now: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const rows = await db.query.notification.findMany();
    const humans = new Set([ada.member.id, grace.member.id, context.omar.member.id]);
    expect(rows.filter((row) => humans.has(row.recipientMemberId))).toEqual([]);
    expect(
      rows
        .filter((row) => row.recipientMemberId === planner.member.id)
        .map((row) => row.kind)
        .sort(),
    ).toEqual(["assignment", "mention", "run_answered"]);
    // Nor is anything owed to a Human anywhere else: no delivery names one,
    // and with no channel bound there is no chat message either. What the
    // tracker is told at the Gate is the tracker's (target `socket`).
    const owed = await db.query.delivery.findMany();
    expect(owed.filter((row) => row.recipientMemberId !== null)).toEqual([]);
    expect(owed.filter((row) => row.target === "chat")).toEqual([]);
  });

  it("is read by an Agent and refused to a Human", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const context = await workspace(db);
    await runOn(context, "42");

    const { notifications } = await context.asPlanner.inbox.list({ unreadOnly: true });
    expect(notifications.map((row) => row.kind)).toEqual(["assignment"]);
    expect(
      await context.asPlanner.inbox.markRead({ ids: notifications.map((row) => row.id) }),
    ).toEqual({ read: 1 });
    await expect(context.asAda.inbox.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(context.asAda.inbox.markRead({ ids: [] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("what is gone", () => {
  it("answers no route for Channels, routing, preferences, email or a Human's inbox count", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { app } = await workspace(db);

    const gone = [
      ["GET", "/api/channels"],
      ["GET", "/api/routing"],
      ["GET", "/api/preferences"],
      ["GET", "/api/email"],
      ["GET", "/api/inbox/unread"],
      ["POST", "/api/inbox/read-all"],
      ["GET", "/api/email/unsubscribe/anything"],
      ["GET", "/api/email/confirm/anything"],
    ] as const;
    for (const [method, path] of gone) {
      const answered = await app.request(path, { method });
      expect({ path, status: answered.status }).toEqual({ path, status: 404 });
    }
    // Where a route is still there, a caller with no session is told to sign in.
    expect((await app.request("/api/projects")).status).toBe(401);
  });

  it("hands an admin an invitation link to copy, and emails nothing", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await workspace(db);

    const invited = await asAda.invitations.create({ email: "lin@example.com" });
    expect(invited.url).toMatch(/^https?:\/\/.+\/invite\/[\w-]+$/);
    expect(invited.path).toMatch(/^\/invite\//);
    expect(invited).not.toHaveProperty("emailNotSent");
    expect(invited).not.toHaveProperty("emailStatus");
    expect(await db.query.delivery.findMany()).toEqual([]);
  });
});
