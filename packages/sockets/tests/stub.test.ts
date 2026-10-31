import { describe, expect, it } from "vite-plus/test";
import type { InboundEvent } from "@deevy/core/sockets";
import {
  addContainer,
  devTrackerView,
  openDevStubStore,
  createStubSocket,
  openStubStore,
  putIssue,
  resetStubStores,
  signDelivery,
} from "../src/stub/index.ts";

/**
 * The stub is what every rule about inbound, routing and the comments that
 * announce a Gate is proved against (docs/plans/sockets.md), so the half of it
 * deevy relies on is worth holding: a delivery it signs is one deevy verifies,
 * a record it is given is one it hands back, and what deevy says on a record
 * is there to read.
 */

const secret = "stub-secret-nobody-else-holds";

function socketFor(storeId: string) {
  return createStubSocket({
    config: { storeId },
    credentials: {},
    fetch: globalThis.fetch,
    now: () => new Date("2026-09-21T10:00:00Z"),
  });
}

describe("what the stub signs", () => {
  it("is what it verifies, and a body changed by one byte is not", async () => {
    resetStubStores();
    const module = socketFor("signing");
    const tracker = module.tracker;
    if (!tracker) throw new Error("the stub is a tracker");

    const events: InboundEvent[] = [{ kind: "ignored", why: "nothing happened" }];
    const delivery = await signDelivery(secret, events, { deliveryId: "d1" });

    const good = await tracker.verifyInbound({
      headers: new Headers(delivery.headers),
      rawBody: delivery.body,
      webhookSecret: secret,
    });
    expect(good).toMatchObject({ ok: true, deliveryId: "d1" });

    // The signature is over the raw body, which is the whole of the trust.
    const tampered = await tracker.verifyInbound({
      headers: new Headers(delivery.headers),
      rawBody: `${delivery.body} `,
      webhookSecret: secret,
    });
    expect(tampered.ok).toBe(false);

    // And a receiver holding the wrong secret is refused rather than throwing.
    const wrong = await tracker.verifyInbound({
      headers: new Headers(delivery.headers),
      rawBody: delivery.body,
      webhookSecret: "some-other-secret",
    });
    expect(wrong.ok).toBe(false);
  });

  it("carries its events through `normalize` verbatim", () => {
    resetStubStores();
    const tracker = socketFor("normalizing").tracker;
    if (!tracker) throw new Error("the stub is a tracker");

    const events: InboundEvent[] = [{ kind: "ignored", why: "a ping" }];
    expect(tracker.normalize("events", { events })).toEqual(events);
    // A body that is not a delivery means nothing rather than throwing.
    expect(tracker.normalize("events", null)).toEqual([]);
    expect(tracker.normalize("events", { events: "not a list" })).toEqual([]);
  });

  it("gives a delivery its clocks back, because JSON has none", () => {
    resetStubStores();
    const tracker = socketFor("clocks").tracker;
    if (!tracker) throw new Error("the stub is a tracker");
    const updatedAt = new Date("2026-09-23T10:00:00Z");

    // What a delivery carries is what `JSON.parse` left behind: a string where
    // a provider's own `normalize` answers a Date. The core compares that clock
    // to decide a reordered delivery and writes it to an integer column, so a
    // string reaches `getTime` and throws on the first record deevy is told
    // about (packages/core/src/issues.ts).
    const [event] = tracker.normalize("events", {
      events: [
        {
          kind: "issue",
          scopeKey: "acme/deevy",
          actor: null,
          issue: { externalId: "1", updatedAt: updatedAt.toISOString() },
        },
      ],
    });

    expect(event).toMatchObject({ kind: "issue", issue: { updatedAt } });
  });
});

describe("the tracker it plays", () => {
  it("hands back the record it was given", async () => {
    resetStubStores();
    const store = openStubStore({ id: "tracking" });
    addContainer(store, { scopeKey: "acme/deevy" });
    const container = store.containers.get("acme/deevy");
    if (!container) throw new Error("the container was just added");
    putIssue(container, { externalId: "1", title: "Checkout rewrite" });

    const tracker = socketFor("tracking").tracker;
    if (!tracker) throw new Error("the stub is a tracker");
    const scope = { scopeKey: "acme/deevy" };

    const read = await tracker.getIssue?.(scope, {
      externalId: "1",
      url: "https://stub.invalid/acme/deevy/1",
    });
    expect(read).toMatchObject({ title: "Checkout rewrite", state: "open" });
  });

  it("writes a comment as itself, which is what the loop guard drops", async () => {
    resetStubStores();
    const store = openStubStore({ id: "commenting", login: "deevy" });
    addContainer(store, { scopeKey: "acme/deevy" });
    const container = store.containers.get("acme/deevy");
    if (!container) throw new Error("the container was just added");
    putIssue(container, { externalId: "1" });

    const tracker = socketFor("commenting").tracker;
    if (!tracker) throw new Error("the stub is a tracker");
    const ref = { externalId: "1", url: "https://stub.invalid/acme/deevy/1" };

    await tracker.createComment({ scopeKey: "acme/deevy" }, ref, "**Waiting on a ruling**");
    const [comment] = container.comments.get("1") ?? [];

    // A comment deevy wrote comes back with deevy as its author, and that is
    // the only thing standing between an announcement and a loop (ADR-0025).
    expect(comment?.author).toMatchObject({ login: "deevy", isBot: true });
  });
});

describe("what a deployment says it holds", () => {
  it("is container names, and still starts from a spec that gave a repository as well", () => {
    resetStubStores();
    // `name=…` once gave the container a repository a Run could clone. deevy
    // holds no code now (ADR-0034), and a deployment configured the old way
    // still starts, with the containers it named.
    const store = openDevStubStore("acme/deevy=/tmp/origin.git, acme/ops", "spec");

    expect([...store.containers.keys()]).toEqual(["acme/deevy", "acme/ops"]);
  });
});

describe("what a walk outside the process reads", () => {
  it("is each container's records, with what deevy said on each under it", async () => {
    resetStubStores();
    const store = openStubStore({ id: "viewed" });
    const container = addContainer(store, { scopeKey: "acme/deevy" });
    putIssue(container, { externalId: "1", title: "Checkout rewrite" });
    const tracker = socketFor("viewed").tracker;
    if (!tracker) throw new Error("the stub is a tracker");

    await tracker.createComment(
      { scopeKey: "acme/deevy" },
      { externalId: "1", url: "https://stub.invalid/acme/deevy/1" },
      "**Waiting on a ruling**",
    );

    expect(devTrackerView("viewed")).toEqual({
      containers: [
        {
          scopeKey: "acme/deevy",
          name: "acme/deevy",
          issues: [expect.objectContaining({ externalId: "1", title: "Checkout rewrite" })],
          comments: {
            "1": [
              expect.objectContaining({
                body: "**Waiting on a ruling**",
                author: expect.objectContaining({ login: "deevy", isBot: true }),
              }),
            ],
          },
        },
      ],
    });
  });

  it("is nothing for a store nobody opened, and opens none", () => {
    resetStubStores();

    expect(devTrackerView("never-opened")).toEqual({ containers: [] });
    // Had the view made the store, this would find that one, signed as deevy.
    expect(openStubStore({ id: "never-opened", login: "someone" }).identity.login).toBe("someone");
  });
});
