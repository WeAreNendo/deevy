import { openDatabase } from "@deevy/adapters/node";
import { createApp, newId, router, runDueWork, sealSecret, upsertProjection } from "@deevy/core";
import {
  agent as agentTable,
  member as memberTable,
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

/**
 * Slack, through the door deevy actually serves (ADR-0024, ADR-0036).
 *
 * The Slack module is proved against recorded answers in `slack.test.ts`, and
 * the core's half against a fake in `packages/core/tests/chat*.test.ts`. This
 * puts the real module behind the real route with a real database, and
 * replaces only Slack's Web API — so what is under test is the whole sentence:
 * an Agent asks, the Gate appears in a Slack room with a link to rule on it in
 * deevy, somebody rules there, and the message says what happened. Slack is
 * told and takes nothing back, so the address a tracker delivers to refuses it.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const migrationsFolder = new URL("../../db/drizzle", import.meta.url).pathname;
const sealing = "a-test-sealing-secret-of-at-least-32-chars";
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
    const method = url.split("/").pop() ?? "";
    calls.push({ method, body });
    if (method === "chat.postMessage") {
      posted += 1;
      return Response.json({
        ok: true,
        channel: body.channel,
        ts: `17586252${String(posted)}.000100`,
      });
    }
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
 * and the Planner asking at `plan`. The Slack Socket holds its bot token and
 * nothing else, since Slack sends deevy nothing to sign.
 */
async function waitingInSlack(db: Db) {
  const workspaceId = newId("workspace");
  await db.insert(workspaceTable).values({ id: workspaceId, name: "Acme", slug: "acme" });
  const workspace = (await db.query.workspace.findFirst({
    where: { id: workspaceId },
  })) as Workspace;
  const ada = await human(db, workspaceId, "Ada", "admin");

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

  // The Project's channel, bound as an admin binds it (slice 8). Binding says
  // hello there, which is not what these tests watch, so it is forgotten.
  await asAda.projects.update({
    slug: "acme-deevy",
    chat: { socketId: slackId, channel: "C07DEEVY01" },
  });
  expect(api.calls.map((call) => call.method)).toEqual(["chat.postMessage"]);
  api.calls.length = 0;
  const run = await asPlanner.runs.start({ issue: issue.url });
  const gate = await asPlanner.gates.request({
    runId: run.id,
    checkpoint: "plan",
    proposal: "## What I will do\n\nCap the coupon at the basket total.",
  });
  const sweep = () =>
    runDueWork({ db, sockets, socketSecret: sealing, baseUrl: "https://deevy.test" });

  return { db, app, api, gate, slackId, asAda, sweep };
}

describe("a Gate in Slack", () => {
  it("is posted with a link to rule on it in deevy, and no button", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { api, gate, sweep } = await waitingInSlack(db);

    await sweep();

    const posts = api.calls.filter((call) => call.method === "chat.postMessage");
    expect(posts.map((call) => call.body.channel)).toEqual(["C07DEEVY01"]);
    const drawn = JSON.stringify(posts[0]?.body.blocks);
    expect(drawn).toContain(`<https://deevy.test/gates/${gate.id}|Rule on it in deevy>`);
    expect(drawn).not.toContain('"type":"actions"');
    expect(drawn).not.toContain('"type":"button"');
  });

  it("is changed in place through the outbox when somebody rules on it in deevy", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { api, gate, asAda, sweep } = await waitingInSlack(db);
    await sweep();
    expect(api.calls.filter((call) => call.method === "chat.update")).toEqual([]);

    await asAda.gates.approve({ requestId: gate.id, note: "Go ahead" });
    // Ruling posts nothing itself: the message changes from the Gate's Events.
    expect(api.calls.filter((call) => call.method === "chat.update")).toEqual([]);
    await sweep();

    const updates = api.calls.filter((call) => call.method === "chat.update");
    expect(updates).toHaveLength(1);
    // The second message posted: the first was the binding's hello.
    expect(updates[0]?.body).toMatchObject({ channel: "C07DEEVY01", ts: "175862522.000100" });
    const drawn = JSON.stringify(updates[0]?.body.blocks);
    expect(drawn).toContain("Ada approved");
    expect(drawn).toContain(`<https://deevy.test/gates/${gate.id}|Open it in deevy>`);
    expect(drawn).not.toContain("Rule on it in deevy");
    expect(drawn).not.toContain('"type":"button"');
    expect(api.calls.filter((call) => call.method === "chat.postMessage")).toHaveLength(1);
  });

  it("is not ruled on by a click sent to the Socket's address, which answers 400 and writes nothing", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, api, gate, slackId, sweep } = await waitingInSlack(db);
    await sweep();
    api.calls.length = 0;
    const events = (await db.query.event.findMany({})).length;

    // A click as an app made from the old manifest would still send one: an
    // Approve on this Gate, as a form with the JSON under `payload`.
    const payload = {
      type: "block_actions",
      user: { id: "U07GRACE01", username: "grace", team_id: TEAM },
      container: { type: "message", channel_id: "C07DEEVY01", message_ts: "175862522.000100" },
      actions: [{ action_id: "deevy_approve", type: "button", value: gate.id }],
    };
    const answered = await app.request(`/hooks/${slackId}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
    });

    expect(answered.status).toBe(400);
    expect(await answered.json()).toEqual({ error: "This Socket does not take deliveries" });
    expect(await db.query.inboundDelivery.findMany({})).toEqual([]);
    expect(await db.query.gateDecision.findMany({})).toEqual([]);
    expect(await db.query.gateRequest.findFirst({ where: { id: gate.id } })).toMatchObject({
      status: "open",
    });
    expect(await db.query.event.findMany({})).toHaveLength(events);
    await sweep();
    expect(api.calls).toEqual([]);
  });
});
