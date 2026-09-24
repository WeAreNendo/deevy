import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "../src/auth.ts";
import { openSecret, requireSealingSecret, sealSecret } from "../src/secrets.ts";
import { betterAuthKeys } from "../src/keys.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, testDb, testSealingSecret } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * Values that must never come back out. Each is distinctive enough that
 * finding it in a response is unambiguous, and none of them is a substring of
 * anything else the fixtures contain.
 */
const sentinels = {
  webhookSecret: "whsec_SENTINEL_webhook_signing_secret",
  slackUrl: "https://hooks.slack.test/SENTINEL_incoming_webhook",
  /** What a Socket authenticates as, which is the newest kind of secret here. */
  socketCredential: "ghs_SENTINEL_installation_token",
  socketWebhook: "whsec_SENTINEL_what_the_tracker_signs_with",
};

/**
 * "No secret is ever returned" was held by convention: every slice checked its
 * own responses by hand, and two leaks got through anyway. This asks the built
 * system instead, over the whole read surface at once, with real secrets in
 * the database.
 */
describe("the read surface", () => {
  it("never carries a secret back out, whatever it is asked", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const auth = createAuth({
      db,
      env: {
        baseURL: "http://localhost:3000",
        secret: "test-secret-that-is-at-least-32-characters",
        providers: { github: { clientId: "id", clientSecret: "secret" } },
      },
    });
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    // With the real key store on the context, so agents.keys.list answers for
    // real rather than refusing and quietly passing this test.
    const { sockets } = fakeSockets();
    const asAda = createRouterClient(router, {
      context: {
        ...ada,
        sockets,
        socketSecret: testSealingSecret,
        apiKeys: betterAuthKeys(auth, db),
      },
    });
    const socket = await asAda.sockets.connect({
      provider: "stub",
      name: "Example tracker",
      credentials: { token: sentinels.socketCredential },
      webhookSecret: sentinels.socketWebhook,
    });
    // The envelopes themselves, read straight from the columns: a response that
    // carried one would pass a grep for the plaintext and still be a leak.
    const sealed = await db.query.socket.findFirst({ where: { id: socket.id } });
    const project = await asAda.projects.create({
      slug: "deevy",
      name: "deevy",
      tracker: { socketId: socket.id, scope: { scopeKey: "acme/deevy" } },
    });
    const agent = await agentContext(db, { sponsor: ada.member, grants: [project.id] });
    const issue = await asAda.issues.create({
      projectSlug: "deevy",
      title: "Something to read back",
    });

    const issued = await betterAuthKeys(auth, db).issue({
      userId: agent.member.userId,
      name: "ci",
    });
    await asAda.webhooks.create({
      url: "https://runner.example/deevy",
      secret: sentinels.webhookSecret,
    });
    const channel = await asAda.channels.create({
      name: "engineering",
      webhookUrl: sentinels.slackUrl,
    });
    await asAda.routing.set({
      rules: [{ channelId: channel.id, notificationKind: null, projectId: null }],
    });
    await asAda.agents.update({
      memberId: agent.member.id,
      webhookUrl: "https://runner.example/agent",
      webhookSecret: sentinels.webhookSecret,
    });

    const subscriptions = await asAda.webhooks.list({});
    const reads: Record<string, unknown> = {
      "me.get": await asAda.me.get({}),
      "workspace.get": await asAda.workspace.get({}),
      "members.list": await asAda.members.list({}),
      "agents.list": await asAda.agents.list({}),
      "agents.keys.list": await asAda.agents.keys.list({ memberId: agent.member.id }),
      "projects.list": await asAda.projects.list({}),
      "projects.get": await asAda.projects.get({ slug: "deevy" }),
      // A Socket is a credential by definition (ADR-0024), so its read is the
      // one this ratchet most has to cover.
      "sockets.list": await asAda.sockets.list({}),
      "sockets.inbound": await asAda.sockets.inbound({ socketId: socket.id }),
      "sockets.containers": await asAda.sockets.containers({ socketId: socket.id }),
      "issues.list": await asAda.issues.list({ projectSlug: "deevy" }),
      "issues.get": await asAda.issues.get({ issue: issue.externalKey }),
      "events.list": await asAda.events.list({}),
      "inbox.list": await asAda.inbox.list({}),
      "webhooks.list": subscriptions,
      "webhooks.deliveries": await asAda.webhooks.deliveries({
        subscriptionId: subscriptions.subscriptions[0]?.id ?? "",
      }),
      "channels.list": await asAda.channels.list({}),
      "routing.list": await asAda.routing.list({}),
      "preferences.get": await asAda.preferences.get({}),
      "oauthClients.list": await asAda.oauthClients.list({}),
    };

    const secret = [
      issued.key,
      sentinels.webhookSecret,
      sentinels.slackUrl,
      sentinels.socketCredential,
      sentinels.socketWebhook,
      sealed?.credentials ?? "",
      sealed?.webhookSecret ?? "",
    ].filter((value) => value.length > 0);
    const leaks: string[] = [];
    for (const [name, answer] of Object.entries(reads)) {
      const serialised = JSON.stringify(answer);
      for (const value of secret) {
        if (serialised.includes(value)) leaks.push(`${name} carries ${value.slice(0, 24)}…`);
      }
    }
    expect(leaks).toEqual([]);

    // The search itself works: the one response that is meant to carry a key
    // does, so an empty result above is the surface being clean rather than
    // the grep being broken.
    expect(JSON.stringify(issued).includes(issued.key)).toBe(true);
  });
});

