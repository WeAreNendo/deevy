import { openDatabase } from "@deevy/adapters/node";
import { createApp, newId, router, runDueWork, verifySignature } from "@deevy/core";
import {
  agent as agentTable,
  member as memberTable,
  projectGrant,
  user as userTable,
  workspace as workspaceTable,
  type Db,
  type Member,
  type Workspace,
} from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { signDelivery, socketModules } from "../src/index.ts";

/**
 * Any tool, through the door deevy actually serves (docs/plans/simplify.md,
 * slice 7).
 *
 * The generic Socket is deevy's own format, so there is no recorded payload to
 * hold it against: what is under test is the sentence its page tells an
 * adapter's author. Connect one and deevy mints its secret and says it once; a
 * delivery signed with it is a record like any other tracker's, and opens the
 * Run its label names; a `/approve` in it is a comment, since a Ruling is made
 * in deevy (ADR-0036); and a Gate, and the Ruling on it, is heard on the
 * Workspace's webhooks, naming the record, since deevy writes nothing back
 * through it.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const migrationsFolder = new URL("../../db/drizzle", import.meta.url).pathname;
const sealing = "a-test-sealing-secret-of-at-least-32-chars";
const subscriptionSecret = "whsec_the_adapter_verifies_deevy_with_this";
const ADAPTER = "https://adapter.example/deevy";
const RECORD_URL = "https://tracker.example/browse/OPS-12";

function contextFor(db: Db, member: Member, workspace: Workspace, extra: object = {}) {
  return {
    db,
    member,
    workspace,
    baseURL: "https://deevy.test",
    session: {
      session: { id: newId("session"), userId: member.userId, token: "t", expiresAt: new Date() },
      user: { id: member.userId, name: "Test", email: "test@example.com", image: null },
    },
    ...extra,
  } as never;
}

async function human(db: Db, workspaceId: string, name: string, role: Member["role"] = "member") {
  const userId = newId("user");
  await db.insert(userTable).values({
    id: userId,
    name,
    email: `${name.toLowerCase()}@example.com`,
    emailVerified: true,
  });
  const id = newId("member");
  await db
    .insert(memberTable)
    .values({ id, workspaceId, userId, handle: name.toLowerCase(), role, kind: "human" });
  return (await db.query.member.findFirst({ where: { id } })) as Member;
}

/**
 * A Workspace whose admin connects a generic Socket over the API, as Settings
 * does, and binds a Project to the container an adapter will name, `OPS`.
 * The Planner is granted it, and the Workspace has one webhook subscription of
 * its own: the adapter's.
 */
