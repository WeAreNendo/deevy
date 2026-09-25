import { socket as socketTable, type Db } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { router } from "../src/operations/index.ts";
import { openSecret } from "../src/secrets.ts";
import type { SetupResult, SocketModule, SocketModules } from "../src/sockets/port.ts";
import { memberContext, testDb, testSealingSecret } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * Connecting a tool that takes more than a paste (ADR-0024).
 *
 * GitHub's App manifest flow sends the operator to GitHub and back with a
 * one-use code, so deevy has to have a Socket to send them back to before it
 * has any credential to put in one. `sockets.begin` writes that row, the
 * provider's redirect lands on `/hooks/<id>/setup`, and what the provider
 * hands back is sealed exactly as a pasted credential would be.
 */
function setupSockets(
  result: SetupResult,
  asked: { params?: Record<string, string>; redirectUri?: string } = {},
) {
  const module = (): SocketModule => ({
    provider: "stub",
    capabilities: new Set(["tracker"] as const),
    identity: () => Promise.resolve({ login: "deevy", id: "1", mentionHandle: "@deevy" }),
    setup: ({ params, redirectUri }) => {
      asked.params = params;
      if (redirectUri) asked.redirectUri = redirectUri;
      return Promise.resolve(result);
    },
    install: ({ redirectUri, state }) =>
      `https://tracker.test/install?${new URLSearchParams({ redirect_uri: redirectUri, state }).toString()}`,
  });
  return { stub: module } satisfies SocketModules;
}

async function workspace(db: Db, sockets: SocketModules) {
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  // Both secrets, as `createApp` puts them on a request's context: one seals
  // what is stored, the other signs what leaves and comes back.
  const context = { ...ada, sockets, socketSecret: testSealingSecret, secret: testSealingSecret };
  return {
    ada,
    asAda: createRouterClient(router, { context }),
    app: createApp({
      db,
      sockets,
      socketSecret: testSealingSecret,
      secret: testSealingSecret,
      baseURL: "https://deevy.test",
    }),
  };
}

const converted: SetupResult = {
  config: { appId: "1284461", slug: "deevy-acme" },
  credentials: { privateKey: "-----BEGIN RSA PRIVATE KEY-----\nnot-a-real-one\n-----END…" },
  webhookSecret: "whsec_github_made_this_one",
  identity: { login: "deevy-acme[bot]", id: "1284461", mentionHandle: "@deevy-acme" },
  summary: "Connected the GitHub App deevy (acme)",
};

describe("a Socket that is not connected yet", () => {
  it("exists so the provider has somewhere to send the operator back to", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await workspace(db, setupSockets(converted));

    const begun = await asAda.sockets.begin({ provider: "stub", name: "acme on GitHub" });

    expect(begun.status).toBe("pending");
    expect(begun.hasCredentials).toBe(false);
    expect(begun.inboundUrl).toBe(`https://deevy.test/hooks/${begun.id}`);
    expect(begun.setupUrl).toBe(`https://deevy.test/hooks/${begun.id}/setup`);
    // And where a Human comes back to after linking their own account on the
    // tool, which the tool's OAuth app has to list beside the setup route.
    expect(begun.accountCallbackUrl).toBe("https://deevy.test/api/identities/stub/callback");
    // What GitHub echoes back, so the redirect that lands can be shown to have
    // come from the flow this deevy started.
    expect(begun.state).toMatch(/^[0-9]+\.[A-Za-z0-9_-]+$/);
    // And it is offered in the list, so a half-made Socket is not invisible.
    expect((await asAda.sockets.list({})).sockets.map((one) => one.status)).toEqual(["pending"]);
  });
});

