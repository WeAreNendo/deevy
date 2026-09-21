import { describe, expect, it } from "vite-plus/test";
import { gateUrl, resolveGateRef } from "../src/gates.ts";

/**
 * `deevy gates open` (docs/plans/sockets.md, slice 3).
 *
 * The one thing a terminal can do about a Gate is put it in front of a Human:
 * ruling happens in deevy's own browser and nowhere else (ADR-0004, ADR-0010).
 * So the verb is `open`, and what it takes is whatever somebody has to hand —
 * the request id from a notification, or the tracker's key from the record
 * they were just looking at.
 */
describe("what `gates open` takes", () => {
  it("is a request id, used as it stands", async () => {
    const asked: string[] = [];
    const client = {
      gates: {
        list: async (input: { issueId?: string }) => {
          asked.push(input.issueId ?? "");
          return { gates: [] };
        },
      },
      issues: { get: async () => ({ id: "iss_1" }) },
    };

    expect(await resolveGateRef(client as never, "gate_abc123def456")).toBe("gate_abc123def456");
    // Nothing was asked: an id needs no lookup, which is what makes the link
    // in a notification work offline from the rest of the CLI.
    expect(asked).toEqual([]);
  });

  it("is a record's key, resolved to the Gate waiting on it", async () => {
    const client = {
      gates: {
        list: async () => ({
          gates: [
            { id: "gate_older00000", status: "open", askedAt: new Date("2026-09-19T09:00:00Z") },
            { id: "gate_newer00000", status: "open", askedAt: new Date("2026-09-20T09:00:00Z") },
          ],
        }),
      },
      issues: { get: async () => ({ id: "iss_1" }) },
    };

    // The one that is still waiting, and the newest of those: a record that
    // has been through two visits has one question open.
    expect(await resolveGateRef(client as never, "acme/deevy#42")).toBe("gate_newer00000");
  });

  it("says so when nothing is waiting there, rather than opening a page that is not one", async () => {
    const client = {
      gates: { list: async () => ({ gates: [] }) },
      issues: { get: async () => ({ id: "iss_1" }) },
    };

    await expect(resolveGateRef(client as never, "acme/deevy#42")).rejects.toThrow(
      /no Gate waiting/i,
    );
  });
});

describe("where it sends them", () => {
  it("is the ruling screen on the instance they named", () => {
    expect(gateUrl("https://deevy.example.com/", "gate_abc123def456")).toBe(
      "https://deevy.example.com/gates/gate_abc123def456",
    );
  });
});