async function workspaceOnAnyTool(db: Db) {
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

  // Every entry registers it, with no flag: it is a tool, not the stub.
  const sockets = socketModules();
  const extra = { sockets, socketSecret: sealing };
  const asAda = createRouterClient(router, { context: contextFor(db, ada, workspace, extra) });
  const asGrace = createRouterClient(router, { context: contextFor(db, grace, workspace, extra) });
  const connected = await asAda.sockets.connect({ provider: "generic", name: "Acme's tracker" });
  const project = await asAda.projects.create({
    slug: "ops",
    name: "Ops",
    tracker: { socketId: connected.id, scope: { scopeKey: "OPS" } },
  });
  await db.insert(projectGrant).values({ memberId: plannerId, projectId: project.id });
  await asAda.webhooks.create({ url: ADAPTER, secret: subscriptionSecret });

  const app = createApp({ db, sockets, socketSecret: sealing, baseURL: "https://deevy.test" });
  const asPlanner = createRouterClient(router, {
    context: contextFor(db, planner, workspace, { ...extra, grantedProjectIds: [project.id] }),
  });
  const posted: Array<{ url: string; headers: Headers; body: string }> = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    posted.push({
      url,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const sweep = () =>
    runDueWork({ db, sockets, socketSecret: sealing, baseUrl: "https://deevy.test", fetch });

  return { app, asAda, asGrace, asPlanner, connected, grace, planner, posted, sweep };
}

/** The record as the adapter states it, labelled for the Planner. */
const labelled = {
  kind: "issue",
  scopeKey: "OPS",
  issue: {
    externalId: "10042",
    key: "OPS-12",
    url: RECORD_URL,
    title: "Rotate the staging certificate",
    state: "open",
    labels: ["agent:planner"],
    updatedAt: "2026-11-01T09:59:00.000Z",
  },
};

let deliveries = 0;

/** One POST of the adapter's, signed with the secret deevy minted. */
async function delivery(secret: string, events: unknown[]) {
  const signed = await signDelivery(secret, events as never, {
    deliveryId: `adapter-${String(++deliveries)}`,
  });
  return { method: "POST", headers: signed.headers, body: signed.body };
}

let comments = 0;

/** A comment as the adapter states one: Grace's, by her account on the tool. */
function graceSays(body: string) {
  comments += 1;
  return {
    externalId: `c-${String(comments)}`,
    url: `${RECORD_URL}#comment-${String(comments)}`,
    body,
    author: { login: "grace", id: "u-77" },
    createdAt: "2026-11-01T10:00:30.000Z",
  };
}

async function opened(db: Db) {
  const walk = await workspaceOnAnyTool(db);
  const secret = walk.connected.webhookSecret ?? "";
  const response = await walk.app.request(
    `/hooks/${walk.connected.id}`,
    await delivery(secret, [labelled]),
  );
  return { ...walk, secret, response };
}

describe("connecting any tool", () => {
  it("mints the secret it signs with, and says it once beside the address", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { asAda, connected } = await workspaceOnAnyTool(db);

    expect(connected.webhookSecret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(connected.inboundUrl).toBe(`https://deevy.test/hooks/${connected.id}`);
    expect(connected.identity).toEqual({ login: "deevy", id: "deevy", mentionHandle: "@deevy" });
    // After that answer, deevy only says that there is one.
    const listed = await asAda.sockets.list({});
    expect(JSON.stringify(listed)).not.toContain(connected.webhookSecret ?? "-");
    expect(listed.sockets[0]).toMatchObject({ provider: "generic", hasWebhookSecret: true });
  });

  it("is offered beside the tools, and only those not yet walked say Preview", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { asAda } = await workspaceOnAnyTool(db);

    const { providers } = await asAda.sockets.providers({});

    expect(
      Object.fromEntries(providers.map((one) => [one.id, [one.walked, one.webhookSecretFrom]])),
    ).toEqual({
      generic: [true, "deevy"],
      github: [true, "either"],
      gitlab: [false, "either"],
      linear: [false, "tool"],
      notion: [false, "handshake"],
      // A chat tool deevy only posts to, which signs nothing it sends here.
      slack: [false, "none"],
    });
  });
});

describe("a delivery from any tool", () => {
  it("opens a Run for the Agent its label names", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { response, planner } = await opened(db);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "applied", applied: 1 });
    expect(await db.query.issue.findFirst({})).toMatchObject({
      externalKey: "OPS-12",
      url: RECORD_URL,
      assigneeMemberId: planner.id,
    });
    expect(await db.query.run.findFirst({})).toMatchObject({
      agentMemberId: planner.id,
      trigger: "assignment",
      status: "pending",
    });
  });

  it("is refused when it is not signed with the Socket's secret, and writes nothing down", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, connected } = await workspaceOnAnyTool(db);

    const forged = await app.request(
      `/hooks/${connected.id}`,
      await delivery("whsec_a_secret_somebody_guessed", [labelled]),
    );

    expect(forged.status).toBe(401);
    expect(await db.query.inboundDelivery.findMany({})).toEqual([]);
    expect(await db.query.issue.findFirst({})).toBeUndefined();
  });

  it("takes a /approve as a comment and a ruling event as none it takes, and the Gate stays open", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, asPlanner, connected, posted, secret, sweep } = await opened(db);
    const run = await db.query.run.findFirst({});
    if (!run) throw new Error("the label opened no Run");
    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Rotate it on Tuesday.",
    });
    const before = Math.max(0, ...(await db.query.event.findMany({})).map((one) => one.seq));

    const said = await app.request(
      `/hooks/${connected.id}`,
      await delivery(secret, [
        { kind: "comment", issueExternalId: "10042", comment: graceSays("/approve") },
        {
          kind: "ruling",
          issueExternalId: "10042",
          comment: graceSays("Looks right to me"),
          decision: "approved",
          note: "Looks right to me",
        },
      ]),
    );
    await sweep();

    expect(said.status).toBe(200);
    expect(await said.json()).toMatchObject({
      status: "applied",
      applied: 1,
      skipped: ["Event 2 is `ruling`, and deevy takes only issue and comment events"],
    });
    expect(await db.query.gateDecision.findMany({})).toEqual([]);
    expect(await db.query.gateRequest.findFirst({ where: { id: gate.id } })).toMatchObject({
      status: "open",
    });
    const since = await db.query.event.findMany({ where: { seq: { gt: before } } });
    expect(since.map((one) => one.kind)).toEqual(["comment.created"]);
    expect(since[0]?.payload).toMatchObject({ body: "/approve", externalActor: "grace" });
    // And nothing answers it: the adapter hears the comment, and no word on the Gate.
    const heard = posted.map((post) => (JSON.parse(post.body) as { kind: string }).kind);
    expect(heard).toContain("comment.created");
    expect(heard.filter((kind) => kind.startsWith("gate."))).toEqual(["gate.requested"]);
  });
});

