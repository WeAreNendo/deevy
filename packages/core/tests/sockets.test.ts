import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { router } from "../src/operations/index.ts";
import { openSecret } from "../src/secrets.ts";
import {
  fakeSockets,
  memberContext,
  testDb,
  testSealingSecret,
  type MemberContext,
} from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * Connecting a tool (ADR-0024).
 *
 * A Socket is a credential with a name on it, so what these hold is the two
 * directions it can leak: what deevy stores, which is sealed, and what deevy
 * answers, which never carries either half back out.
 */
async function admin(db: MemberContext["db"], options: { secret?: string } = {}) {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  const { sockets } = fakeSockets();
  const context = {
    ...ada,
    sockets,
    ...(options.secret === undefined ? { socketSecret: testSealingSecret } : {}),
  };
  return { ada, context, asAda: createRouterClient(router, { context }) };
}

describe("connecting a tool", () => {
  it("seals what it is given and says where the tool should knock", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await admin(db);

    const connected = await asAda.sockets.connect({
      provider: "stub",
      name: "Example tracker",
      credentials: { token: "ghs_a_real_looking_token" },
      webhookSecret: "whsec_the_tracker_and_deevy_share_this",
    });

    // The URL is the whole of what an operator has to paste into the tool.
    expect(connected.inboundUrl).toBe(`https://deevy.test/hooks/${connected.id}`);
    expect(connected.identity).toMatchObject({ login: "deevy" });
    expect(connected.hasCredentials).toBe(true);
    expect(connected.hasWebhookSecret).toBe(true);

    const row = await db.query.socket.findFirst({ where: { id: connected.id } });
    expect(row?.credentials).not.toContain("ghs_a_real_looking_token");
    expect(JSON.parse(await openSecret(testSealingSecret, row?.credentials ?? ""))).toEqual({
      token: "ghs_a_real_looking_token",
    });
    expect(await openSecret(testSealingSecret, row?.webhookSecret ?? "")).toBe(
      "whsec_the_tracker_and_deevy_share_this",
    );

    const listed = JSON.stringify(await asAda.sockets.list({}));
    expect(listed).not.toContain("ghs_a_real_looking_token");
    expect(listed).not.toContain("whsec_the_tracker_and_deevy_share_this");
  });

  it("refuses to hold a credential on a deployment that cannot seal one", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await admin(db, { secret: "" });

    await expect(
      asAda.sockets.connect({
        provider: "stub",
        name: "Example tracker",
        credentials: { token: "ghs_a_real_looking_token" },
      }),
    ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });

    // A Socket with nothing to hold is still connectable, which is what the
    // in-process stub is: a tool with no credential is not a risk to store.
    const connected = await asAda.sockets.connect({ provider: "stub", name: "Example tracker" });
    expect(connected.hasCredentials).toBe(false);
  });
});

