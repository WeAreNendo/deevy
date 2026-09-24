import { openDatabase } from "@deevy/adapters/node";
import { createApp, newId, router, runDueWork, sealSecret } from "@deevy/core";
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
import { createNotionSocket, socketModules } from "../src/index.ts";
import page from "./fixtures/notion/page.json" with { type: "json" };
import changed from "./fixtures/notion/page.properties_updated.json" with { type: "json" };
import commented from "./fixtures/notion/comment.created.json" with { type: "json" };

/**
 * Notion, through the door deevy actually serves (ADR-0024, ADR-0025).
 *
 * The module is proved against Notion's documented shapes in the other
 * `notion-*` tests. This puts the real module behind the real route with a real
 * database and replaces only Notion's API — so what is under test is the whole
 * sentence: Notion verifies the webhook, somebody tags a row for an Agent,
 * deevy reads the row back because Notion only said which one, the Proposal is
 * the integration's comment on it, a Human approves by commenting once an admin
 * has allowed their address to vouch for them, and the Agent reads the plan
 * where the team keeps it.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const migrationsFolder = new URL("../../db/drizzle", import.meta.url).pathname;
const sealing = "a-test-sealing-secret-of-at-least-32-chars";
const verificationToken = "secret_notion-verification-token-for-tests";
const WORKSPACE = changed.workspace_id;
const DATA_SOURCE = changed.data.parent.data_source_id;
const PAGE = page.id;
const BOT = "2f4e6a8c-0b1d-4e3f-a5b7-c9d1e3f5a7b9";
const GRACE = "c7c11cca-1d73-471d-9b6e-bdef51470190";
const STRANGER = "9f8e7d6c-0000-4000-8000-00000000abcd";
const PLAN = "3c5d7e9f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

/** Notion's API, as far as deevy can tell: pages, comments, users, and what was asked. */
function notionApi() {
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const row = structuredClone(page) as Omit<typeof page, "properties"> & {
    properties: Omit<typeof page.properties, "Tags"> & {
      Tags: { id: string; type: string; multi_select: { name: string }[] };
    };
  };
  const remarks = new Map<string, { author: string; text: string }>();
  let made = 0;
  const users: Record<string, object> = {
    [GRACE]: {
      id: GRACE,
      name: "Grace Hopper",
      type: "person",
      person: { email: "grace@example.com" },
    },
    [STRANGER]: {
      id: STRANGER,
      name: "A Stranger",
      type: "person",
      person: { email: "who@example.net" },
    },
    [BOT]: { id: BOT, name: "deevy", type: "bot", bot: {} },
  };

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? "GET";
    const path = url.replace("https://api.notion.com/v1", "");
    const body = (typeof init?.body === "string" ? JSON.parse(init.body) : {}) as Record<
      string,
      unknown
    >;
    calls.push({ method, path, body });

    if (method === "GET" && path === `/pages/${PAGE}`) return Response.json(row);
    if (method === "GET" && path === `/pages/${PAGE}/markdown`) {
      return Response.json({
        object: "page_markdown",
        markdown: "A 10% coupon takes it below zero.",
      });
    }
    if (method === "PATCH" && path === `/pages/${PAGE}`) {
      const tags = (body.properties as { Tags?: { multi_select: { name: string }[] } }).Tags;
      if (tags) row.properties.Tags.multi_select = tags.multi_select;
      return Response.json(row);
    }
    if (method === "POST" && path === "/comments") {
      return Response.json({ object: "comment", id: `mine-${String(++made)}` });
    }
    const comment = /^\/comments\/(.+)$/.exec(path)?.[1];
    if (method === "GET" && comment && remarks.has(comment)) {
      const said = remarks.get(comment);
      return Response.json({
        object: "comment",
        id: comment,
        created_time: "2026-09-24T10:21:00.000Z",
        created_by: { object: "user", id: said?.author },
        rich_text: [{ type: "text", plain_text: said?.text }],
      });
    }
    const user = /^\/users\/(.+)$/.exec(path)?.[1];
    if (method === "GET" && user && users[user]) return Response.json(users[user]);
    if (method === "GET" && path === `/pages/${PLAN}`) {
      return Response.json({
        object: "page",
        id: PLAN,
        url: "https://www.notion.so/acme/Checkout-plan-3c5d7e9f1a2b4c3d8e4f5a6b7c8d9e0f",
        properties: { title: { type: "title", title: [{ plain_text: "Checkout plan" }] } },
      });
    }
    if (method === "GET" && path === `/pages/${PLAN}/markdown`) {
      return Response.json({ object: "page_markdown", markdown: "# Checkout plan\n\nCap it." });
    }
    return Response.json(
      { object: "error", status: 404, code: "object_not_found", message: "Could not find it." },
      { status: 404 },
    );
  };
  return { calls, fetch, remarks, row };
}

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
    // The address deevy vouches for: one the Human proved they read.
    emailVerified: true,
  });
  const id = newId("member");
  await db
    .insert(memberTable)
    .values({ id, workspaceId, userId, handle: name.toLowerCase(), role, kind: "human" });
  return (await db.query.member.findFirst({ where: { id } })) as Member;
}

