import { describe, expect, it } from "vite-plus/test";
import { createGitlabSocket } from "../src/gitlab/index.ts";
import labeled from "./fixtures/gitlab/issue.labeled.json" with { type: "json" };
import noted from "./fixtures/gitlab/note.approve.json" with { type: "json" };

/**
 * What a GitLab delivery means, in deevy's terms (ADR-0024).
 *
 * Against recorded payloads and never the network: GitLab's own webhook shapes
 * with the names and ids made up, so a change on GitLab's side is a fixture
 * somebody reads rather than a green suite over a broken integration.
 */
const secret = "deevy-minted-secret-token-for-gitlab";
const now = new Date("2026-09-24T10:21:20Z");

function tracker() {
  const module = createGitlabSocket({
    config: {},
    credentials: {},
    fetch: () => Promise.reject(new Error("no request expected")),
    now: () => now,
  });
  if (!module.tracker) throw new Error("a GitLab Socket is a tracker");
  return module.tracker;
}

/** What GitLab puts on a delivery made with a secret token: the token itself. */
function withToken(token = secret, event = "Issue Hook") {
  return new Headers({
    "x-gitlab-event": event,
    "x-gitlab-token": token,
    "x-gitlab-event-uuid": "0f5d2a9c-1eb7-41f0-9a1f-8f5d0a9c0b21",
    "idempotency-key": "7c2e9b40-3a11-4f58-b6d2-4e0a1c9d8f77",
    "content-type": "application/json",
  });
}

/**
 * What GitLab puts on a delivery made with a signing token: Standard Webhooks'
 * headers, and a signature over the id, the timestamp and the body.
 */
