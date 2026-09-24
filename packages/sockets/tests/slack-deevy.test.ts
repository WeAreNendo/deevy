import { openDatabase } from "@deevy/adapters/node";
import { createApp, newId, router, runDueWork, sealSecret, upsertProjection } from "@deevy/core";
import {
  agent as agentTable,
  member as memberTable,
  memberIdentity,
  project as projectTable,
  projectGrant,
  socket as socketTable,
  user as userTable,
  workspace as workspaceTable,
  type Db,
  type Member,
  type Workspace,
} from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createSlackSocket, socketModules } from "../src/index.ts";
import approve from "./fixtures/slack/block_actions.approve.json" with { type: "json" };

/**
 * Slack, through the door deevy actually serves (ADR-0025).
 *
 * The Slack module is proved against recorded requests in `slack.test.ts`, and
 * the core's half against a fake in `packages/core/tests/chat*.test.ts`. This
 * puts the real module behind the real route with a real database, and
 * replaces only Slack's Web API — so what is under test is the whole sentence:
 * an Agent asks, the Gate appears in a Slack room with two buttons, somebody
 * clicks one, and the message says what happened.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const migrationsFolder = new URL("../../db/drizzle", import.meta.url).pathname;
const sealing = "a-test-sealing-secret-of-at-least-32-chars";
const signingSecret = "8f14e45fceea167a5a36dedd4bea2543";
const TEAM = "T07ACME001";

/** Slack's Web API, as far as deevy can tell: every call written down. */
function slackApi() {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  let posted = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
      string,
      unknown
    >;
    const method = url.startsWith("https://hooks.slack.com/")
      ? "response_url"
      : (url.split("/").pop() ?? "");
    calls.push({ method, body });
    if (method === "chat.postMessage") {
      posted += 1;
      return Response.json({
        ok: true,
        channel: body.channel,
        ts: `17586252${String(posted)}.000100`,
      });
    }
    if (method === "conversations.open")
      return Response.json({ ok: true, channel: { id: "D07GRACE01" } });
    if (method === "response_url") return new Response("ok");
    return Response.json({ ok: true });
  };
  return { calls, fetch };
}

/** An AppContext for a Member that already exists, as the router is called in-process. */
function contextFor(
  db: Db,
  member: Member,
  workspace: Workspace,
  extra: Record<string, unknown> = {},
) {
  return {
    db,
    member,
    workspace,
    baseURL: "https://deevy.test",
    session: {
      session: { id: newId("session"), userId: member.userId, token: "t", expiresAt: new Date() },
      user: {
        id: member.userId,
        name: "Test",
        email: "test@example.com",
        image: null,
        kind: member.kind,
      },
    },
    ...extra,
  } as never;
}

async function human(db: Db, workspaceId: string, name: string, role: Member["role"] = "member") {
  const userId = newId("user");
  await db
    .insert(userTable)
    .values({ id: userId, name, email: `${name.toLowerCase()}@example.com` });
  const id = newId("member");
  await db.insert(memberTable).values({
    id,
    workspaceId,
    userId,
    handle: name.toLowerCase(),
    role,
    kind: "human",
  });
  return (await db.query.member.findFirst({ where: { id } })) as Member;
}

/**
 * A Workspace with a Slack app connected and a Gate waiting: Ada the admin,
 * Grace who linked her Slack account, and the Planner asking at `plan`.
 */
