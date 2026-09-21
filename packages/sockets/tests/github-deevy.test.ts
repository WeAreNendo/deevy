import { generateKeyPairSync } from "node:crypto";
import { openDatabase } from "@deevy/adapters/node";
import { createApp, newId, sealSecret } from "@deevy/core";
import {
  agent as agentTable,
  member as memberTable,
  project as projectTable,
  projectGrant,
  socket as socketTable,
  user as userTable,
  workspace as workspaceTable,
  type Db,
} from "@deevy/db";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { resetGithubTokens, socketModules } from "../src/index.ts";
import labeled from "./fixtures/github/issues.labeled.json" with { type: "json" };
import installed from "./fixtures/github/installation.created.json" with { type: "json" };

/**
 * GitHub, through the door deevy actually serves (ADR-0024).
 *
 * Every other test here holds one half: the module against recorded payloads,
 * or the route against a fake module. This one puts the real module behind the
 * real route with a real database, because what a team cares about is the
 * whole sentence — somebody labels an issue on GitHub, and an Agent has a Run.
 */
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  resetGithubTokens();
});

const migrationsFolder = new URL("../../db/drizzle", import.meta.url).pathname;
const sealing = "a-test-sealing-secret-of-at-least-32-chars";
const webhookSecret = "whsec_the_app_and_deevy_share_this";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/**
 * A Workspace with a GitHub Socket and a Project bound to `acme/deevy`,
 * written straight into the tables: what `sockets.connect` and
 * `projects.create` would have left, without an admin session to do it with.
 */
async function workspaceOnGithub(db: Db) {
  const workspaceId = newId("workspace");
  await db.insert(workspaceTable).values({ id: workspaceId, name: "Acme", slug: "acme" });

  const humanId = newId("user");
  await db.insert(userTable).values({ id: humanId, name: "Ada", email: "ada@example.com" });
  const adaId = newId("member");
  await db.insert(memberTable).values({
    id: adaId,
    workspaceId,
    userId: humanId,
    handle: "ada",
    role: "admin",
    kind: "human",
  });

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
    sponsorId: adaId,
  });
  await db.insert(agentTable).values({ memberId: plannerId });

  const socketId = newId("socket");
  await db.insert(socketTable).values({
    id: socketId,
    workspaceId,
    provider: "github",
    capabilities: ["tracker", "forge"],
    name: "acme on GitHub",
    identity: { login: "deevy[bot]", id: "1284461", mentionHandle: "@deevy" },
    config: { appId: "1284461", slug: "deevy", installations: [] },
    credentials: await sealSecret(sealing, JSON.stringify({ privateKey })),
    webhookSecret: await sealSecret(sealing, webhookSecret),
    installedBy: adaId,
  });

  const projectId = newId("project");
  await db.insert(projectTable).values({
    id: projectId,
    workspaceId,
    slug: "acme-deevy",
    name: "deevy",
    trackerSocketId: socketId,
    trackerScope: { scopeKey: "acme/deevy" },
    // How the inbound route finds a Project in one indexed read: the provider
    // and the container, as `scopeKeyOf` writes it.
    trackerScopeKey: "github:acme/deevy",
  });
  await db.insert(projectGrant).values({ memberId: plannerId, projectId });

  return { workspaceId, socketId, projectId, plannerId, adaId };
}

/** One delivery, signed the way GitHub signs: HMAC-SHA256 over the raw body. */
async function delivery(event: string, payload: unknown, id = "delivery-1") {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": id,
      "x-hub-signature-256": `sha256=${hex}`,
    },
    body,
  };
}

function deevy(db: Db) {
  return createApp({
    db,
    sockets: socketModules(),
    socketSecret: sealing,
    baseURL: "https://deevy.test",
  });
}

describe("somebody labels an issue on GitHub", () => {
  it("and the Agent it names has a Run", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { socketId, plannerId, projectId } = await workspaceOnGithub(db);
    const app = deevy(db);

    const answer = await app.request(`/hooks/${socketId}`, await delivery("issues", labeled));

    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ status: "applied", applied: 1 });

    // The record, as GitHub last said it.
    const issue = await db.query.issue.findFirst({ where: { externalKey: "acme/deevy#42" } });
    expect(issue).toMatchObject({
      projectId,
      title: "Checkout totals are wrong with a coupon",
      url: "https://github.com/acme/deevy/issues/42",
      state: "open",
      // The label routed it, which is how "assign it to deevy" is said on a
      // tracker that cannot assign an App.
      assigneeMemberId: plannerId,
    });

    const run = await db.query.run.findFirst({ where: { agentMemberId: plannerId } });
    expect(run).toMatchObject({ status: "pending", trigger: "assignment" });
    const kinds = (await db.query.event.findMany({ orderBy: { seq: "asc" } })).map(
      (event) => event.kind,
    );
    expect(kinds).toEqual(["issue.created", "issue.assigned", "run.started"]);
  });

  it("and sending it again is the same Run, not a second one", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { socketId } = await workspaceOnGithub(db);
    const app = deevy(db);
    const again = await delivery("issues", labeled, "delivery-1");

    await app.request(`/hooks/${socketId}`, await delivery("issues", labeled, "delivery-1"));
    const second = await app.request(`/hooks/${socketId}`, again);

    expect(await second.json()).toMatchObject({ status: "duplicate" });
    expect(await db.query.run.findMany({})).toHaveLength(1);
  });

  it("but a delivery signed with the wrong secret is refused and written nowhere", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { socketId } = await workspaceOnGithub(db);
    const app = deevy(db);
    const good = await delivery("issues", labeled);

    const answer = await app.request(`/hooks/${socketId}`, {
      ...good,
      headers: { ...good.headers, "x-hub-signature-256": "sha256=deadbeef" },
    });

    expect(answer.status).toBe(401);
    expect(await db.query.issue.findFirst({})).toBeUndefined();
    expect(await db.query.inboundDelivery.findMany({})).toEqual([]);
  });
});

describe("the App being installed somewhere", () => {
  it("is written down on the Socket, and said in the log", async () => {
    const { db, close } = openDatabase({ path: ":memory:", migrationsFolder });
    closers.push(close);
    const { socketId } = await workspaceOnGithub(db);
    const app = deevy(db);

    await app.request(`/hooks/${socketId}`, await delivery("installation", installed));

    const socket = await db.query.socket.findFirst({ where: { id: socketId } });
    expect(socket?.config).toMatchObject({
      installations: [{ id: "61892041", account: "acme" }],
    });
    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds).toContain("socket.installation_added");
  });
});
