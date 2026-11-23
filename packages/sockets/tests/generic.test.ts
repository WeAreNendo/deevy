import { createHmac } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { createGenericSocket, signDelivery } from "../src/generic/index.ts";

/**
 * The generic Socket: any tool, through deevy's own format (docs/plans/simplify.md,
 * slice 7). Whoever sends it is an adapter somebody wrote — a script, an n8n
 * flow — so the format is a public one, and what is held here is the half an
 * adapter's author reads on `tools/generic`: how a delivery is signed, what an
 * event must carry, and what deevy does with one that is not that.
 */

const secret = "whsec_generic_secret_nobody_else_holds";
const clock = new Date("2026-11-01T10:00:00Z");

function tracker() {
  const module = createGenericSocket({
    config: {},
    credentials: {},
    fetch: () => Promise.reject(new Error("the generic Socket asks nothing of the network")),
    now: () => clock,
  });
  if (!module.tracker) throw new Error("the generic Socket is a tracker");
  return { module, tracker: module.tracker };
}

/** A record as an adapter states one: everything deevy projects, as JSON has it. */
function record(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "10042",
    key: "OPS-12",
    url: "https://tracker.example/browse/OPS-12",
    title: "Rotate the staging certificate",
    state: "open",
    labels: ["agent:planner"],
    updatedAt: "2026-11-01T09:59:00.000Z",
    ...overrides,
  };
}

describe("a generic delivery", () => {
  it("is signed the way deevy signs its own webhooks, so one routine does both", async () => {
    const { tracker: generic } = tracker();
    const body = JSON.stringify({ events: [] });
    const t = Math.floor(clock.getTime() / 1000);
    // Written out, as an adapter would: HMAC-SHA256 of `<t>.<body>`, in hex.
    const v1 = createHmac("sha256", secret)
      .update(`${String(t)}.${body}`)
      .digest("hex");

    const checked = await generic.verifyInbound({
      headers: new Headers({
        "deevy-signature": `t=${String(t)},v1=${v1}`,
        "deevy-delivery": "n8n-execution-81",
        "deevy-event": "issue_updated",
      }),
      rawBody: body,
      webhookSecret: secret,
      now: clock,
    });

    expect(checked).toEqual({
      ok: true,
      deliveryId: "n8n-execution-81",
      eventName: "issue_updated",
    });
  });

  it("is refused when a byte changed, the secret is another, or it is older than five minutes", async () => {
    const { tracker: generic } = tracker();
    const delivery = await signDelivery(secret, [], { deliveryId: "d1", now: clock });
    const headers = new Headers(delivery.headers);

    const verify = (rawBody: string, webhookSecret: string, now: Date) =>
      generic.verifyInbound({ headers, rawBody, webhookSecret, now });

    expect((await verify(delivery.body, secret, clock)).ok).toBe(true);
    expect((await verify(`${delivery.body} `, secret, clock)).ok).toBe(false);
    expect((await verify(delivery.body, "whsec_somebody_elses", clock)).ok).toBe(false);
    // The timestamp is inside what is signed, so a captured POST cannot be
    // sent again later under a delivery id of its sender's choosing.
    const later = new Date(clock.getTime() + 6 * 60_000);
    expect((await verify(delivery.body, secret, later)).ok).toBe(false);
    // And a delivery with no signature at all is an answer, not an exception.
    const bare = await generic.verifyInbound({
      headers: new Headers(),
      rawBody: delivery.body,
      webhookSecret: secret,
      now: clock,
    });
    expect(bare.ok).toBe(false);
  });

  it("names itself `events` when the sender gives it no name", async () => {
    const { tracker: generic } = tracker();
    const delivery = await signDelivery(secret, [], { deliveryId: "d2", now: clock });
    const headers = new Headers(delivery.headers);
    headers.delete("deevy-event");

    const checked = await generic.verifyInbound({
      headers,
      rawBody: delivery.body,
      webhookSecret: secret,
      now: clock,
    });

    expect(checked).toMatchObject({ ok: true, eventName: "events" });
  });

  it("has no id when its id is empty, so it is not taken for the repeat of one that had none", async () => {
    const { tracker: generic } = tracker();
    const delivery = await signDelivery(secret, [], { deliveryId: "", now: clock });

    const checked = await generic.verifyInbound({
      headers: new Headers(delivery.headers),
      rawBody: delivery.body,
      webhookSecret: secret,
      now: clock,
    });

    expect(checked).toMatchObject({ ok: true, deliveryId: null });
  });
});

