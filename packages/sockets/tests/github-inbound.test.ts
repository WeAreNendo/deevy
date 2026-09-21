import { describe, expect, it } from "vite-plus/test";
import type { InboundEvent } from "@deevy/core/sockets";
import { createGithubSocket } from "../src/github/index.ts";
import labeled from "./fixtures/github/issues.labeled.json" with { type: "json" };
import commented from "./fixtures/github/issue_comment.created.json" with { type: "json" };
import subIssue from "./fixtures/github/sub_issues.added.json" with { type: "json" };
import installed from "./fixtures/github/installation.created.json" with { type: "json" };

/**
 * What a GitHub delivery means, in deevy's terms (ADR-0024).
 *
 * Against recorded payloads and never the network: the fixtures are real
 * deliveries with the names and numbers scrubbed, so a provider changing its
 * shape is a fixture update somebody reads rather than a green suite over a
 * broken integration.
 */
const secret = "whsec_the_app_and_deevy_share_this";

function github(config: Record<string, unknown> = {}) {
  return createGithubSocket({
    config: { appId: "1284461", slug: "deevy", ...config },
    credentials: {},
    fetch: () => Promise.reject(new Error("no request expected")),
    now: () => new Date("2026-09-21T10:00:00Z"),
  });
}

function tracker() {
  const module = github();
  if (!module.tracker) throw new Error("a GitHub Socket is a tracker");
  return module.tracker;
}

/** What GitHub puts on a delivery, signature and all. */
async function signed(body: string, over = secret) {
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
    "x-github-event": "issues",
    "x-github-delivery": "0b989ba4-1eb7-11f0-8a1f-8f5d0a9c0b21",
    "x-hub-signature-256": `sha256=${hex}`,
    "content-type": "application/json",
  });
}

describe("a delivery GitHub signed", () => {
  it("checks out, and says which delivery and which event it is", async () => {
    const rawBody = JSON.stringify(labeled);

    const checked = await tracker().verifyInbound({
      headers: await signed(rawBody),
      rawBody,
      webhookSecret: secret,
    });

    expect(checked).toEqual({
      ok: true,
      deliveryId: "0b989ba4-1eb7-11f0-8a1f-8f5d0a9c0b21",
      eventName: "issues",
    });
  });

  it("does not check out when a byte, the secret or the signature changed", async () => {
    const rawBody = JSON.stringify(labeled);
    const headers = await signed(rawBody);

    expect(
      (await tracker().verifyInbound({ headers, rawBody: `${rawBody} `, webhookSecret: secret }))
        .ok,
    ).toBe(false);
    expect(
      (await tracker().verifyInbound({ headers, rawBody, webhookSecret: "another-secret" })).ok,
    ).toBe(false);
    const unsigned = new Headers({ "x-github-event": "issues", "x-github-delivery": "d1" });
    expect(
      (await tracker().verifyInbound({ headers: unsigned, rawBody, webhookSecret: secret })).ok,
    ).toBe(false);
  });
});

describe("what deevy makes of an `issues` delivery", () => {
  it("is the record as the tracker last said it, with the label that routes it", () => {
    const [event] = tracker().normalize("issues", labeled);

    expect(event).toMatchObject({ kind: "issue", scopeKey: "acme/deevy" });
    const issue = (event as Extract<InboundEvent, { kind: "issue" }>).issue;
    expect(issue).toMatchObject({
      externalId: "I_kwDOMxK7Zs6oF3S9",
      key: "acme/deevy#42",
      url: "https://github.com/acme/deevy/issues/42",
      title: "Checkout totals are wrong with a coupon",
      state: "open",
      stateName: "open",
      labels: ["bug", "agent:planner"],
      parentExternalId: null,
    });
    expect(issue.assignees).toEqual([{ login: "grace-on-github", id: "5829302" }]);
    expect(issue.updatedAt.toISOString()).toBe("2026-09-21T08:31:07.000Z");
    // Who did it there, for the log: deevy knows no Member behind this name.
    expect(event).toMatchObject({
      actor: { login: "ada-on-github", id: "5829301", isBot: false },
    });
  });

  it("reads a closed record as closed, whatever GitHub calls the reason", () => {
    const closed = {
      ...labeled,
      action: "closed",
      issue: {
        ...labeled.issue,
        state: "closed",
        state_reason: "not_planned",
        closed_at: "2026-09-21T09:00:00Z",
      },
    };

    const [event] = tracker().normalize("issues", closed);

    expect((event as Extract<InboundEvent, { kind: "issue" }>).issue).toMatchObject({
      state: "closed",
      stateName: "not_planned",
    });
  });

  it("means nothing by an action that changes no record", () => {
    expect(tracker().normalize("issues", { ...labeled, action: "deleted" })).toEqual([
      { kind: "ignored", why: "an issues delivery deevy does not act on: deleted" },
    ]);
    expect(tracker().normalize("ping", { zen: "Anything added dilutes everything else." })).toEqual(
      [{ kind: "ignored", why: "a ping" }],
    );
  });
});

describe("what deevy makes of a comment", () => {
  it("is who wrote it, what they wrote, and where", () => {
    const [event] = tracker().normalize("issue_comment", commented);

    expect(event).toMatchObject({
      kind: "comment",
      scopeKey: "acme/deevy",
      issueExternalId: "I_kwDOMxK7Zs6oF3S9",
      comment: {
        externalId: "IC_kwDOMxK7Zs6vB2xJ",
        body: "@deevy planner can you take this one?",
        author: { login: "grace-on-github", id: "5829302", isBot: false },
      },
    });
  });

  it("is a Ruling when the first line is one, and says which", () => {
    const approving = {
      ...commented,
      comment: { ...commented.comment, body: "/approve\n\nReads right to me." },
    };
    const rejecting = {
      ...commented,
      comment: { ...commented.comment, body: "/reject the flag has to come first" },
    };

    expect(tracker().normalize("issue_comment", approving)[0]).toMatchObject({
      kind: "ruling",
      decision: "approved",
      note: "Reads right to me.",
    });
    expect(tracker().normalize("issue_comment", rejecting)[0]).toMatchObject({
      kind: "ruling",
      decision: "rejected",
      note: "the flag has to come first",
    });
  });

  it("acts on a comment as it was written, and never on an edit of one", () => {
    expect(tracker().normalize("issue_comment", { ...commented, action: "edited" })).toEqual([
      // A repository admin can edit anybody's comment, deevy's own included:
      // what was said is what was said (docs/plans/sockets.md, risks).
      { kind: "ignored", why: "an issue_comment delivery deevy does not act on: edited" },
    ]);
  });
});

describe("what deevy makes of the rest", () => {
  it("keeps a sub-issue's parent, which is the tree GitHub does know", () => {
    const [event] = tracker().normalize("sub_issues", subIssue);

    const issue = (event as Extract<InboundEvent, { kind: "issue" }>).issue;
    expect(issue).toMatchObject({
      externalId: "I_kwDOMxK7Zs6oF3TX",
      key: "acme/deevy#43",
      parentExternalId: "I_kwDOMxK7Zs6oF3S9",
    });
  });

  it("records where the App was installed", () => {
    expect(tracker().normalize("installation", installed)).toEqual([
      { kind: "installation", installations: [{ id: "61892041", account: "acme" }] },
    ]);
  });
});