/**
 * A Workspace with a Notion Socket that has not heard from Notion yet, and a
 * Project bound to the Tasks data source. Ada is the admin and the Planner's
 * Sponsor; Grace is the Human who will rule from Notion.
 */
async function workspaceOnNotion(db: Db) {
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

  const socketId = newId("socket");
  await db.insert(socketTable).values({
    id: socketId,
    workspaceId,
    provider: "notion",
    capabilities: ["tracker", "docs"],
    name: "Acme's Notion",
    identity: { login: "deevy", id: BOT, mentionHandle: "@deevy" },
    config: { workspaceId: WORKSPACE, workspaceName: "Acme" },
    credentials: await sealSecret(sealing, JSON.stringify({ token: "ntn_deevy_secret" })),
    installedBy: ada.id,
  });
  const projectId = newId("project");
  await db.insert(projectTable).values({
    id: projectId,
    workspaceId,
    slug: "tasks",
    name: "Tasks",
    trackerSocketId: socketId,
    trackerScope: {
      scopeKey: DATA_SOURCE,
      titleProperty: "Task name",
      statusProperty: "Status",
      closedValues: ["Done", "Won't do"],
      labelsProperty: "Tags",
      peopleProperty: "Assignee",
      parentProperty: "Parent item",
      keyProperty: "ID",
    },
    trackerScopeKey: `notion:${DATA_SOURCE}`,
    docsSocketId: socketId,
    docsScope: {},
  });
  await db.insert(projectGrant).values({ memberId: plannerId, projectId });

  const api = notionApi();
  const sockets = {
    ...socketModules(),
    notion: (input: Parameters<typeof createNotionSocket>[0]) =>
      createNotionSocket({ ...input, fetch: api.fetch }),
  };
  const app = createApp({ db, sockets, socketSecret: sealing, baseURL: "https://deevy.test" });
  const extra = { sockets, socketSecret: sealing };
  const asPlanner = createRouterClient(router, {
    context: contextFor(db, planner, workspace, { ...extra, grantedProjectIds: [projectId] }),
  });
  const asAda = createRouterClient(router, { context: contextFor(db, ada, workspace, extra) });
  const sweep = () =>
    runDueWork({ db, sockets, socketSecret: sealing, baseUrl: "https://deevy.test" });

  return { app, api, socketId, projectId, ada, grace, planner, asPlanner, asAda, sweep };
}

/** One delivery, signed as Notion signs: sha256 over the minified body, with its token. */
async function delivery(payload: object, token = verificationToken) {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-notion-signature": `sha256=${hex}` },
    body,
  };
}

function handshake(token = verificationToken) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verification_token: token }),
  };
}

let events = 0;

/** A comment Notion names, whose words and author the fake API will answer with. */
function comment(api: ReturnType<typeof notionApi>, author: string, text: string) {
  const id = `theirs-${String(++events)}`;
  api.remarks.set(id, { author, text });
  return { ...commented, id: `event-${String(events)}`, entity: { id, type: "comment" } };
}

async function verifiedAndRouted(db: Db) {
  const walk = await workspaceOnNotion(db);
  await walk.app.request(`/hooks/${walk.socketId}`, handshake());
  await walk.app.request(`/hooks/${walk.socketId}`, await delivery(changed));
  const run = await db.query.run.findFirst({ where: { agentMemberId: walk.planner.id } });
  if (!run) throw new Error("the tag opened no Run");
  return { ...walk, run };
}

