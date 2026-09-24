import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

/**
 * Home is what needs you (docs/plans/sockets.md, slice 3).
 *
 * deevy is not where the work is any more, so the front page is not a list of
 * work: it is the two things a Human has to come here for — a Gate waiting on
 * their ruling and a Run waiting on their answer — and then what their Agents
 * are doing. The order is the point: a ruling blocks somebody, an answer
 * blocks something, and the rest is news.
 */
const state = vi.hoisted(() => ({ gates: [] as unknown[], runs: [] as unknown[] }));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    gates: { list: async () => ({ gates: state.gates }) },
    runs: { list: async () => ({ runs: state.runs, nextCursor: null }) },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");
const { stubGate, stubRun } = await import("./stub-client.ts");

describe("what needs me", () => {
  it("puts a Gate first and a Run waiting on my answer second", async () => {
    state.gates = [
      stubGate({ checkpoint: "ship", run: { id: "run_1", issueKey: "acme/deevy#42" } }),
    ];
    state.runs = [
      stubRun({ id: "run_2", status: "awaiting_input", issueKey: "acme/deevy#7" }),
      stubRun({ id: "run_3", status: "active", issueKey: "acme/deevy#9" }),
      // A Run waiting at a Gate is not a question: the Gate above is where it
      // is answered, and counting it twice would say two things need me.
      stubRun({
        id: "run_4",
        status: "awaiting_input",
        openGateRequestId: "gate_stub00000",
        issueKey: "acme/deevy#42",
      }),
    ];

    await mountAt("/");

    await screen.findByRole("region", { name: "Gates awaiting you" });
    // In this order, and no others: the page is a queue, not a dashboard. The
    // toaster is a region too, so the page's own are the ones named here.
    const named = ["Gates awaiting you", "Runs awaiting your answer", "Your Agents' Runs"];
    const regions = screen
      .getAllByRole("region")
      .filter((region) => named.includes(region.getAttribute("aria-label") ?? ""));
    expect(regions.map((region) => region.getAttribute("aria-label"))).toEqual(named);
    const gates = regions[0] as HTMLElement;
    expect(within(gates).getByRole("link", { name: /ship/ }).getAttribute("href")).toBe(
      "/gates/gate_stub00000",
    );
    const answers = regions[1] as HTMLElement;
    expect(within(answers).getAllByRole("listitem")).toHaveLength(1);
    expect(within(answers).getByText(/acme\/deevy#7/)).toBeTruthy();
    expect(within(regions[2] as HTMLElement).getAllByRole("listitem")).toHaveLength(2);
  });

  it("says nothing needs you when nothing does", async () => {
    state.gates = [];
    state.runs = [];

    await mountAt("/");

    expect(await screen.findByText("Nothing needs you")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Gates awaiting you" })).toBeNull();
  });
});
