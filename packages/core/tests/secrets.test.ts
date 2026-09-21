import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "../src/auth.ts";
import { betterAuthKeys } from "../src/keys.ts";
import { router } from "../src/operations/index.ts";
import { agentContext, fakeSockets, memberContext, testDb } from "./helpers.ts";

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
      context: { ...ada, sockets, apiKeys: betterAuthKeys(auth, db) },
    });
    const socket = await asAda.sockets.connect({ provider: "stub", name: "Example tracker" });
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

    const secret = [issued.key, sentinels.webhookSecret, sentinels.slackUrl];
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