async function waitingInSlack(db: Db) {
  const workspaceId = newId("workspace");
  await db.insert(workspaceTable).values({ id: workspaceId, name: "Acme", slug: "acme" });
  const workspace = (await db.query.workspace.findFirst({
    where: { id: workspaceId },
  })) as Workspace;
  const ada = await human(db, workspaceId, "Ada", "admin");
  const grace = await human(db, workspaceId, "Grace");

  const agentUserId = newId("user");
  await db
    .insert(userTable)
    .values({ id: agentUserId, name: "Planner", email: "planner@agents.invalid", kind: "agent" });
  const plannerId = newId("member");
  await db.insert(memberTable).values({
    id: plannerId,
    workspaceId,
    userId: agentUserId,
    handle: "planner",
    role: "member",
    kind: "agent",
    sponsorId: ada.id,
  });
  await db.insert(agentTable).values({ memberId: plannerId });
  const planner = (await db.query.member.findFirst({ where: { id: plannerId } })) as Member;

  const trackerId = newId("socket");
  await db.insert(socketTable).values({
    id: trackerId,
    workspaceId,
    provider: "stub",
    capabilities: ["tracker"],
    name: "Example tracker",
    identity: { login: "deevy", id: "bot-1", mentionHandle: "@deevy" },
    config: {},
  });
  const slackId = newId("socket");
  await db.insert(socketTable).values({
    id: slackId,
    workspaceId,
    provider: "slack",
    capabilities: ["chat"],
    name: "Acme Slack",
    identity: { login: "deevy", id: "U07DEEVY01", mentionHandle: "@deevy" },
    config: { teamId: TEAM, team: "Acme" },
    credentials: await sealSecret(sealing, JSON.stringify({ botToken: "xoxb-not-a-real-token" })),
    webhookSecret: await sealSecret(sealing, signingSecret),
    installedBy: ada.id,
  });
  const projectId = newId("project");
  await db.insert(projectTable).values({
    id: projectId,
    workspaceId,
    slug: "acme-deevy",
    name: "deevy",
    trackerSocketId: trackerId,
    trackerScope: { scopeKey: "acme/deevy" },
    trackerScopeKey: "stub:acme/deevy",
  });
  await db.insert(projectGrant).values({ memberId: plannerId, projectId });
  const { issue } = await upsertProjection(db, {
    projectId,
    socketId: trackerId,
    external: {
      externalId: "42",
      key: "acme/deevy#42",
      url: "https://github.com/acme/deevy/issues/42",
      title: "Checkout totals are wrong with a coupon",
      body: null,
      state: "open",
      stateName: "open",
      assignees: [],
      labels: [],
      parentExternalId: null,
      updatedAt: new Date(),
    },
  });
  await db.insert(memberIdentity).values({
    id: newId("memberIdentity"),
    workspaceId,
    memberId: grace.id,
    provider: "slack",
    instance: TEAM,
    externalUserId: "U07GRACE01",
    externalLogin: "grace",
    verifiedBy: "link_code",
  });

  const api = slackApi();
  const sockets = {
    ...socketModules({ devStub: true }),
    slack: (input: Parameters<typeof createSlackSocket>[0]) =>
      createSlackSocket({ ...input, fetch: api.fetch }),
  };
  const app = createApp({ db, sockets, socketSecret: sealing, baseURL: "https://deevy.test" });
  const asAda = createRouterClient(router, {
    context: contextFor(db, ada, workspace, { sockets, socketSecret: sealing }),
  });
  const asPlanner = createRouterClient(router, {
    context: contextFor(db, planner, workspace, { sockets, grantedProjectIds: [projectId] }),
  });

  const room = await asAda.channels.createInSocket({
    name: "#deevy",
    socketId: slackId,
    conversation: "C07DEEVY01",
  });
  await asAda.routing.set({
    rules: [{ notificationKind: "gate_awaiting", projectId: null, channelId: room.id }],
  });
  const run = await asPlanner.runs.start({ issue: issue.url });
  const gate = await asPlanner.gates.request({
    runId: run.id,
    checkpoint: "plan",
    proposal: "## What I will do\n\nCap the coupon at the basket total.",
  });
  const sweep = () =>
    runDueWork({ db, sockets, socketSecret: sealing, baseUrl: "https://deevy.test" });

  return { db, app, api, gate, slackId, ada, grace, asAda, sweep, workspace, sockets };
}

