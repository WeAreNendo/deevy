import type { Issue, Socket } from "@deevy/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createAuth } from "../src/auth.ts";
import { openSecret, requireSealingSecret, sealSecret } from "../src/secrets.ts";
import { betterAuthKeys } from "../src/keys.ts";
import { generateSpec } from "../src/openapi.ts";
import { router } from "../src/operations/index.ts";
import { applyInbound } from "../src/sockets/apply.ts";
import {
  agentContext,
  externalIssue,
  fakeSockets,
  memberContext,
  testDb,
  testSealingSecret,
} from "./helpers.ts";

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
  /** An email sender's key set in Settings › Email (docs/plans/email-channel.md). */
  emailKey: "re_SENTINEL_email_sender_key",
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
        emailSenders: {
          resend: () => ({
            kind: "resend" as const,
            send: () => Promise.resolve({ delivered: true as const, status: 200 }),
          }),
        },
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
    // A record the tracker announced on that Socket, so `issues.list` and
    // `issues.get` below have an Issue to answer with.
    await applyInbound({
      db,
      workspace: ada.workspace,
      socket: sealed as Socket,
      events: [
        {
          kind: "issue",
          scopeKey: "acme/deevy",
          issue: externalIssue({ externalId: "7", title: "Something to read back" }),
          actor: { login: "ada", id: "u-ada", isBot: false },
        },
      ],
    });
    const issue = (await db.query.issue.findFirst({ where: { externalId: "7" } })) as Issue;

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

    await asAda.email.configure({
      sender: "resend",
      from: "deevy <deevy@example.com>",
      config: {},
      credentials: { apiKey: sentinels.emailKey },
    });
    const emailRow = await db.query.emailSender.findFirst({});

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
      "email.status": await asAda.email.status({}),
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
      sentinels.emailKey,
      emailRow?.credentials ?? "",
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

  it("never answers with a Socket's sealed columns, from any sockets operation", async () => {
    const { db, close } = testDb();
    closers.push(close);
    const ada = await memberContext(db, { role: "admin", name: "Ada" });
    const { sockets } = fakeSockets();
    const asAda = createRouterClient(router, {
      context: {
        ...ada,
        sockets,
        socketSecret: testSealingSecret,
        // What `begin` signs its redirect's state with.
        secret: "test-secret-that-is-at-least-32-characters",
      },
    });
    const first = "whsec_SENTINEL_the_first_secret_pasted";
    const second = "whsec_SENTINEL_the_second_secret_pasted";

    const answers: Record<string, unknown> = {};
    answers["sockets.providers"] = await asAda.sockets.providers({});
    answers["sockets.begin"] = await asAda.sockets.begin({ provider: "stub", name: "Later" });
    const socket = await asAda.sockets.connect({
      provider: "stub",
      name: "Example tracker",
      credentials: { token: sentinels.socketCredential },
      webhookSecret: first,
    });
    answers["sockets.connect"] = socket;
    // A secret replaced twice, the second time by a mint, so the replaced one
    // and when it was replaced are both in the row: the sealed previous secret
    // was in every Socket answer and in openapi.json until 2026-10-16.
    answers["sockets.update"] = await asAda.sockets.update({
      socketId: socket.id,
      webhookSecret: second,
    });
    const afterUpdate = await db.query.socket.findFirst({ where: { id: socket.id } });
    const rotated = await asAda.sockets.rotate({ socketId: socket.id });
    // The minted one is the rotate answer's to say, once; nothing else is.
    answers["sockets.rotate"] = { ...rotated, webhookSecret: "(said once)" };
    const sealed = await db.query.socket.findFirst({ where: { id: socket.id } });
    expect(sealed?.previousWebhookSecret).toBeTruthy();
    expect(sealed?.webhookSecretChangedAt).toBeInstanceOf(Date);

    answers["sockets.list"] = await asAda.sockets.list({});
    answers["sockets.test"] = await asAda.sockets.test({ socketId: socket.id });
    answers["sockets.inbound"] = await asAda.sockets.inbound({ socketId: socket.id });
    answers["sockets.containers"] = await asAda.sockets.containers({ socketId: socket.id });
    answers["sockets.handshake"] = await asAda.sockets.handshake({ socketId: socket.id });
    answers["sockets.rewire"] = await asAda.sockets.rewire({ socketId: socket.id });
    answers["sockets.remove"] = await asAda.sockets.remove({ socketId: socket.id });

    const secret = [
      first,
      second,
      rotated.webhookSecret,
      sentinels.socketCredential,
      afterUpdate?.previousWebhookSecret ?? "",
      afterUpdate?.webhookSecret ?? "",
      sealed?.credentials ?? "",
      sealed?.webhookSecret ?? "",
      sealed?.previousWebhookSecret ?? "",
    ].filter((value) => value.length > 0);
    const leaks: string[] = [];
    for (const [name, answer] of Object.entries(answers)) {
      const serialised = JSON.stringify(answer);
      for (const value of secret) {
        if (serialised.includes(value)) leaks.push(`${name} carries ${value.slice(0, 24)}…`);
      }
      for (const column of socketColumnsNeverAnswered) {
        if (serialised.includes(`"${column}"`)) leaks.push(`${name} answers ${column}`);
      }
    }
    expect(leaks).toEqual([]);
    // Every sockets operation was asked, so one added later is asked too.
    expect(Object.keys(answers).sort()).toEqual(
      Object.keys(router.sockets)
        .map((name) => `sockets.${name}`)
        .filter((name) => name !== "sockets.install")
        .sort(),
    );
  });

  it("documents no answer that carries a sealed column or a stored secret", async () => {
    const spec = (await generateSpec()) as unknown as {
      paths: Record<string, Record<string, { operationId?: string; responses?: unknown }>>;
    };
    // The minted webhook secret is said once, by the three answers that mint
    // or would: `begin` and `connect` always say null.
    const sayOnce = new Set(["sockets.begin", "sockets.connect", "sockets.rotate"]);
    const found: string[] = [];
    let properties = 0;
    // Through everything under `responses` — status, content type, schema and
    // its nesting — reading names only where a schema lists its properties.
    const walk = (node: unknown, operation: string): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const one of node) walk(one, operation);
        return;
      }
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "properties" && value && typeof value === "object") {
          for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
            properties += 1;
            if (neverAnswered.has(name)) found.push(`${operation} answers ${name}`);
            if (name === "webhookSecret" && !sayOnce.has(operation)) {
              found.push(`${operation} answers webhookSecret`);
            }
            walk(child, operation);
          }
        } else {
          walk(value, operation);
        }
      }
    };
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const operation of Object.values(methods)) {
        walk(operation.responses, operation.operationId ?? path);
      }
    }
    expect(found).toEqual([]);
    // The walk reached the schemas: an empty list above is the document being
    // clean, not a walk that never got past `responses`.
    expect(properties).toBeGreaterThan(500);
  });
});

/**
 * A Socket row's columns no answer names: the sealed ones, and when its secret
 * changed, which no screen reads. The current `webhookSecret` is caught by its
 * value instead, since a mint's answer carries the new one under that name.
 */
const socketColumnsNeverAnswered = [
  "credentials",
  "previousWebhookSecret",
  "webhookSecretChangedAt",
];

/**
 * What no answer anywhere may carry, by name: every sealed column (a Socket's,
 * an email sender's `credentials`, an invitation's `sealedToken`), what is
 * stored to check a secret against (`tokenHash`), and a webhook
 * subscription's `secret`, which goes in and never comes out.
 */
const neverAnswered = new Set([
  "credentials",
  "previousWebhookSecret",
  "webhookSecretChangedAt",
  "sealedToken",
  "tokenHash",
  "secret",
  "clientSecret",
  "privateKey",
]);

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
