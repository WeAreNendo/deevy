import { memberIdentity, socket as socketTable, type Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { newId } from "../src/ids.ts";
import { router } from "../src/operations/index.ts";
import { sealSecret } from "../src/secrets.ts";
import type { ChatInteraction } from "../src/sockets/port.ts";
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
 * A Gate waiting in a Workspace with a Slack app connected (ADR-0025).
 *
 * Grace is a Human who linked her Slack account; Omar is one who has not. The
 * Slack Socket is a fake that carries its interaction verbatim — Slack's own
 * wire format is `packages/sockets`' to prove.
 */
async function withSlack(db: Db) {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const grace = await memberContext(db, { name: "Grace", email: "grace@example.com" });
  const omar = await memberContext(db, { name: "Omar", email: "omar@example.com" });
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
  const tracker = fakeSockets();
  const sockets = { ...tracker.sockets, ...chat.sockets };

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

  const asPlanner = createRouterClient(router, { context: { ...planner, sockets } });
  const run = await asPlanner.runs.start({ issue: issue.url });
  const gate = await asPlanner.gates.request({
    runId: run.id,
    checkpoint: "plan",
    proposal: "Ship it",
  });

  const app = createApp({
    db,
    sockets,
    socketSecret: testSealingSecret,
    webURL: "https://deevy.test",
  });
  const send = (
    interaction: ChatInteraction,
    options: { event?: string; secret?: string; at?: number } = {},
  ) => {
    const body = JSON.stringify(interaction);
    return app.request(`/hooks/${slackId}`, {
      method: "POST",
      headers: {
        "x-test-event": options.event ?? "block_actions",
        "x-test-timestamp": String(options.at ?? Math.floor(Date.now() / 1000)),
        "x-test-signature": `${options.secret ?? signingSecret}:${String(body.length)}`,
      },
      body,
    });
  };
  const click = (
    user: string,
    decision: "approved" | "rejected",
    extra: Partial<Extract<ChatInteraction, { kind: "ruling" }>> = {},
  ): ChatInteraction => ({
    kind: "ruling",
    actor: { team: "T0TEST", user, login: user.toLowerCase().replace(/^u0/, "") },
    gateRequestId: gate.id,
    decision,
    note: null,
    wantsNote: decision === "rejected",
    message: { channel: "C0DEEVY", ts: "1.000100" },
    responseUrl: `https://hooks.slack.test/actions/${user}`,
    triggerId: `trigger-${user}`,
    ...extra,
  });

  return {
    ada,
    grace,
    omar,
    gate,
    run,
    chat,
    slackId,
    send,
    click,
    asGrace: createRouterClient(router, { context: { ...grace, sockets } }),
    asOmar: createRouterClient(router, { context: { ...omar, sockets } }),
    decisions: () => db.query.gateDecision.findMany({ where: { gateRequestId: gate.id } }),
  };
}

describe("a Slack click", () => {
  it("rules as the Human whose Slack account it is, and says it came from Slack", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { grace, gate, send, click, decisions } = await withSlack(db);

    const answered = await send(click("U0GRACE", "approved"));

    expect(answered.status).toBe(200);
    expect(await decisions()).toMatchObject([
      {
        memberId: grace.member.id,
        decision: "approved",
        via: "slack",
        externalRef: { team: "T0TEST", user: "U0GRACE", channel: "C0DEEVY", ts: "1.000100" },
      },
    ]);
    expect((await db.query.gateRequest.findFirst({ where: { id: gate.id } }))?.status).toBe(
      "approved",
    );
  });

  it("asks why before a rejection counts, and counts it with the reason", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { chat, gate, send, click, decisions } = await withSlack(db);

    await send(click("U0GRACE", "rejected"));
    expect(chat.notes).toEqual([{ triggerId: "trigger-U0GRACE", gateRequestId: gate.id }]);
    expect(await decisions()).toEqual([]);

    await send(
      click("U0GRACE", "rejected", {
        wantsNote: false,
        note: "Split the migration first",
        responseUrl: null,
        triggerId: null,
      }),
      { event: "view_submission" },
    );
    expect(await decisions()).toMatchObject([
      { decision: "rejected", note: "Split the migration first", via: "slack" },
    ]);
  });

  it("gives an account nobody linked a code, said to them alone, and rules nothing", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { chat, send, click, decisions } = await withSlack(db);

    await send(click("U0OMAR", "approved"));

    expect(await decisions()).toEqual([]);
    const [said] = chat.responses;
    expect(said?.responseUrl).toBe("https://hooks.slack.test/actions/U0OMAR");
    expect(said?.text).toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}/);
    expect(said?.text).toContain("https://deevy.test/settings/identities");
    // The code is a credential for ten minutes, so the log names the refusal
    // and never the code.
    const refused = (await db.query.event.findMany({})).filter(
      (event) => event.kind === "gate.ruling_refused",
    );
    expect(refused).toHaveLength(1);
    const code = /[A-Z2-9]{4}-[A-Z2-9]{4}/.exec(said?.text ?? "")?.[0] ?? "";
    expect(JSON.stringify(refused)).not.toContain(code);
    expect(JSON.stringify(await db.query.linkCode.findMany({}))).not.toContain(code);
    // Said in Slack already, so the tracker is not told as well.
    const toTracker = await db.query.delivery.findMany({ where: { target: "socket" } });
    expect(toTracker.some((row) => row.eventSeq === refused[0]?.seq)).toBe(false);
  });

  it("says the Checkpoint's own refusal to the one who clicked, and in a dialog, keeps it open", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { chat, send, click, decisions } = await withSlack(db);
    await send(click("U0GRACE", "approved"));
    chat.responses.length = 0;

    // A second click by the same Human: the Gate is ruled, and the policy says so.
    await send(click("U0GRACE", "approved"));
    expect(chat.responses[0]?.text).toContain("already approved");

    const dialog = await send(
      click("U0GRACE", "rejected", {
        wantsNote: false,
        note: "No",
        responseUrl: null,
        triggerId: null,
      }),
      { event: "view_submission" },
    );
    expect(await dialog.json()).toMatchObject({ kind: "dialog_error" });
    expect(await decisions()).toHaveLength(1);
  });

  it("is refused signed with anything else, or signed too long ago", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { send, click, decisions } = await withSlack(db);

    const forged = await send(click("U0GRACE", "approved"), { secret: "not-the-signing-secret" });
    const stale = await send(click("U0GRACE", "approved"), {
      at: Math.floor(Date.now() / 1000) - 600,
    });

    expect(forged.status).toBe(401);
    expect(stale.status).toBe(401);
    expect(await decisions()).toEqual([]);
  });

  it("takes the previous signing secret for a day after it is replaced, and not after", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { ada, slackId, send, click, decisions } = await withSlack(db);
    const asAda = createRouterClient(router, {
      context: { ...ada, socketSecret: testSealingSecret },
    });

    await asAda.sockets.update({
      socketId: slackId,
      webhookSecret: "the-new-slack-signing-secret",
    });

    // Slack goes on signing with the old one until somebody pastes the new
    // one there too, and for a day both are good.
    expect((await send(click("U0GRACE", "approved"), { secret: signingSecret })).status).toBe(200);
    expect(await decisions()).toHaveLength(1);

    await db
      .update(socketTable)
      .set({ webhookSecretChangedAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(socketTable.id, slackId));
    expect((await send(click("U0GRACE", "approved"), { secret: signingSecret })).status).toBe(401);
  });
});