async function withSignature(
  body: string,
  key: Uint8Array<ArrayBuffer>,
  at = now,
  id = "msg_2x9Kf0",
) {
  const timestamp = String(Math.floor(at.getTime() / 1000));
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    imported,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return new Headers({
    "x-gitlab-event": "Issue Hook",
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,bm90LXRoaXMtb25l v1,${signature}`,
    "idempotency-key": id,
    "content-type": "application/json",
  });
}

const signingKey = new Uint8Array(24).map((_, index) => (index * 37 + 11) % 256);
const signingSecret = `whsec_${btoa(String.fromCharCode(...signingKey))}`;

describe("a delivery GitLab made with a secret token", () => {
  it("checks out when the token is the one deevy holds, and says which delivery it is", async () => {
    const rawBody = JSON.stringify(labeled);

    const checked = await tracker().verifyInbound({
      headers: withToken(),
      rawBody,
      webhookSecret: secret,
      now,
    });

    // The key GitLab keeps the same across its retries, which is what makes a
    // redelivery the same delivery.
    expect(checked).toEqual({
      ok: true,
      deliveryId: "7c2e9b40-3a11-4f58-b6d2-4e0a1c9d8f77",
      eventName: "Issue Hook",
    });
  });

  it("does not check out with another token, or with none", async () => {
    const rawBody = JSON.stringify(labeled);
    const noToken = withToken();
    noToken.delete("x-gitlab-token");

    for (const headers of [withToken("somebody-elses-token"), noToken]) {
      expect(
        (await tracker().verifyInbound({ headers, rawBody, webhookSecret: secret, now })).ok,
      ).toBe(false);
    }
  });
});

describe("a delivery GitLab signed with a signing token", () => {
  it("checks out when one of its signatures is over these bytes with the key deevy holds", async () => {
    const rawBody = JSON.stringify(labeled);

    const checked = await tracker().verifyInbound({
      headers: await withSignature(rawBody, signingKey),
      rawBody,
      webhookSecret: signingSecret,
      now,
    });

    expect(checked).toMatchObject({ ok: true, deliveryId: "msg_2x9Kf0" });
  });

  it("does not check out when a byte changed, or when it was signed long ago", async () => {
    const rawBody = JSON.stringify(labeled);
    const headers = await withSignature(rawBody, signingKey);
    const stale = await withSignature(rawBody, signingKey, new Date(now.getTime() - 10 * 60_000));

    expect(
      (
        await tracker().verifyInbound({
          headers,
          rawBody: `${rawBody} `,
          webhookSecret: signingSecret,
          now,
        })
      ).ok,
    ).toBe(false);
    // A signature alone would let anybody who once saw a delivery send it
    // again: the timestamp is inside what is signed, and five minutes is the
    // window Standard Webhooks gives it.
    expect(
      (
        await tracker().verifyInbound({
          headers: stale,
          rawBody,
          webhookSecret: signingSecret,
          now,
        })
      ).ok,
    ).toBe(false);
  });
});

describe("an issue, as deevy projects it", () => {
  it("is GitLab's own reference, URL, words and labels, in the project it belongs to", () => {
    const [event] = tracker().normalize("Issue Hook", labeled);

    expect(event).toEqual({
      kind: "issue",
      // The project's id rather than its path: a path changes when a project
      // is renamed or moved to another group, and a binding should not.
      scopeKey: "4211",
      issue: {
        externalId: "88104233",
        key: "acme/deevy#42",
        url: "https://gitlab.com/acme/deevy/-/issues/42",
        title: "Checkout totals are wrong with a coupon",
        body: "A 10% coupon on a basket under the minimum takes the total below zero.",
        state: "open",
        stateName: "open",
        assignees: [],
        labels: ["bug", "agent:planner"],
        parentExternalId: null,
        updatedAt: new Date("2026-09-24T09:14:05Z"),
      },
      // GitLab redacts a user's address in a webhook, so none is claimed.
      actor: { login: "grace", id: "2931", isBot: false },
    });
  });

  it("is closed when GitLab closed it, with whoever it is assigned to", () => {
    const closed = {
      ...labeled,
      object_attributes: { ...labeled.object_attributes, state: "closed", action: "close" },
      assignees: [{ id: 1044, name: "Ada Lovelace", username: "ada" }],
    };

    const [event] = tracker().normalize("Issue Hook", closed);

    expect(event).toMatchObject({
      issue: { state: "closed", stateName: "closed", assignees: [{ login: "ada", id: "1044" }] },
    });
  });

  it("is read the same from a confidential issue, which GitLab sends only where it was asked to", () => {
    const [event] = tracker().normalize("Confidential Issue Hook", {
      ...labeled,
      event_type: "confidential_issue",
    });

    expect(event).toMatchObject({ kind: "issue", issue: { key: "acme/deevy#42" } });
  });

  it("names a project or group access token's bot as a machine", () => {
    const byBot = {
      ...labeled,
      user: { id: 7001, name: "deevy", username: "project_4211_bot_5f2c0e7a1b" },
    };

    const [event] = tracker().normalize("Issue Hook", byBot);

    expect(event).toMatchObject({ actor: { login: "project_4211_bot_5f2c0e7a1b", isBot: true } });
  });
});

describe("a comment", () => {
  it("whose first line is /approve is a Ruling, with the rest as its note", () => {
    const [event] = tracker().normalize("Note Hook", noted);

    expect(event).toEqual({
      kind: "ruling",
      scopeKey: "4211",
      issueExternalId: "88104233",
      comment: {
        externalId: "1990442711",
        url: "https://gitlab.com/acme/deevy/-/issues/42#note_1990442711",
        body: "/approve cap it at the basket total\nand say so in the changelog",
        author: { login: "grace", id: "2931", isBot: false },
        createdAt: new Date("2026-09-24T10:21:17Z"),
      },
      decision: "approved",
      note: "cap it at the basket total\nand say so in the changelog",
    });
  });

  it("that says anything else is a comment", () => {
    const plain = {
      ...noted,
      object_attributes: { ...noted.object_attributes, note: "Is this the spring coupon?" },
    };

    expect(tracker().normalize("Note Hook", plain)).toMatchObject([
      { kind: "comment", issueExternalId: "88104233" },
    ]);
  });

  it("means nothing when it was edited, written by GitLab itself, or is on a merge request", () => {
    const edited = {
      ...noted,
      object_attributes: { ...noted.object_attributes, action: "update" },
    };
    const system = { ...noted, object_attributes: { ...noted.object_attributes, system: true } };
    const onMerge = {
      ...noted,
      object_attributes: { ...noted.object_attributes, noteable_type: "MergeRequest" },
    };

    for (const payload of [edited, system, onMerge]) {
      expect(tracker().normalize("Note Hook", payload)).toMatchObject([{ kind: "ignored" }]);
    }
  });
});

describe("everything else GitLab says", () => {
  it("is a delivery deevy says nothing about, and says why", () => {
    expect(tracker().normalize("Push Hook", { object_kind: "push" })).toMatchObject([
      { kind: "ignored", why: expect.stringContaining("push") },
    ]);
  });
});