describe("what a generic delivery means", () => {
  it("is each record it states whole, with the clock JSON took away given back", () => {
    const { tracker: generic } = tracker();

    const [event] = generic.normalize("events", {
      events: [{ kind: "issue", scopeKey: "OPS", issue: record() }],
    });

    expect(event).toEqual({
      kind: "issue",
      scopeKey: "OPS",
      actor: null,
      issue: {
        externalId: "10042",
        key: "OPS-12",
        url: "https://tracker.example/browse/OPS-12",
        title: "Rotate the staging certificate",
        state: "open",
        // What the tool calls its state, where the adapter says nothing more.
        stateName: "open",
        assignees: [],
        labels: ["agent:planner"],
        parentExternalId: null,
        updatedAt: new Date("2026-11-01T09:59:00.000Z"),
      },
    });
  });

  it("is a comment with its author, and a first line of /approve is a Ruling to refuse", () => {
    const { tracker: generic } = tracker();
    const comment = (body: string) => ({
      externalId: `c-${body.length}`,
      url: "https://tracker.example/browse/OPS-12#comment-1",
      body,
      author: { login: "grace", id: "u-77" },
      createdAt: "2026-11-01T09:59:30.000Z",
    });

    const events = generic.normalize("events", {
      events: [
        { kind: "comment", issueExternalId: "10042", comment: comment("@planner have a look") },
        { kind: "comment", issueExternalId: "10042", comment: comment("/approve ship it") },
      ],
    });

    expect(events).toEqual([
      {
        kind: "comment",
        scopeKey: "",
        issueExternalId: "10042",
        comment: expect.objectContaining({
          body: "@planner have a look",
          author: { login: "grace", id: "u-77", isBot: false },
          createdAt: new Date("2026-11-01T09:59:30.000Z"),
        }),
      },
      // Read as every tracker reads it (`parseRulingCommand`), so the core can
      // answer that it ruled nothing rather than take it for chatter.
      expect.objectContaining({
        kind: "ruling",
        issueExternalId: "10042",
        decision: "approved",
        note: "ship it",
      }),
    ]);
  });

  it("says what is wrong with an event it cannot take, and takes the rest", () => {
    const { tracker: generic } = tracker();

    const events = generic.normalize("events", {
      events: [
        { kind: "issue", scopeKey: "OPS", issue: record({ url: "not a link" }) },
        { kind: "issue", scopeKey: "OPS", issue: record({ externalId: "10043" }) },
        { kind: "installation", installations: [] },
      ],
    });

    expect(events).toEqual([
      { kind: "ignored", why: expect.stringMatching(/^Event 1 \(issue\).*issue\.url/) },
      expect.objectContaining({
        kind: "issue",
        issue: expect.objectContaining({ externalId: "10043" }),
      }),
      {
        kind: "ignored",
        why: expect.stringMatching(/^Event 3 is `installation`.*issue, comment and ruling/),
      },
    ]);
  });

  it("is one sentence for a body that carries no list of events", () => {
    const { tracker: generic } = tracker();

    for (const body of [null, {}, { events: "not a list" }]) {
      expect(generic.normalize("events", body)).toEqual([
        { kind: "ignored", why: expect.stringContaining('{"events": [...]}') },
      ]);
    }
  });
});

describe("the generic Socket", () => {
  it("is a tracker deevy mints the secret for, that vouches for nobody, and says nothing back", async () => {
    const { module, tracker: generic } = tracker();

    expect(module.provider).toBe("generic");
    expect([...module.capabilities]).toEqual(["tracker"]);
    expect(module.webhookSecretFrom).toBe("deevy");
    // Whoever holds the secret writes the delivery, which is not the tool
    // saying whose account ruled (ADR-0025).
    expect(module.vouches).toBe(false);
    expect(module.walked).toBe(true);
    // Nothing to list and nothing to read back: an admin types the container,
    // and every event carries what it is about whole.
    expect("listContainers" in generic).toBe(false);
    expect("getIssue" in generic).toBe(false);
    expect(await module.identity()).toEqual({
      login: "deevy",
      id: "deevy",
      mentionHandle: "@deevy",
    });

    // What deevy would announce reaches the adapter as the Gate's own Events,
    // on the Workspace's webhooks, so the comment itself is nothing.
    expect(
      await generic.createComment(
        { scopeKey: "OPS" },
        { externalId: "10042", url: "https://tracker.example/browse/OPS-12" },
        "**Waiting on a ruling**",
      ),
    ).toBeNull();
  });
});