describe("the redirect that finishes it", () => {
  it("seals what the provider handed back and makes the Socket live", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const asked: { params?: Record<string, string>; redirectUri?: string } = {};
    const { asAda, app } = await workspace(db, setupSockets(converted, asked));
    const begun = await asAda.sockets.begin({ provider: "stub", name: "acme on GitHub" });

    const landed = await app.request(
      `/hooks/${begun.id}/setup?code=abc123&state=${encodeURIComponent(begun.state)}`,
    );

    expect(landed.status).toBe(302);
    expect(landed.headers.get("location")).toBe(`https://deevy.test/settings/sockets/${begun.id}`);
    expect(asked.params).toMatchObject({ code: "abc123" });
    // An OAuth code is traded naming the address it was sent to, exactly.
    expect(asked.redirectUri).toBe(`https://deevy.test/hooks/${begun.id}/setup`);

    const row = await db.query.socket.findFirst({ where: { id: begun.id } });
    expect(row).toMatchObject({
      status: "active",
      config: { appId: "1284461", slug: "deevy-acme" },
      identity: { login: "deevy-acme[bot]" },
    });
    // Sealed, both of them, exactly as a pasted credential is (secrets.ts).
    expect(row?.credentials).not.toContain("BEGIN RSA");
    expect(JSON.parse(await openSecret(testSealingSecret, row?.credentials ?? ""))).toMatchObject({
      privateKey: converted.credentials?.privateKey,
    });
    expect(await openSecret(testSealingSecret, row?.webhookSecret ?? "")).toBe(
      "whsec_github_made_this_one",
    );
    // What it can do is the provider's, as it is for a pasted one: a Socket
    // that says it can do nothing is offered to no Project's binding, which is
    // how the first GitHub App connected for real could not be bound.
    const [listed] = (await asAda.sockets.list({})).sockets;
    expect(listed?.capabilities).toEqual(["tracker"]);

    const kinds = (await db.query.event.findMany({})).map((event) => event.kind);
    expect(kinds).toContain("socket.connected");
  });

  it("sends the operator on to the tool, where the provider says to go there next", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, app } = await workspace(
      db,
      setupSockets({
        ...converted,
        redirectTo: "https://github.test/apps/deevy-acme/installations/new",
      }),
    );
    const begun = await asAda.sockets.begin({ provider: "stub", name: "acme on GitHub" });

    const landed = await app.request(
      `/hooks/${begun.id}/setup?code=abc123&state=${encodeURIComponent(begun.state)}`,
    );

    // Absolute and https, so it is the tool's page and not a path in deevy.
    expect(landed.status).toBe(302);
    expect(landed.headers.get("location")).toBe(
      "https://github.test/apps/deevy-acme/installations/new",
    );
  });

  it("refuses a redirect this deevy did not start", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, app } = await workspace(db, setupSockets(converted));
    const begun = await asAda.sockets.begin({ provider: "stub", name: "acme on GitHub" });

    const landed = await app.request(`/hooks/${begun.id}/setup?code=abc123&state=made-up`);

    expect(landed.status).toBe(401);
    expect(await db.query.socket.findFirst({ where: { id: begun.id } })).toMatchObject({
      status: "pending",
      credentials: null,
    });
  });

  it("takes a second redirect that only adds to the configuration", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, app } = await workspace(
      db,
      setupSockets({
        config: { installations: [{ id: "61892041", account: "acme" }] },
        summary: "The App is installed on acme",
      }),
    );
    const begun = await asAda.sockets.begin({ provider: "stub", name: "acme on GitHub" });
    await db.update(socketTable).set({ status: "active" }).where(eq(socketTable.id, begun.id));

    // No state: GitHub's own install redirect carries none, and what it
    // carries instead is an id the provider checks with GitHub itself.
    const landed = await app.request(`/hooks/${begun.id}/setup?installation_id=61892041`);

    expect(landed.status).toBe(302);
    const row = await db.query.socket.findFirst({ where: { id: begun.id } });
    expect(row?.config).toMatchObject({ installations: [{ id: "61892041", account: "acme" }] });
    expect(row?.status).toBe("active");
  });
});

/**
 * Giving a connected tool's app more than pasting its credential could:
 * Linear's install as an agent, which only a workspace admin can consent to,
 * on Linear's own page (ADR-0024).
 */
describe("a connected tool's own install", () => {
  it("starts on the tool's page and comes back to the setup route, which takes it", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda, app } = await workspace(
      db,
      setupSockets({ config: { assignable: true }, summary: "deevy can be assigned" }),
    );
    const begun = await asAda.sockets.begin({ provider: "stub", name: "Acme on Linear" });
    await db.update(socketTable).set({ status: "active" }).where(eq(socketTable.id, begun.id));

    const { url } = await asAda.sockets.install({ socketId: begun.id });
    const search = new URL(url).searchParams;
    expect(search.get("redirect_uri")).toBe(`https://deevy.test/hooks/${begun.id}/setup`);

    const landed = await app.request(
      `/hooks/${begun.id}/setup?code=install-code&state=${encodeURIComponent(search.get("state") ?? "")}`,
    );

    expect(landed.status).toBe(302);
    expect(await db.query.socket.findFirst({ where: { id: begun.id } })).toMatchObject({
      config: { assignable: true },
    });
  });

  it("is an admin's to start", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const { asAda } = await workspace(db, setupSockets(converted));
    const begun = await asAda.sockets.begin({ provider: "stub", name: "Acme on Linear" });
    const bob = await memberContext(db, { name: "Bob" });

    await expect(
      createRouterClient(router, {
        context: { ...bob, sockets: setupSockets(converted), secret: testSealingSecret },
      }).sockets.install({ socketId: begun.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is not offered by a tool that has none", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const plain = {
      stub: (): SocketModule => ({
        provider: "stub",
        capabilities: new Set(["tracker"] as const),
        identity: () => Promise.resolve({ login: "deevy", id: "1", mentionHandle: "@deevy" }),
      }),
    } satisfies SocketModules;
    const { asAda } = await workspace(db, plain);
    const begun = await asAda.sockets.begin({ provider: "stub", name: "Plain" });

    await expect(asAda.sockets.install({ socketId: begun.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
