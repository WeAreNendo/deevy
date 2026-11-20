import { describe, expect, it } from "vite-plus/test";
import type { ChatGateMessage } from "@deevy/core/sockets";
import { createSlackSocket } from "../src/slack/index.ts";

/**
 * A Slack app as a Socket (ADR-0024, ADR-0036).
 *
 * Against recorded answers and an injected fetch, never the network. deevy
 * only calls Slack's Web API, with the bot token, and Slack sends deevy
 * nothing, so every case here is a call deevy makes and what Slack answers it.
 */
const now = new Date("2026-09-23T11:02:00Z");

type Call = { url: string; body: unknown; authorization: string | null };

function slack(answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const module = createSlackSocket({
    config: { teamId: "T07ACME001" },
    credentials: { botToken: "xoxb-not-a-real-token" },
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      const text = typeof init?.body === "string" ? init.body : "";
      const form = new Headers(init?.headers)
        .get("content-type")
        ?.startsWith("application/x-www-form-urlencoded");
      calls.push({
        url,
        body: text
          ? form
            ? Object.fromEntries(new URLSearchParams(text))
            : JSON.parse(text)
          : null,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      const method = url.split("/").pop() ?? "";
      // A list of answers is one per call, in order: a paged method's pages.
      const listed = answers[method];
      const answer = (Array.isArray(listed) ? listed.shift() : listed) ?? { ok: true };
      return answer instanceof Response ? answer : Response.json(answer);
    },
    now: () => now,
  });
  if (!module.chat) throw new Error("a Slack Socket is a chat tool");
  return { module, chat: module.chat, calls };
}

const openGate: ChatGateMessage = {
  gateRequestId: "gate_k3xr8v2m9qpw",
  issueKey: "acme/deevy#42",
  issueUrl: "https://github.com/acme/deevy/issues/42",
  checkpoint: "plan",
  proposal: "## What I will do\n\nCap the coupon at the **basket total**.",
  agentName: "Planner",
  runId: "run_b1msparh0000",
  status: "open",
  approvals: 1,
  required: 2,
  url: "https://deevy.example.com/gates/gate_k3xr8v2m9qpw",
  rulings: ["Bob approved"],
};

describe("what deevy asks of Slack", () => {
  it("learns which team it is in while proving the token", async () => {
    const { module, calls } = slack({
      "auth.test": {
        ok: true,
        url: "https://acme.slack.com/",
        team: "Acme",
        user: "deevy",
        team_id: "T07ACME001",
        user_id: "U07DEEVY01",
        bot_id: "B07DEEVY01",
      },
    });

    expect(await module.identity()).toEqual({
      login: "deevy",
      id: "U07DEEVY01",
      mentionHandle: "@deevy",
      learned: { teamId: "T07ACME001", team: "Acme", url: "https://acme.slack.com/" },
    });
    expect(calls[0]).toMatchObject({
      url: "https://slack.com/api/auth.test",
      authorization: "Bearer xoxb-not-a-real-token",
    });
  });

  it("refuses a user's token, which would post as them", async () => {
    // auth.test's answer for a user token, as Slack documents it: no bot_id.
    const { module } = slack({
      "auth.test": {
        ok: true,
        url: "https://acme.slack.com/",
        team: "Acme",
        user: "grace",
        team_id: "T07ACME001",
        user_id: "U07GRACE01",
      },
    });

    await expect(module.identity()).rejects.toThrow(
      "This is grace's user token: deevy would post as them. Paste the app's Bot User OAuth Token, which starts xoxb-, instead.",
    );
  });

  it("posts an open Gate with a link to rule on it in deevy, and no button", async () => {
    const { chat, calls } = slack({
      "chat.postMessage": { ok: true, channel: "C07DEEVY01", ts: "1758625200.000100" },
    });

    const ref = await chat.post("C07DEEVY01", { kind: "gate", gate: openGate });

    expect(ref).toEqual({ channel: "C07DEEVY01", ts: "1758625200.000100" });
    expect(calls[0]?.url).toBe("https://slack.com/api/chat.postMessage");
    const sent = calls[0]?.body as { channel: string; text: string; blocks: unknown[] };
    expect(sent.channel).toBe("C07DEEVY01");
    expect(sent.text).toBe("Waiting on a ruling at the plan Checkpoint: acme/deevy#42");
    const drawn = JSON.stringify(sent.blocks);
    expect(drawn).toContain(
      "<https://deevy.example.com/gates/gate_k3xr8v2m9qpw|Rule on it in deevy>",
    );
    expect(drawn).toContain("1 of 2");
    expect(drawn).toContain("*basket total*");
    expect(drawn).toContain("Bob approved");
    // A button would send Slack's click to an app that takes nothing from Slack.
    expect(drawn).not.toContain('"type":"actions"');
    expect(drawn).not.toContain('"type":"button"');
  });

  it("changes a decided Gate's message in place, to a link that opens it in deevy", async () => {
    const { chat, calls } = slack();
    const ref = { channel: "C07DEEVY01", ts: "1758625200.000100" };

    await chat.update(ref, {
      kind: "gate",
      gate: {
        ...openGate,
        status: "approved",
        approvals: 2,
        rulings: ["Bob approved", "Grace approved"],
      },
    });

    expect(calls[0]?.url).toBe("https://slack.com/api/chat.update");
    const updated = calls[0]?.body as { channel: string; ts: string; blocks: unknown[] };
    expect(updated).toMatchObject({ channel: "C07DEEVY01", ts: "1758625200.000100" });
    const drawn = JSON.stringify(updated.blocks);
    expect(drawn).toContain("Approved · 2 of 2");
    expect(drawn).toContain("Bob approved · Grace approved");
    expect(drawn).toContain("<https://deevy.example.com/gates/gate_k3xr8v2m9qpw|Open it in deevy>");
    // Nothing is left to rule on, so nothing asks for it.
    expect(drawn).not.toContain("Rule on it in deevy");
    expect(drawn).not.toContain('"type":"actions"');
    expect(drawn).not.toContain('"type":"button"');
  });

  it("lists the channels it is in, public and private, a page at a time", async () => {
    const { chat, calls } = slack({
      // What users.conversations answers, two pages of it.
      "users.conversations": [
        {
          ok: true,
          channels: [
            { id: "C07DEEVY01", name: "deevy", is_private: false, is_archived: false },
            { id: "G07OPS0001", name: "ops", is_private: true, is_archived: false },
          ],
          response_metadata: { next_cursor: "dXNlcjpVMDYxTkZUVDI=" },
        },
        {
          ok: true,
          channels: [{ id: "C07GATES01", name: "gates", is_private: false, is_archived: false }],
          response_metadata: { next_cursor: "" },
        },
      ],
    });

    expect(await chat.listChannels?.()).toEqual([
      { id: "C07DEEVY01", name: "deevy" },
      { id: "G07OPS0001", name: "ops" },
      { id: "C07GATES01", name: "gates" },
    ]);
    // A read method takes a form, not JSON, or Slack reads none of what it was asked.
    expect(calls.map((one) => one.body)).toEqual([
      { types: "public_channel,private_channel", exclude_archived: "true", limit: "200" },
      {
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: "200",
        cursor: "dXNlcjpVMDYxTkZUVDI=",
      },
    ]);
    expect(calls[0]).toMatchObject({
      url: "https://slack.com/api/users.conversations",
      authorization: "Bearer xoxb-not-a-real-token",
    });
    // Nor does it open anybody's direct messages any more.
    expect(chat).not.toHaveProperty("openDm");
  });

  it("says what Slack said when it refuses, in words and then its code", async () => {
    const { module, chat } = slack({
      // What slack.com answers a made-up token, byte for byte.
      "auth.test": { ok: false, error: "invalid_auth" },
      "chat.postMessage": { ok: false, error: "not_in_channel" },
      "users.conversations": {
        ok: false,
        error: "missing_scope",
        needed: "groups:read",
        provided: "chat:write,channels:read",
      },
      "chat.update": [
        { ok: false, error: "fatal_error" },
        new Response("upstream timed out", { status: 502 }),
      ],
    });
    const ref = { channel: "C07GATES", ts: "1.2" };

    await expect(module.identity()).rejects.toThrow(
      "Slack does not know this token (invalid_auth, auth.test)",
    );
    await expect(chat.post("C07GATES", { kind: "gate", gate: openGate })).rejects.toThrow(
      "deevy is not in that channel: /invite @deevy there (not_in_channel, chat.postMessage)",
    );
    await expect(chat.listChannels?.()).rejects.toThrow(
      "The app is missing the groups:read scope: add it under OAuth & Permissions and reinstall it (missing_scope, users.conversations)",
    );
    await expect(chat.update(ref, { kind: "gate", gate: openGate })).rejects.toThrow(
      "Slack answered fatal_error (chat.update)",
    );
    // A body that is not Slack's own has no code to say, so the status is said.
    await expect(chat.update(ref, { kind: "gate", gate: openGate })).rejects.toThrow(
      "Slack answered HTTP 502 (chat.update)",
    );
  });
});