describe("a Slack account linked by a code", () => {
  it("is named before it is linked, and linked to whoever redeems it signed in", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { chat, omar, send, click, asOmar, decisions } = await withSlack(db);
    await send(click("U0OMAR", "approved"));
    const code = /[A-Z2-9]{4}-[A-Z2-9]{4}/.exec(chat.responses[0]?.text ?? "")?.[0] ?? "";

    // Who it would link, so a Human handed somebody else's code can see it is
    // somebody else's before it is too late (ADR-0025).
    expect(await asOmar.identities.peek({ code })).toMatchObject({
      provider: "slack",
      instance: "T0TEST",
      externalLogin: "omar",
    });
    const linked = await asOmar.identities.link({ code: code.toLowerCase() });
    expect(linked).toMatchObject({ provider: "slack", verifiedBy: "link_code" });

    // Once: a code is spent the first time it is redeemed.
    await expect(asOmar.identities.link({ code })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await send(click("U0OMAR", "approved"));
    expect(await decisions()).toMatchObject([{ memberId: omar.member.id, via: "slack" }]);
  });

  it("is refused once it is ten minutes old", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { chat, send, click, asOmar } = await withSlack(db);
    await send(click("U0OMAR", "approved"));
    const code = /[A-Z2-9]{4}-[A-Z2-9]{4}/.exec(chat.responses[0]?.text ?? "")?.[0] ?? "";
    const { linkCode } = await import("@deevy/db");
    await db.update(linkCode).set({ expiresAt: new Date(Date.now() - 1000) });

    await expect(asOmar.identities.link({ code })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("comes from `/deevy link` too, answered in the reply itself", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { send } = await withSlack(db);

    const answered = await send(
      {
        kind: "link",
        actor: { team: "T0TEST", user: "U0OMAR", login: "omar" },
        responseUrl: null,
      },
      { event: "slash_command" },
    );

    const reply = (await answered.json()) as { kind: string; text: string };
    expect(reply.kind).toBe("private");
    expect(reply.text).toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}/);
  });
});