describe("a Notion webhook", () => {
  it("is verified with the token Notion sent, which an admin reads from deevy until it is proven", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, asAda, socketId } = await workspaceOnNotion(db);

    expect((await app.request(`/hooks/${socketId}`, handshake())).status).toBe(200);
    expect(await asAda.sockets.handshake({ socketId })).toEqual({
      token: verificationToken,
      verified: false,
    });

    const first = await app.request(`/hooks/${socketId}`, await delivery(changed));
    expect(first.status).toBe(200);
    expect(await asAda.sockets.handshake({ socketId })).toEqual({ token: null, verified: true });
    // Proven, so an unsigned request changes nothing, and a forged one is refused.
    expect((await app.request(`/hooks/${socketId}`, handshake("secret_other"))).status).toBe(409);
    const forged = await app.request(
      `/hooks/${socketId}`,
      await delivery({ ...changed, id: "forged" }, "secret_other"),
    );
    expect(forged.status).toBe(401);
  });
});

describe("somebody tags a row in Notion", () => {
  it("and deevy reads it back, routes it, and says the Gate on it where the team reads", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { api, asPlanner, planner, sweep, run } = await verifiedAndRouted(db);

    // Notion said only which row; deevy read it, and the tag routed it.
    expect(await db.query.issue.findFirst({ where: { externalKey: "TASK-12" } })).toMatchObject({
      title: "Checkout totals are wrong with a coupon",
      body: "A 10% coupon takes it below zero.",
      stateName: "Not started",
      assigneeMemberId: planner.id,
    });
    expect(run).toMatchObject({ status: "pending", trigger: "assignment" });

    await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "## What I will do\n\nCap the coupon at the basket total.",
    });
    await sweep();

    const said = api.calls.find((call) => call.method === "POST" && call.path === "/comments");
    expect(said?.body).toMatchObject({
      parent: { page_id: PAGE },
      markdown: expect.stringContaining("Cap the coupon"),
    });
    expect(api.row.properties.Tags.multi_select.map((tag) => tag.name)).toContain(
      "deevy:awaiting-approval",
    );
  });

  it("is ruled on by a comment only once an admin lets a verified address vouch for its author", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { app, api, asAda, asPlanner, grace, socketId, sweep, run } = await verifiedAndRouted(db);
    const gate = await asPlanner.gates.request({
      runId: run.id,
      checkpoint: "plan",
      proposal: "Cap the coupon.",
    });

    // Notion has no account to link, and the address it reports is weaker
    // proof than one: off until an admin turns it on (ADR-0025).
    await app.request(
      `/hooks/${socketId}`,
      await delivery(comment(api, GRACE, "/approve cap it at the basket total")),
    );
    expect(await db.query.gateDecision.findMany({ where: { gateRequestId: gate.id } })).toEqual([]);

    await asAda.sockets.update({ socketId, identityByEmail: true });
    await app.request(
      `/hooks/${socketId}`,
      await delivery(comment(api, GRACE, "/approve cap it at the basket total")),
    );

    const [decision] = await db.query.gateDecision.findMany({ where: { gateRequestId: gate.id } });
    expect(decision).toMatchObject({
      memberId: grace.id,
      decision: "approved",
      via: "socket",
      socketId,
      note: "cap it at the basket total",
    });
    expect(await db.query.memberIdentity.findFirst({})).toMatchObject({
      memberId: grace.id,
      provider: "notion",
      instance: WORKSPACE,
      externalUserId: GRACE,
      verifiedBy: "email",
    });

    // An address nobody here verified rules nothing, and is told where to link.
    await app.request(`/hooks/${socketId}`, await delivery(comment(api, STRANGER, "/reject no")));
    await sweep();
    const replies = api.calls
      .filter((call) => call.method === "POST" && call.path === "/comments")
      .map((call) => String(call.body.markdown));
    expect(replies.some((body) => body.includes("ruled nothing"))).toBe(true);
    // The integration's own comment coming back rules nothing either.
    await app.request(`/hooks/${socketId}`, await delivery(comment(api, BOT, "/approve")));
    expect(await db.query.gateDecision.findMany({})).toHaveLength(1);
  });
});

describe("an Agent reading the plan", () => {
  it("gets a page's markdown through the Project's documents, and nothing from a Project without", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { asPlanner, asAda } = await workspaceOnNotion(db);

    const plan = await asPlanner.docs.get({
      project: "tasks",
      page: "https://www.notion.so/acme/Checkout-plan-3c5d7e9f1a2b4c3d8e4f5a6b7c8d9e0f",
    });
    expect(plan).toEqual({
      title: "Checkout plan",
      markdown: "# Checkout plan\n\nCap it.",
      url: "https://www.notion.so/acme/Checkout-plan-3c5d7e9f1a2b4c3d8e4f5a6b7c8d9e0f",
    });

    await asAda.projects.update({ slug: "tasks", docs: null });
    await expect(asPlanner.docs.get({ project: "tasks", page: PLAN })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