/** A click as Slack sends it: the recorded request, pointed at this Gate and signed now. */
async function clicked(
  gateId: string,
  user = "U07GRACE01",
  at = Math.floor(Date.now() / 1000),
  secret = signingSecret,
) {
  const payload = {
    ...approve,
    user: { ...approve.user, id: user },
    actions: [{ ...approve.actions[0], value: gateId }],
  };
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${String(at)}:${body}`),
  );
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": String(at),
      "x-slack-signature": `v0=${hex}`,
    },
    body,
  };
}

describe("a Gate in Slack", () => {
  it("is posted with two buttons, ruled by a linked Human's click, and changed through the outbox", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, api, gate, slackId, grace, sweep } = await waitingInSlack(db);

    await sweep();
    const post = api.calls.find(
      (call) => call.method === "chat.postMessage" && call.body.channel === "C07DEEVY01",
    );
    expect(JSON.stringify(post?.body.blocks)).toContain('"action_id":"deevy_approve"');

    const answered = await app.request(`/hooks/${slackId}`, await clicked(gate.id));

    // Slack wants its 200 now; the message changes later, from the Gate's Events.
    expect(answered.status).toBe(200);
    expect(api.calls.filter((call) => call.method === "chat.update")).toEqual([]);
    const [decision] = await db.query.gateDecision.findMany({ where: { gateRequestId: gate.id } });
    expect(decision).toMatchObject({ memberId: grace.id, via: "slack", socketId: slackId });

    await sweep();
    const updates = api.calls.filter((call) => call.method === "chat.update");
    expect(updates.map((call) => call.body.channel)).toContain("C07DEEVY01");
    const inRoom = updates.find((call) => call.body.channel === "C07DEEVY01");
    expect(JSON.stringify(inRoom?.body.blocks)).not.toContain("deevy_approve");
    expect(JSON.stringify(inRoom?.body.blocks)).toContain("Grace approved, in Slack");
  });

  it("gives an unlinked user a code, said to them alone, which links them when redeemed signed in", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, api, gate, slackId, workspace, sockets } = await waitingInSlack(db);
    const omar = await human(db, workspace.id, "Omar");

    await app.request(`/hooks/${slackId}`, await clicked(gate.id, "U07OMAR001"));

    const reply = api.calls.find((call) => call.method === "response_url");
    expect(reply?.body).toMatchObject({ response_type: "ephemeral" });
    const code = /[A-Z2-9]{4}-[A-Z2-9]{4}/.exec(String(reply?.body.text))?.[0] ?? "";
    expect(code).not.toBe("");
    expect(await db.query.gateDecision.findMany({})).toEqual([]);

    const asOmar = createRouterClient(router, {
      context: contextFor(db, omar, workspace, { sockets }),
    });
    await asOmar.identities.link({ code });
    await app.request(`/hooks/${slackId}`, await clicked(gate.id, "U07OMAR001"));

    expect(await db.query.gateDecision.findMany({})).toMatchObject([
      { memberId: omar.id, via: "slack" },
    ]);
  });

  it("refuses a stale request and a forged one, and writes neither down as a Ruling", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, gate, slackId } = await waitingInSlack(db);

    const stale = await app.request(
      `/hooks/${slackId}`,
      await clicked(gate.id, "U07GRACE01", Math.floor(Date.now() / 1000) - 600),
    );
    const forged = await app.request(
      `/hooks/${slackId}`,
      await clicked(gate.id, "U07GRACE01", Math.floor(Date.now() / 1000), "not-the-signing-secret"),
    );

    expect(stale.status).toBe(401);
    expect(forged.status).toBe(401);
    expect(await db.query.gateDecision.findMany({})).toEqual([]);
  });

  it("changes the same message when somebody rules in the browser instead", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { api, gate, asAda, sweep } = await waitingInSlack(db);
    await sweep();
    const posted = api.calls.find(
      (call) => call.method === "chat.postMessage" && call.body.channel === "C07DEEVY01",
    );
    expect(posted).toBeDefined();

    await asAda.gates.approve({ requestId: gate.id, note: "Go ahead" });
    await sweep();

    const update = api.calls.find(
      (call) => call.method === "chat.update" && call.body.channel === "C07DEEVY01",
    );
    expect(update?.body.ts).toBe("175862521.000100");
    expect(JSON.stringify(update?.body.blocks)).toContain("Ada approved, in deevy");
  });
});
