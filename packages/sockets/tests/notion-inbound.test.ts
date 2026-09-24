import { describe, expect, it } from "vite-plus/test";
import { createNotionSocket } from "../src/notion/index.ts";
import changed from "./fixtures/notion/page.properties_updated.json" with { type: "json" };
import commented from "./fixtures/notion/comment.created.json" with { type: "json" };

/**
 * What a Notion delivery means, in deevy's terms (ADR-0024).
 *
 * Notion's webhooks name what changed and carry none of it, so what a delivery
 * means here is which record or comment to read back — the reading is the
 * API's half (`notion-api.test.ts`). Against Notion's documented shapes with
 * the ids made up, and never the network.
 */
const secret = "secret_notion-verification-token-for-tests";
const DATA_SOURCE = "248104cd-477e-80fd-b757-000b4bb3bda2";
const PAGE = "27a104cd-477e-80a1-9c3d-e5f6a7b8c901";
const GRACE = "c7c11cca-1d73-471d-9b6e-bdef51470190";

function tracker() {
  const module = createNotionSocket({
    config: {},
    credentials: {},
    fetch: () => Promise.reject(new Error("no request expected")),
    now: () => new Date("2026-09-24T09:14:06Z"),
  });
  if (!module.tracker) throw new Error("a Notion Socket is a tracker");
  return module.tracker;
}

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
  return new Headers({ "x-notion-signature": `sha256=${hex}`, "content-type": "application/json" });
}

describe("the token Notion sends to verify a webhook", () => {
  it("is taken from the one unsigned request that carries it, and from nothing else", () => {
    expect(tracker().handshake?.(JSON.stringify({ verification_token: secret }))).toBe(secret);
    expect(tracker().handshake?.(JSON.stringify(changed))).toBeNull();
    expect(tracker().handshake?.("not json")).toBeNull();
  });
});

describe("a delivery Notion signed", () => {
  it("checks out with that token, and is named by the event's own id", async () => {
    const rawBody = JSON.stringify(changed);

    const checked = await tracker().verifyInbound({
      headers: await signed(rawBody),
      rawBody,
      webhookSecret: secret,
    });

    // The event's id, which Notion keeps across its eight attempts.
    expect(checked).toEqual({
      ok: true,
      deliveryId: "5e8c3a1f-7b2d-4c9e-a0f1-3d6b8e2c4a71",
      eventName: "page.properties_updated",
    });
  });

  it("does not check out when a byte, the token or the signature changed", async () => {
    const rawBody = JSON.stringify(changed);
    const headers = await signed(rawBody);
    const unsigned = new Headers({ "content-type": "application/json" });

    for (const [body, key, sent] of [
      [`${rawBody} `, secret, headers],
      [rawBody, "secret_somebody_else", headers],
      [rawBody, secret, unsigned],
    ] as const) {
      expect(
        (await tracker().verifyInbound({ headers: sent, rawBody: body, webhookSecret: key })).ok,
      ).toBe(false);
    }
  });
});

describe("a page that changed", () => {
  it("is a record to read back, in the data source it is a row of", () => {
    expect(tracker().normalize("page.properties_updated", changed)).toEqual([
      {
        kind: "changed",
        scopeKey: DATA_SOURCE,
        issueExternalId: PAGE,
        // Notion names who, and nothing about them: the name is read with the page.
        actor: { login: "", id: GRACE, isBot: false },
      },
    ]);
  });

  it("is read back whether it was made, edited, moved, deleted or restored", () => {
    for (const type of [
      "page.created",
      "page.content_updated",
      "page.moved",
      "page.deleted",
      "page.undeleted",
    ]) {
      expect(tracker().normalize(type, { ...changed, type })).toMatchObject([
        { kind: "changed", issueExternalId: PAGE },
      ]);
    }
  });

  it("is in its database, where a webhook made for an older API names no data source", () => {
    const older = {
      ...changed,
      data: {
        ...changed.data,
        parent: { id: "248104cd-477e-80af-bc30-000bd72bee7f", type: "database" },
      },
    };

    expect(tracker().normalize("page.properties_updated", older)).toMatchObject([
      { scopeKey: "248104cd-477e-80af-bc30-000bd72bee7f" },
    ]);
  });

  it("means nothing when it is not a row of a database", () => {
    const loose = { ...changed, data: { parent: { id: PAGE, type: "page" } } };

    expect(tracker().normalize("page.properties_updated", loose)).toMatchObject([
      { kind: "ignored" },
    ]);
  });

  it("names an integration or an agent that changed it as a machine", () => {
    const byBot = { ...changed, authors: [{ id: "2f4e6a8c", type: "bot" }] };

    expect(tracker().normalize("page.properties_updated", byBot)).toMatchObject([
      { actor: { id: "2f4e6a8c", isBot: true } },
    ]);
  });
});

describe("a comment", () => {
  it("is one to read back, on the page it was made on", () => {
    expect(tracker().normalize("comment.created", commented)).toEqual([
      {
        kind: "commented",
        issueExternalId: PAGE,
        commentExternalId: "27b104cd-477e-80ca-8f75-001d9e2b6839",
      },
    ]);
  });

  it("means nothing once it was edited or deleted: deevy acts on what was said first", () => {
    for (const type of ["comment.updated", "comment.deleted"]) {
      expect(tracker().normalize(type, { ...commented, type })).toMatchObject([
        { kind: "ignored" },
      ]);
    }
  });
});

describe("everything else Notion says", () => {
  it("is a delivery deevy says nothing about, and says why", () => {
    expect(
      tracker().normalize("data_source.schema_updated", {
        ...changed,
        type: "data_source.schema_updated",
      }),
    ).toMatchObject([
      { kind: "ignored", why: expect.stringContaining("data_source.schema_updated") },
    ]);
  });
});
