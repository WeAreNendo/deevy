import { issue as issueTable, socket as socketTable } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { router } from "../src/operations/index.ts";
import type { InboundEvent, SocketModules } from "../src/sockets/port.ts";
import { deliverDueSocketMirrors, runDueWork } from "../src/work.ts";
import {
  agentContext,
  externalIssue,
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
 * A Socket listens and announces (docs/plans/simplify.md, slice 4).
 *
 * It takes what the tool delivers and says on the record when a Gate opens and
 * when it is ruled on. Everything else a tool can do — list its records, open
 * one, label one, read its comments or its pages — is the Agent's business,
 * with its own access, so a tool that can do none of it is still a whole
 * Socket. That is what makes any tool cheap to connect.
 */

/** Three methods and an identity: everything a tracker has to be. */
function minimalTool(): {
  sockets: SocketModules;
  comments: Array<{ externalId: string; body: string }>;
} {
  const comments: Array<{ externalId: string; body: string }> = [];
  const sockets: SocketModules = {
    stub: () => ({
      provider: "stub",
      capabilities: new Set(["tracker"] as const),
      webhookSecretFrom: "either",
      identity: () => Promise.resolve({ login: "deevy", id: "bot-1", mentionHandle: "@deevy" }),
      tracker: {
        verifyInbound: ({ headers, rawBody, webhookSecret }) =>
          Promise.resolve({
            ok: headers.get("x-test-signature") === `${webhookSecret}:${String(rawBody.length)}`,
            deliveryId: headers.get("x-test-delivery"),
            eventName: "events",
          }),
        normalize: (_eventName, payload) =>
          ((payload as { events: InboundEvent[] }).events ?? []).map((event) =>
            event.kind === "issue"
              ? { ...event, issue: { ...event.issue, updatedAt: new Date(event.issue.updatedAt) } }
              : event,
          ),
        createComment: (_scope, ref, body) => {
          comments.push({ externalId: ref.externalId, body });
          return Promise.resolve({
            externalId: `c${String(comments.length)}`,
            url: `${ref.url}#c${String(comments.length)}`,
          });
        },
      },
    }),
  };
  return { sockets, comments };
}

describe("a tool with only the three methods a tracker must have", () => {
  it("is connected, bound by the container an admin types, routes a record and announces its Gate", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const tool = minimalTool();
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const asAda = createRouterClient(router, {
      context: { ...ada, sockets: tool.sockets, socketSecret: testSealingSecret },
    });
    const secret = "a-secret-the-tool-signs-with";

    const socket = await asAda.sockets.connect({
      provider: "stub",
      name: "A tool deevy has never heard of",
      webhookSecret: secret,
    });
    // It lists nothing, so the binding is the container's key, typed.
    expect(await asAda.sockets.containers({ socketId: socket.id })).toEqual({ containers: null });
    const project = await asAda.projects.create({
      slug: "typed",
      name: "Typed",
      tracker: { socketId: socket.id, scope: { scopeKey: "acme/typed" } },
    });
    const planner = await agentContext(db, {
      name: "Planner",
      handle: "planner",
      email: "planner@example.com",
      sponsor: ada.member,
      grants: [project.id],
    });

    const app = createApp({ db, sockets: tool.sockets, socketSecret: testSealingSecret });
    const body = JSON.stringify({
      events: [
        {
          kind: "issue",
          scopeKey: "acme/typed",
          issue: externalIssue({
            externalId: "7",
            key: "acme/typed#7",
            labels: ["agent:planner"],
          }),
          actor: { login: "ada", id: "u-ada", isBot: false },
        },
      ],
    });
    const delivered = await app.request(`/hooks/${socket.id}`, {
      method: "POST",
      headers: {
        "x-test-delivery": "delivery-1",
        "x-test-signature": `${secret}:${String(body.length)}`,
      },
      body,
    });
    expect(await delivered.json()).toMatchObject({ status: "applied" });

    const [run, ...more] = (await asAda.runs.list({})).runs;
    expect(more).toEqual([]);
    expect(run?.agentMemberId).toBe(planner.member.id);

    const asPlanner = createRouterClient(router, {
      context: { ...planner, sockets: tool.sockets, socketSecret: testSealingSecret },
    });
    await asPlanner.gates.request({
      runId: run?.id ?? "",
      checkpoint: "plan",
      proposal: "Cap the discount at the subtotal.",
    });
    const sent = await deliverDueSocketMirrors({
      db,
      workspaceId: ada.workspace.id,
      sockets: tool.sockets,
      socketSecret: testSealingSecret,
    });

    expect(sent.delivered).toBe(1);
    expect(tool.comments).toHaveLength(1);
    expect(tool.comments[0]?.externalId).toBe("7");
    expect(tool.comments[0]?.body).toContain("Cap the discount at the subtotal.");
  });
});

