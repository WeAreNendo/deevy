import { describe, expect, it } from "vite-plus/test";
import type { ChatGateMessage } from "@deevy/core/sockets";
import { createSlackSocket } from "../src/slack/index.ts";
import approve from "./fixtures/slack/block_actions.approve.json" with { type: "json" };
import reject from "./fixtures/slack/block_actions.reject.json" with { type: "json" };
import submission from "./fixtures/slack/view_submission.reject.json" with { type: "json" };

/**
 * A Slack app as a Socket (ADR-0024, ADR-0025).
 *
 * Against recorded requests and an injected fetch, never the network: what
 * Slack sends is a form with a JSON payload in it, signed over a timestamp and
 * the body, and what deevy sends back is the Web API's own shape.
 */
const secret = "8f14e45fceea167a5a36dedd4bea2543";
const now = new Date("2026-09-23T11:02:00Z");
const seconds = Math.floor(now.getTime() / 1000);

type Call = { url: string; body: unknown; authorization: string | null };

function slack(answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const module = createSlackSocket({
    config: { teamId: "T07ACME001" },
    credentials: { botToken: "xoxb-not-a-real-token" },
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      const text = typeof init?.body === "string" ? init.body : "";
      calls.push({
        url,
        body: text ? JSON.parse(text) : null,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      const method = url.split("/").pop() ?? "";
      const answer = answers[method] ?? { ok: true };
      return Response.json(answer);
    },
    now: () => now,
  });
  if (!module.chat) throw new Error("a Slack Socket is a chat tool");
  return { module, chat: module.chat, calls };
}

/** A body as Slack sends it: a form, with the JSON under `payload`. */
function form(payload: unknown): string {
  return new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
}

/** Slack's own signature: `v0=` HMAC-SHA256 over `v0:<timestamp>:<body>`. */
async function signed(body: string, at = seconds, over = secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(over),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${String(at)}:${body}`),
  );
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Headers({
    "x-slack-request-timestamp": String(at),
    "x-slack-signature": `v0=${hex}`,
    "content-type": "application/x-www-form-urlencoded",
  });
}

describe("a request Slack signed", () => {
  it("checks out, and says what kind of request it is", async () => {
    const rawBody = form(approve);
    const checked = await slack().chat.verifyInteraction({
      headers: await signed(rawBody),
      rawBody,
      webhookSecret: secret,
      now,
    });
    expect(checked).toEqual({ ok: true, deliveryId: null, eventName: "block_actions" });
  });

  it("is refused signed with anything else, or a byte different", async () => {
    const rawBody = form(approve);
    const { chat } = slack();
    const other = await chat.verifyInteraction({
      headers: await signed(rawBody, seconds, "a-different-signing-secret"),
      rawBody,
      webhookSecret: secret,
      now,
    });
    const tampered = await chat.verifyInteraction({
      headers: await signed(rawBody),
      rawBody: rawBody.replace("deevy_approve", "deevy_reject"),
      webhookSecret: secret,
      now,
    });
    expect(other.ok).toBe(false);
    expect(tampered.ok).toBe(false);
  });

  it("is refused when it is older than five minutes, however well it is signed", async () => {
    // Slack signs the timestamp so that a captured request cannot be replayed
    // later; the window is what makes that true (ADR-0025).
    const rawBody = form(approve);
    const stale = await slack().chat.verifyInteraction({
      headers: await signed(rawBody, seconds - 301),
      rawBody,
      webhookSecret: secret,
      now,
    });
    expect(stale.ok).toBe(false);
  });

  it("calls a slash command what it is", async () => {
    const rawBody = new URLSearchParams({
      team_id: "T07ACME001",
      user_id: "U07GRACE01",
      user_name: "grace",
      command: "/deevy",
      text: "link",
      response_url: "https://hooks.slack.com/commands/T07ACME001/1/abc",
    }).toString();
    const checked = await slack().chat.verifyInteraction({
      headers: await signed(rawBody),
      rawBody,
      webhookSecret: secret,
      now,
    });
    expect(checked).toMatchObject({ ok: true, eventName: "slash_command" });
  });
});

describe("what a Slack request means", () => {
  it("reads Approve as a Ruling by the user who clicked, on the message they clicked", () => {
    expect(slack().chat.normalizeInteraction("block_actions", form(approve))).toEqual({
      kind: "ruling",
      actor: { team: "T07ACME001", user: "U07GRACE01", login: "grace" },
      gateRequestId: "gate_k3xr8v2m9qpw",
      decision: "approved",
      note: null,
      wantsNote: false,
      message: { channel: "C07DEEVY01", ts: "1758625200.000100" },
      responseUrl: "https://hooks.slack.com/actions/T07ACME001/7654321098765/Zq1Xw2Ve3Ur4Ts5",
      triggerId: "9876543210123.7654321098765.0f1e2d3c4b5a69788796a5b4c3d2e1f0",
    });
  });

  it("reads Reject as a Ruling that wants its reason first", () => {
    expect(slack().chat.normalizeInteraction("block_actions", form(reject))).toMatchObject({
      kind: "ruling",
      decision: "rejected",
      wantsNote: true,
      note: null,
    });
  });

  it("reads the reason, when it comes, as the rejection itself", () => {
    expect(slack().chat.normalizeInteraction("view_submission", form(submission))).toEqual({
      kind: "ruling",
      actor: { team: "T07ACME001", user: "U07GRACE01", login: "grace" },
      gateRequestId: "gate_k3xr8v2m9qpw",
      decision: "rejected",
      note: "Not until the migration is split in two",
      wantsNote: false,
      message: { channel: "C07DEEVY01", ts: "1758625200.000100" },
      responseUrl: null,
      triggerId: null,
    });
  });

  it("reads `/deevy link` as a user asking to be linked, and anything else as nothing", () => {
    const { chat } = slack();
    const command = (text: string) =>
      new URLSearchParams({
        team_id: "T07ACME001",
        user_id: "U07GRACE01",
        user_name: "grace",
        command: "/deevy",
        text,
        response_url: "https://hooks.slack.com/commands/T07ACME001/1/abc",
      }).toString();

    expect(chat.normalizeInteraction("slash_command", command("link"))).toEqual({
      kind: "link",
      actor: { team: "T07ACME001", user: "U07GRACE01", login: "grace" },
      responseUrl: "https://hooks.slack.com/commands/T07ACME001/1/abc",
    });
    expect(chat.normalizeInteraction("slash_command", command("dance"))).toMatchObject({
      kind: "ignored",
    });
    // A button deevy did not draw is somebody else's.
    const foreign = {
      ...approve,
      actions: [{ ...approve.actions[0], action_id: "somebody_elses_button" }],
    };
    expect(chat.normalizeInteraction("block_actions", form(foreign))).toMatchObject({
      kind: "ignored",
    });
  });
});

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
  rulings: ["Bob approved, in deevy"],
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
    // Its accounts are its team's, and nobody signs in to deevy with them.
    expect(module.identityScope).toEqual({ instance: "T07ACME001" });
  });

  it("posts an open Gate with its two buttons, and a decided one with none", async () => {
    const { chat, calls } = slack({
      "chat.postMessage": { ok: true, channel: "C07DEEVY01", ts: "1758625200.000100" },
    });

    const ref = await chat.post("C07DEEVY01", { kind: "gate", gate: openGate });

    expect(ref).toEqual({ channel: "C07DEEVY01", ts: "1758625200.000100" });
    const sent = calls[0]?.body as { channel: string; text: string; blocks: unknown[] };
    expect(sent.channel).toBe("C07DEEVY01");
    expect(sent.text).toContain("acme/deevy#42");
    const drawn = JSON.stringify(sent.blocks);
    expect(drawn).toContain('"action_id":"deevy_approve"');
    expect(drawn).toContain('"action_id":"deevy_reject"');
    expect(drawn).toContain('"value":"gate_k3xr8v2m9qpw"');
    expect(drawn).toContain("1 of 2");
    expect(drawn).toContain("*basket total*");

    await chat.update(ref, {
      kind: "gate",
      gate: { ...openGate, status: "approved", approvals: 2, rulings: ["Bob", "Grace, in Slack"] },
    });
    const updated = calls[1]?.body as { ts: string; blocks: unknown[] };
    expect(calls[1]?.url).toBe("https://slack.com/api/chat.update");
    expect(updated.ts).toBe("1758625200.000100");
    expect(JSON.stringify(updated.blocks)).not.toContain("deevy_approve");
    expect(JSON.stringify(updated.blocks)).toContain("Approved");
  });

  it("opens a direct message, asks for a reason, and answers one person alone", async () => {
    const { chat, calls } = slack({
      "conversations.open": { ok: true, channel: { id: "D07GRACE01" } },
    });

    expect(await chat.openDm("U07GRACE01")).toBe("D07GRACE01");
    await chat.askForNote("9876543210123.trigger", {
      gateRequestId: "gate_k3xr8v2m9qpw",
      checkpoint: "plan",
      message: { channel: "C07DEEVY01", ts: "1758625200.000100" },
    });
    await chat.respond("https://hooks.slack.com/actions/T07ACME001/1/abc", "Linked.");

    expect(calls[0]).toMatchObject({ body: { users: "U07GRACE01" } });
    const modal = calls[1]?.body as { trigger_id: string; view: { private_metadata: string } };
    expect(modal.trigger_id).toBe("9876543210123.trigger");
    expect(JSON.parse(modal.view.private_metadata)).toEqual({
      gateRequestId: "gate_k3xr8v2m9qpw",
      channel: "C07DEEVY01",
      ts: "1758625200.000100",
    });
    // A response URL is its own credential: no token goes with it.
    expect(calls[2]).toMatchObject({
      url: "https://hooks.slack.com/actions/T07ACME001/1/abc",
      body: { response_type: "ephemeral", text: "Linked." },
      authorization: null,
    });
  });

  it("says what Slack said when it refuses, rather than carrying on", async () => {
    const { chat } = slack({ "chat.postMessage": { ok: false, error: "channel_not_found" } });

    await expect(chat.post("C07GONE", { kind: "gate", gate: openGate })).rejects.toThrow(
      /channel_not_found/,
    );
  });

  it("answers each kind of reply the way Slack reads it", async () => {
    const { chat } = slack();

    expect(await chat.answer({ kind: "none" }).text()).toBe("");
    expect(await chat.answer({ kind: "private", text: "Your code is ABCD-EFGH" }).json()).toEqual({
      response_type: "ephemeral",
      text: "Your code is ABCD-EFGH",
    });
    expect(await chat.answer({ kind: "dialog_error", text: "Say why" }).json()).toEqual({
      response_action: "errors",
      errors: { note: "Say why" },
    });
  });
});