describe("a connected tool", () => {
  it("can be rested and woken, and says so in the log", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await admin(db);
    const connected = await asAda.sockets.connect({ provider: "stub", name: "Example tracker" });

    const paused = await asAda.sockets.update({ socketId: connected.id, status: "paused" });
    expect(paused.status).toBe("paused");

    const renamed = await asAda.sockets.update({
      socketId: connected.id,
      name: "acme's GitHub",
      status: "active",
      pollMinutes: 15,
    });
    expect(renamed).toMatchObject({ name: "acme's GitHub", status: "active", pollMinutes: 15 });

    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "socket.updated")).toHaveLength(2);
  });

  it("takes an address as proof of who commented only where an admin says so", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await admin(db);
    const connected = await asAda.sockets.connect({
      provider: "stub",
      name: "Example tracker",
      config: { storeId: "kept" },
    });
    expect(connected.config).toEqual({ storeId: "kept" });

    // For a tool with nothing better to offer (ADR-0025), and said in the log
    // because it weakens what a Ruling from there is worth.
    const allowed = await asAda.sockets.update({ socketId: connected.id, identityByEmail: true });

    expect(allowed.config).toEqual({ storeId: "kept", identityByEmail: true });
    const updated = (await db.query.event.findMany({})).filter(
      (event) => event.kind === "socket.updated",
    );
    expect(updated.at(-1)?.payload).toMatchObject({ identityByEmail: true });
  });

  it("mints a new webhook secret, and says it exactly once", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await admin(db);
    const connected = await asAda.sockets.connect({ provider: "stub", name: "Example tracker" });

    const rotated = await asAda.sockets.rotate({ socketId: connected.id });

    expect(rotated.webhookSecret).toMatch(/^whsec_/);
    expect(rotated.inboundUrl).toBe(`https://deevy.test/hooks/${connected.id}`);
    const row = await db.query.socket.findFirst({ where: { id: connected.id } });
    expect(await openSecret(testSealingSecret, row?.webhookSecret ?? "")).toBe(
      rotated.webhookSecret,
    );
    // And never again: the read surface knows it exists and not what it is.
    const [listed] = (await asAda.sockets.list({})).sockets;
    expect(JSON.stringify(listed)).not.toContain(rotated.webhookSecret);
    expect(listed?.hasWebhookSecret).toBe(true);
  });

  it("offers the containers a Project can be bound to, and re-asks who deevy is", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await admin(db);
    const connected = await asAda.sockets.connect({ provider: "stub", name: "Example tracker" });

    const offered = await asAda.sockets.containers({ socketId: connected.id });
    expect(offered.containers).toEqual([
      { scope: { scopeKey: "acme/deevy" }, scopeKey: "acme/deevy", name: "acme/deevy" },
    ]);

    const checked = await asAda.sockets.test({ socketId: connected.id });
    expect(checked).toMatchObject({ ok: true, identity: { login: "deevy" } });
  });

  it("says what the tool has said lately", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await admin(db);
    const connected = await asAda.sockets.connect({ provider: "stub", name: "Example tracker" });

    expect((await asAda.sockets.inbound({ socketId: connected.id })).deliveries).toEqual([]);
  });

  it("is disconnected rather than deleted, and stops being offered", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await admin(db);
    const connected = await asAda.sockets.connect({ provider: "stub", name: "Example tracker" });

    await asAda.sockets.remove({ socketId: connected.id });

    expect((await asAda.sockets.list({})).sockets).toEqual([]);
    expect(await db.query.socket.findFirst({ where: { id: connected.id } })).toMatchObject({
      status: "removed",
    });
  });
});

/**
 * Where a tool delivers, when this deevy's address changes: a laptop behind a
 * tunnel whose hostname moved. Every registered hook points at the old one,
 * and polling is what keeps the loop alive meanwhile (docs/OPERATIONS.md).
 */
describe("a tool's delivery address", () => {
  it("is said for every connected tool, so it can be pasted again", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await admin(db);
    const connected = await asAda.sockets.connect({ provider: "stub", name: "Example tracker" });

    const listed = await asAda.sockets.list({});

    expect(listed.sockets[0]?.inboundUrl).toBe(`https://deevy.test/hooks/${connected.id}`);
  });

  it("is told to a tool that lets deevy say where its webhook goes, and the log says so", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const fake = fakeSockets();
    const asAda = createRouterClient(router, {
      context: { ...ada, sockets: fake.sockets, socketSecret: testSealingSecret },
    });
    const connected = await asAda.sockets.connect({ provider: "stub", name: "Example tracker" });

    const rewired = await asAda.sockets.rewire({ socketId: connected.id });

    expect(rewired).toEqual({ inboundUrl: `https://deevy.test/hooks/${connected.id}` });
    expect(fake.rewired).toEqual([`https://deevy.test/hooks/${connected.id}`]);
    const updated = (await db.query.event.findMany({})).find(
      (event) => event.kind === "socket.updated",
    );
    expect(updated?.payload).toMatchObject({ summary: expect.stringContaining("/hooks/") });
  });

  it("is the admin's to paste where the tool does not let deevy say it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const fake = fakeSockets();
    const stub = fake.sockets.stub;
    if (!stub) throw new Error("the fake is registered as the stub");
    const plain = {
      stub: (input: Parameters<typeof stub>[0]) => ({ ...stub(input), rewire: undefined }),
    };
    const asAda = createRouterClient(router, {
      context: { ...ada, sockets: plain, socketSecret: testSealingSecret },
    });
    const connected = await asAda.sockets.connect({ provider: "stub", name: "Example tracker" });

    await expect(asAda.sockets.rewire({ socketId: connected.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("paste"),
    });
  });
});

describe("what this deevy can speak", () => {
  it("is the providers it was built with, so a screen offers no tool it cannot connect", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await admin(db);

    const offered = await asAda.sockets.providers({});

    // The registry is what the entry handed `createApp`, and a build without
    // a provider refuses that Socket rather than failing to compile
    // (ADR-0024). A settings page that offered one anyway would be a button
    // whose only outcome is a refusal.
    expect(offered.providers).toEqual([
      { id: "stub", label: "the stub tracker", capabilities: ["tracker", "forge", "docs"] },
    ]);
  });
});