describe("a Gate on a record from any tool", () => {
  it("reaches the Workspace's webhooks naming the record, and is written nowhere else", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { asPlanner, connected, posted, sweep } = await opened(db);
    const run = await db.query.run.findFirst({});
    if (!run) throw new Error("the label opened no Run");

    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Rotate it on Tuesday.",
    });
    await sweep();

    const requested = await db.query.event.findFirst({ where: { kind: "gate.requested" } });
    expect(requested?.payload).toMatchObject({
      checkpoint: "plan",
      // Which tool it is in, for an adapter that hears every Gate in the Workspace.
      issueSocketId: connected.id,
      issueExternalId: "10042",
      issueKey: "OPS-12",
      issueUrl: RECORD_URL,
    });
    // The adapter heard it, signed the way it signs its own deliveries.
    const heard = posted.find((post) => JSON.parse(post.body).kind === "gate.requested");
    expect(heard?.url).toBe(ADAPTER);
    expect(
      await verifySignature({
        secret: subscriptionSecret,
        header: heard?.headers.get("deevy-signature") ?? "",
        body: heard?.body ?? "",
      }),
    ).toBe(true);
    expect(JSON.parse(heard?.body ?? "{}")).toMatchObject({
      subjectId: gate.id,
      payload: { issueKey: "OPS-12", issueUrl: RECORD_URL },
    });
    // And nothing went anywhere but the adapter: no comment, so no record of one.
    expect(posted.every((post) => post.url === ADAPTER)).toBe(true);
    expect(await db.query.socketMirror.findMany({})).toEqual([]);
    const owed = await db.query.delivery.findMany({ where: { target: "socket" } });
    expect(owed).toHaveLength(1);
    expect(owed[0]?.deliveredAt).toBeInstanceOf(Date);
  });

  it("is ruled on in deevy, and the adapter hears the Ruling naming the record", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { asGrace, asPlanner, connected, grace, posted, sweep } = await opened(db);
    const run = await db.query.run.findFirst({});
    if (!run) throw new Error("the label opened no Run");
    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Rotate it on Tuesday.",
    });
    await sweep();

    await asGrace.gates.approve({ requestId: gate.id, note: "Tuesday suits." });
    await sweep();

    expect(await db.query.gateDecision.findMany({})).toMatchObject([
      { gateRequestId: gate.id, memberId: grace.id, decision: "approved", note: "Tuesday suits." },
    ]);
    const approved = posted.find((post) => JSON.parse(post.body).kind === "gate.approved");
    expect(JSON.parse(approved?.body ?? "{}")).toMatchObject({
      subjectId: gate.id,
      payload: {
        checkpoint: "plan",
        note: "Tuesday suits.",
        issueSocketId: connected.id,
        issueExternalId: "10042",
        issueKey: "OPS-12",
        issueUrl: RECORD_URL,
      },
    });
    // Said to the adapter alone, which says it in the tool.
    expect(posted.every((post) => post.url === ADAPTER)).toBe(true);
    expect(await db.query.socketMirror.findMany({})).toEqual([]);
  });
});
