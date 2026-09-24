import { describe, expect, it } from "vite-plus/test";
import { createLinearSocket } from "../src/linear/index.ts";
import created from "./fixtures/linear/Issue.create.json" with { type: "json" };
import updated from "./fixtures/linear/Issue.update.json" with { type: "json" };
import commented from "./fixtures/linear/Comment.create.json" with { type: "json" };

/**
 * What a Linear delivery means, in deevy's terms (ADR-0024).
 *
 * Against recorded payloads and never the network, as GitHub's are: the
 * fixtures are Linear's own webhook shapes with the names and ids made up, so
 * a change on Linear's side is a fixture somebody reads rather than a green
 * suite over a broken integration.
 */
const secret = "lin_wh_the_app_and_deevy_share_this";
const TEAM = "e4f5a6b7-8c9d-4e0f-a1b2-c3d4e5f6a7b8";
const GRACE = "5a1b7c3e-9d24-4f60-8e1a-2b3c4d5e6f70";

function tracker(now = new Date(created.webhookTimestamp + 2_000)) {
  const module = createLinearSocket({
    config: { organizationId: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" },
    credentials: {},
    fetch: () => Promise.reject(new Error("no request expected")),
    now: () => now,
  });
  if (!module.tracker) throw new Error("a Linear Socket is a tracker");
  return module.tracker;
}

/** What Linear puts on a delivery: a hex HMAC over the raw body, and the delivery's id. */
async function signed(body: string, event = "Issue", over = secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(over),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Headers({
    "linear-event": event,
    "linear-delivery": "8a1f0b98-1eb7-41f0-9a1f-8f5d0a9c0b21",
    "linear-signature": hex,
    "content-type": "application/json; charset=utf-8",
  });
}

describe("a delivery Linear signed", () => {
  it("checks out, and says which delivery and which event it is", async () => {
    const rawBody = JSON.stringify(created);

    const checked = await tracker().verifyInbound({
      headers: await signed(rawBody),
      rawBody,
      webhookSecret: secret,
      now: new Date(created.webhookTimestamp + 2_000),
    });

    expect(checked).toEqual({
      ok: true,
      deliveryId: "8a1f0b98-1eb7-41f0-9a1f-8f5d0a9c0b21",
      eventName: "Issue",
    });
  });

  it("does not check out when a byte, the secret or the signature changed", async () => {
    const rawBody = JSON.stringify(created);
    const headers = await signed(rawBody);
    const now = new Date(created.webhookTimestamp + 2_000);

    expect(
      (
        await tracker().verifyInbound({
          headers,
          rawBody: `${rawBody} `,
          webhookSecret: secret,
          now,
        })
      ).ok,
    ).toBe(false);
    expect(
      (await tracker().verifyInbound({ headers, rawBody, webhookSecret: "another-secret", now }))
        .ok,
    ).toBe(false);
    headers.set("linear-signature", "deadbeef");
    expect(
      (await tracker().verifyInbound({ headers, rawBody, webhookSecret: secret, now })).ok,
    ).toBe(false);
  });

  it("does not check out when it was sent more than a minute before it arrived", async () => {
    // Linear signs the moment it sent a delivery inside the body, and says to
    // refuse one older than a minute: a signature alone would let anybody who
    // once saw a delivery send it again.
    const rawBody = JSON.stringify(created);
    const headers = await signed(rawBody);

    const late = await tracker().verifyInbound({
      headers,
      rawBody,
      webhookSecret: secret,
      now: new Date(created.webhookTimestamp + 61_000),
    });
    const unstamped = JSON.stringify({ ...created, webhookTimestamp: undefined });
    const noStamp = await tracker().verifyInbound({
      headers: await signed(unstamped),
      rawBody: unstamped,
      webhookSecret: secret,
      now: new Date(created.webhookTimestamp),
    });

    expect(late.ok).toBe(false);
    expect(noStamp.ok).toBe(false);
  });
});

describe("an issue, as deevy projects it", () => {
  it("is Linear's own key, URL, words and labels, in the team it belongs to", () => {
    const [event] = tracker().normalize("Issue", created);

    expect(event).toEqual({
      kind: "issue",
      scopeKey: TEAM,
      issue: {
        externalId: "0b6e2f4a-3c1d-4e8b-9a7f-5d2c1b0a9e81",
        key: "ENG-12",
        url: "https://linear.app/acme/issue/ENG-12/checkout-totals-are-wrong-with-a-coupon",
        title: "Checkout totals are wrong with a coupon",
        body: "A 10% coupon on a basket under the minimum takes the total below zero.\n\nSeen on staging.",
        state: "open",
        stateName: "Todo",
        assignees: [],
        // By name, which is what an admin wrote a routing prefix against.
        labels: ["Bug", "agent:planner"],
        parentExternalId: null,
        delegateId: null,
        updatedAt: new Date("2026-09-24T09:14:05.311Z"),
      },
      actor: { login: "Grace Hopper", id: GRACE, isBot: false, email: "grace@example.com" },
    });
  });

  it("is closed in a completed state, with its parent, its assignee and its delegate", () => {
    const [event] = tracker().normalize("Issue", updated);

    expect(event).toMatchObject({
      kind: "issue",
      issue: {
        state: "closed",
        stateName: "Done",
        assignees: [{ login: "Grace Hopper", id: GRACE }],
        parentExternalId: "7e6d5c4b-3a29-4180-b7c6-d5e4f3a2b1c0",
        delegateId: "2f4e6a8c-0b1d-4e3f-a5b7-c9d1e3f5a7b9",
      },
    });
  });

  it("is closed in a canceled state too, which Linear counts as finished", () => {
    const canceled = {
      ...updated,
      data: {
        ...updated.data,
        state: { ...updated.data.state, name: "Won't do", type: "canceled" },
      },
    };

    const [event] = tracker().normalize("Issue", canceled);

    expect(event).toMatchObject({ issue: { state: "closed", stateName: "Won't do" } });
  });

  it("is open in every other kind of state, whatever the team named it", () => {
    for (const type of ["triage", "backlog", "unstarted", "started"]) {
      const moved = {
        ...updated,
        data: { ...updated.data, state: { ...updated.data.state, name: "In Review", type } },
      };
      expect(tracker().normalize("Issue", moved)).toMatchObject([
        { issue: { state: "open", stateName: "In Review" } },
      ]);
    }
  });

  it("is closed when it is deleted, so nothing goes on working a record that is gone", () => {
    const [event] = tracker().normalize("Issue", { ...created, action: "remove" });

    expect(event).toMatchObject({
      kind: "issue",
      issue: { state: "closed", stateName: "Deleted" },
    });
  });

  it("names the app or integration that changed it as a machine", () => {
    const byApp = {
      ...created,
      actor: { id: "2f4e6a8c-0b1d-4e3f-a5b7-c9d1e3f5a7b9", type: "OauthClient", name: "deevy" },
    };

    const [event] = tracker().normalize("Issue", byApp);

    expect(event).toMatchObject({ actor: { login: "deevy", isBot: true } });
  });
});

describe("a comment", () => {
  it("whose first line is /approve is a Ruling, with the rest as its note", () => {
    const [event] = tracker().normalize("Comment", commented);

    expect(event).toEqual({
      kind: "ruling",
      scopeKey: TEAM,
      issueExternalId: "0b6e2f4a-3c1d-4e8b-9a7f-5d2c1b0a9e81",
      comment: {
        externalId: "b3a2c1d0-e9f8-4a7b-8c6d-5e4f3a2b1c0d",
        url: "https://linear.app/acme/issue/ENG-12/checkout-totals-are-wrong-with-a-coupon#comment-b3a2c1d0",
        body: "/approve cap it at the basket total\nand say so in the changelog",
        author: { login: "Grace Hopper", id: GRACE, isBot: false, email: "grace@example.com" },
        createdAt: new Date("2026-09-24T10:21:17.902Z"),
      },
      decision: "approved",
      note: "cap it at the basket total\nand say so in the changelog",
    });
  });

  it("that says anything else is a comment", () => {
    const plain = {
      ...commented,
      data: { ...commented.data, body: "Is this the coupon from the spring sale?" },
    };

    expect(tracker().normalize("Comment", plain)).toMatchObject([
      { kind: "comment", issueExternalId: "0b6e2f4a-3c1d-4e8b-9a7f-5d2c1b0a9e81" },
    ]);
  });

  it("by an app is a machine's, which is what keeps deevy's own quoted words from ruling", () => {
    const byApp = {
      ...commented,
      actor: { id: "2f4e6a8c-0b1d-4e3f-a5b7-c9d1e3f5a7b9", type: "OauthClient", name: "deevy" },
      data: {
        ...commented.data,
        userId: "2f4e6a8c-0b1d-4e3f-a5b7-c9d1e3f5a7b9",
        user: null,
        botActor: { id: "c1b2a3d4", type: "oauthClient", name: "deevy" },
      },
    };

    const [event] = tracker().normalize("Comment", byApp);

    expect(event).toMatchObject({
      comment: { author: { id: "2f4e6a8c-0b1d-4e3f-a5b7-c9d1e3f5a7b9", isBot: true } },
    });
  });

  it("that was edited or removed means nothing: deevy acts on what was said first", () => {
    for (const action of ["update", "remove"]) {
      expect(tracker().normalize("Comment", { ...commented, action })).toMatchObject([
        { kind: "ignored" },
      ]);
    }
  });
});

describe("everything else Linear says", () => {
  it("is a delivery deevy says nothing about, and says why", () => {
    expect(tracker().normalize("Reaction", { ...commented, type: "Reaction" })).toMatchObject([
      { kind: "ignored", why: expect.stringContaining("Reaction") },
    ]);
    expect(
      tracker().normalize("OAuthApp", { action: "revoked", type: "OAuthApp", oauthClientId: "x" }),
    ).toMatchObject([{ kind: "ignored", why: expect.stringContaining("revoked") }]);
  });
});