describe("connecting a Slack app", () => {
  it("records the team it learned while proving the token, and not in the identity", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const chat = fakeChat();
    const asAda = createRouterClient(router, {
      context: { ...ada, sockets: chat.sockets, socketSecret: testSealingSecret },
    });

    const connected = await asAda.sockets.connect({
      provider: "slack",
      name: "Acme Slack",
      credentials: { botToken: "xoxb-not-a-real-token" },
      webhookSecret: signingSecret,
    });

    expect(connected.config).toMatchObject({ teamId: "T0TEST", team: "Acme" });
    expect(connected.identity).toEqual({ login: "deevy", id: "U0DEEVY", mentionHandle: "@deevy" });
  });

  it("completes the Socket it started, so the manifest could carry the real address", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const chat = fakeChat();
    const asAda = createRouterClient(router, {
      context: {
        ...ada,
        sockets: chat.sockets,
        socketSecret: testSealingSecret,
        secret: testSealingSecret,
      },
    });

    // Started first, because Slack wants the request URL in the app's own
    // manifest, and the URL names the Socket.
    const begun = await asAda.sockets.begin({ provider: "slack", name: "Acme Slack" });
    const connected = await asAda.sockets.connect({
      provider: "slack",
      name: "Acme Slack",
      socketId: begun.id,
      credentials: { botToken: "xoxb-not-a-real-token" },
      webhookSecret: signingSecret,
    });

    expect(connected).toMatchObject({
      id: begun.id,
      status: "active",
      inboundUrl: begun.inboundUrl,
      hasCredentials: true,
      config: { teamId: "T0TEST" },
    });
    expect(await db.query.socket.findMany({})).toHaveLength(1);
    // A Socket already connected is not completed a second time.
    await expect(
      asAda.sockets.connect({
        provider: "slack",
        name: "Acme Slack",
        socketId: begun.id,
        credentials: { botToken: "xoxb-another" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("proves the credential it was handed, not an empty one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const seen: Array<Record<string, string>> = [];
    const chat = fakeChat();
    const slack = chat.sockets.slack;
    if (!slack) throw new Error("the fake is a Slack Socket");
    const asAda = createRouterClient(router, {
      context: {
        ...ada,
        socketSecret: testSealingSecret,
        sockets: {
          slack: (input) => {
            seen.push(input.credentials);
            return slack(input);
          },
        },
      },
    });

    await asAda.sockets.connect({
      provider: "slack",
      name: "Acme Slack",
      credentials: { botToken: "xoxb-not-a-real-token" },
    });

    // A real Slack app answers `auth.test` only with the token, and a real
    // GitHub App answers `/app` only with its key: the module that proves the
    // connection has to be built with what the operator pasted.
    expect(seen[0]).toEqual({ botToken: "xoxb-not-a-real-token" });
  });
});
