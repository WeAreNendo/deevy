import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app.ts";
import { router } from "../src/operations/index.ts";
import { fakeChat, memberContext, testDb, testSealingSecret } from "./helpers.ts";

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * A chat tool is told about a Gate and sends deevy nothing (ADR-0036), so
 * connecting one is a bot token and nothing else: no signing secret, and no
 * address for the tool to call. What deevy posts there is chat-out's, in
 * `chat-out.test.ts`.
 */
async function admin() {
  const { db, close } = testDb();
  closers.push(close);
  const ada = await memberContext(db, { role: "admin", name: "Ada" });
  return { db, ada };
}

describe("connecting a Slack app", () => {
  it("records the team it learned while proving the token, and not in the identity", async () => {
    const { ada } = await admin();
    const chat = fakeChat();
    const asAda = createRouterClient(router, {
      context: { ...ada, sockets: chat.sockets, socketSecret: testSealingSecret },
    });

    const connected = await asAda.sockets.connect({
      provider: "slack",
      name: "Acme Slack",
      credentials: { botToken: "xoxb-not-a-real-token" },
    });

    expect(connected.config).toMatchObject({ teamId: "T0TEST", team: "Acme" });
    expect(connected.identity).toEqual({ login: "deevy", id: "U0DEEVY", mentionHandle: "@deevy" });
    expect(connected).toMatchObject({ status: "active", hasCredentials: true });
  });

  it("takes no signing secret, since Slack sends deevy nothing to sign", async () => {
    const { db, ada } = await admin();
    const chat = fakeChat();
    const asAda = createRouterClient(router, {
      context: { ...ada, sockets: chat.sockets, socketSecret: testSealingSecret },
    });

    await expect(
      asAda.sockets.connect({
        provider: "slack",
        name: "Acme Slack",
        credentials: { botToken: "xoxb-not-a-real-token" },
        webhookSecret: "a-slack-signing-secret",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Slack sends deevy nothing") as unknown,
    });
    expect(await db.query.socket.findMany({})).toEqual([]);
  });

  it("is refused at the address a tracker delivers to", async () => {
    const { db, ada } = await admin();
    const chat = fakeChat();
    const asAda = createRouterClient(router, {
      context: { ...ada, sockets: chat.sockets, socketSecret: testSealingSecret },
    });
    const slack = await asAda.sockets.connect({
      provider: "slack",
      name: "Acme Slack",
      credentials: { botToken: "xoxb-not-a-real-token" },
    });
    const app = createApp({ db, sockets: chat.sockets, socketSecret: testSealingSecret });

    const response = await app.request(`/hooks/${slack.id}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "payload=%7B%22type%22%3A%22block_actions%22%7D",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "This Socket does not take deliveries" });
    expect(await db.query.inboundDelivery.findMany({})).toEqual([]);
  });

  it("proves the credential it was handed, not an empty one", async () => {
    const { ada } = await admin();
    const seen: Array<Record<string, string>> = [];
    const chat = fakeChat();
    const slack = chat.sockets.slack;
    if (!slack) throw new Error("the fake is a Slack Socket");
    const asAda = createRouterClient(router, {
      context: {
        ...ada,
        socketSecret: testSealingSecret,
        sockets: {
          slack: (input) => {
            seen.push(input.credentials);
            return slack(input);
          },
        },
      },
    });

    await asAda.sockets.connect({
      provider: "slack",
      name: "Acme Slack",
      credentials: { botToken: "xoxb-not-a-real-token" },
    });

    // A real Slack app answers `auth.test` only with the token: the module
    // that proves the connection has to be built with what the operator pasted.
    expect(seen[0]).toEqual({ botToken: "xoxb-not-a-real-token" });
  });
});