/**
 * What a Socket's credentials are wrapped in at rest (ADR-0024).
 *
 * The property that matters is not that the bytes look scrambled: it is that a
 * changed byte and a changed key both fail to open rather than opening into
 * something plausible, because what comes out of here is handed to a provider
 * as a credential.
 */
describe("sealing a credential", () => {
  const key = "a-secret-that-is-at-least-32-characters-long";

  it("opens what it sealed, and says which version sealed it", async () => {
    const sealed = await sealSecret(key, "ghs_the_installation_token");

    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("ghs_the_installation_token");
    expect(await openSecret(key, sealed)).toBe("ghs_the_installation_token");
  });

  it("seals the same value differently every time", async () => {
    const once = await sealSecret(key, "the same plaintext");
    const twice = await sealSecret(key, "the same plaintext");

    // A repeated envelope would tell a reader of the column that two Sockets
    // hold one credential, which is the one thing the column may not say.
    expect(once).not.toBe(twice);
    expect(await openSecret(key, twice)).toBe("the same plaintext");
  });

  it("refuses another key, a changed byte, and a shape it did not write", async () => {
    const sealed = await sealSecret(key, "ghs_the_installation_token");
    const tampered = `${sealed.slice(0, -2)}${sealed.endsWith("aa") ? "bb" : "aa"}`;

    await expect(openSecret("a-different-secret-of-at-least-32-chars", sealed)).rejects.toThrow();
    await expect(openSecret(key, tampered)).rejects.toThrow();
    await expect(openSecret(key, "not-an-envelope")).rejects.toThrow();
    await expect(openSecret(key, "v2.aaaa.bbbb")).rejects.toThrow();
  });

  it("holds a credential that is JSON, which is what a Socket stores", async () => {
    const credentials = { appId: "12345", privateKey: "-----BEGIN RSA PRIVATE KEY-----" };
    const sealed = await sealSecret(key, JSON.stringify(credentials));

    expect(JSON.parse(await openSecret(key, sealed))).toEqual(credentials);
  });

  it("says a deployment with no secret cannot connect a tool", () => {
    expect(() => requireSealingSecret(undefined)).toThrow(/secret/i);
    expect(() => requireSealingSecret("short")).toThrow(/32/);
    expect(requireSealingSecret(key)).toBe(key);
  });
});