describe("what deevy no longer does to a tool", () => {
  it("asks no tool what changed: the background work polls nothing, and still forgets old deliveries", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const secret = "a-secret-the-tracker-and-deevy-share";
    const seeded = await seedProject(db, ada.workspace.id, { webhookSecret: secret });
    await agentContext(db, {
      name: "Planner",
      handle: "planner",
      email: "planner@example.com",
      sponsor: ada.member,
      grants: [seeded.project.id],
    });
    // A record the tracker holds and never delivered, on a Socket that once
    // had a schedule: polling would have found it.
    const held = externalIssue({ externalId: "1", labels: ["agent:planner"] });
    const { sockets } = fakeSockets(new Map([[held.externalId, held]]));
    await db.update(socketTable).set({ pollMinutes: 5 }).where(eq(socketTable.id, seeded.socketId));

    const result = await runDueWork({
      db,
      sockets,
      socketSecret: testSealingSecret,
      limits: { maxPasses: 1 },
    });

    expect(result).not.toHaveProperty("syncedRecords");
    expect(await db.query.issue.findFirst({ where: { externalId: "1" } })).toBeUndefined();
    expect(await db.query.inboundDelivery.findMany({})).toEqual([]);

    // A delivery the tool did make is still bookkeeping once it is older than
    // any provider's retry window, and the sweep forgets it.
    const app = createApp({ db, sockets, socketSecret: testSealingSecret });
    const body = JSON.stringify({ events: [] });
    await app.request(`/hooks/${seeded.socketId}`, {
      method: "POST",
      headers: {
        "x-test-delivery": "delivery-1",
        "x-test-signature": `${secret}:${String(body.length)}`,
      },
      body,
    });
    const later = new Date(Date.now() + 40 * 24 * 60 * 60_000);
    const swept = await runDueWork({
      db,
      sockets,
      socketSecret: testSealingSecret,
      now: later,
      limits: { maxPasses: 1 },
    });
    expect(swept.forgottenDeliveries).toBe(1);
  });

  it("keeps no polling schedule on a Socket", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const { sockets } = fakeSockets();
    const asAda = createRouterClient(router, {
      context: { ...ada, sockets, socketSecret: testSealingSecret },
    });

    const socket = await asAda.sockets.connect({
      provider: "stub",
      name: "Example tracker",
      pollMinutes: 5,
    } as Parameters<typeof asAda.sockets.connect>[0]);
    const listed = await asAda.sockets.list({});

    expect(socket).not.toHaveProperty("pollMinutes");
    expect(listed.sockets[0]).not.toHaveProperty("pollMinutes");
  });

  it("says nothing of who opened a record, which only deevy's own sub-issues ever said", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const { sockets } = fakeSockets();
    const asAda = createRouterClient(router, { context: { ...ada, sockets } });
    const seeded = await seedProject(db, ada.workspace.id);
    const record = await seeded.record({ externalId: "42", title: "Checkout rewrite" });
    // Left behind until the clean break (schema/issue.ts), from before.
    await db
      .update(issueTable)
      .set({ createdBy: ada.member.id })
      .where(eq(issueTable.id, record.id));

    const got = await asAda.issues.get({ issue: record.url });
    const listed = await asAda.issues.list({});

    expect(got).toMatchObject({ id: record.id });
    expect(got).not.toHaveProperty("createdBy");
    expect(listed.issues[0]).not.toHaveProperty("createdBy");
  });

  it("keeps no mirror setting and no documents on a Project: every Project announces its Gates", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const { sockets } = fakeSockets();
    const asAda = createRouterClient(router, { context: { ...ada, sockets } });
    const seeded = await seedProject(db, ada.workspace.id);

    const updated = await asAda.projects.update({
      slug: seeded.project.slug,
      mirror: "off",
      docs: { socketId: seeded.socketId, scope: {} },
    } as Parameters<typeof asAda.projects.update>[0]);

    for (const key of ["mirror", "docsSocketId", "docsScope"]) {
      expect(updated).not.toHaveProperty(key);
    }
    const asked = await db.query.event.findMany({ where: { kind: "project.updated" } });
    expect(asked).toEqual([]);
  });
});
