import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

/**
 * The Runs feed and one Run (docs/plans/sockets.md, slice 3).
 *
 * What an Agent did is deevy's own record — the tracker has none of it — so
 * this is the one list deevy still owns. Its filters ride in the URL, like
 * every list before it, and each of them is the server's.
 */
const seen = vi.hoisted(() => ({
  input: null as Record<string, unknown> | null,
  status: "active",
  trigger: "assignment",
  retried: [] as unknown[],
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient, stubGate, stubRun } = await import("./stub-client.ts");
  const client = stubClient({
    runs: {
      list: async (input: Record<string, unknown>) => {
        seen.input = input;
        return {
          runs: [
            stubRun({ id: "run_1", issueKey: "acme/deevy#42", status: "active" }),
            stubRun({
              id: "run_2",
              issueKey: "acme/deevy#7",
              status: "awaiting_input",
              openGateRequestId: "gate_stub00000",
            }),
          ],
          nextCursor: null,
        };
      },
      get: async () => ({
        ...stubRun({ id: "run_1", status: seen.status, trigger: seen.trigger, summary: null }),
        activities: [
          {
            id: "act_1",
            runId: "run_1",
            kind: "thought",
            body: "Reading the totals code",
            payload: null,
            createdAt: new Date("2026-09-20T08:00:00Z"),
          },
          {
            id: "act_2",
            runId: "run_1",
            kind: "action",
            body: "Opened a pull request",
            payload: null,
            createdAt: new Date("2026-09-20T08:30:00Z"),
          },
        ],
      }),
      retry: async (input: Record<string, unknown>) => {
        seen.retried.push(input);
        return stubRun({ id: "run_9", status: "pending", trigger: "retry" });
      },
    },
    gates: { list: async () => ({ gates: [stubGate({ status: "approved", approvals: 1 })] }) },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("the Runs feed", () => {
  it("lists what the Agents are doing, and says which Gate one waits at", async () => {
    await mountAt("/runs");

    const table = await screen.findByRole("table", { name: "Runs" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("acme/deevy#42")).toBeTruthy();
    // The one waiting is a link to where it is answered, not a dead badge.
    expect(
      within(rows[1] as HTMLElement).getByRole("link", { name: /Waiting on a ruling/ }),
    ).toBeTruthy();
  });

  it("carries its filter in the URL, and asks the server for it", async () => {
    const router = await mountAt("/runs?status=awaiting_input");

    await screen.findByRole("table", { name: "Runs" });
    expect(seen.input).toMatchObject({ status: "awaiting_input" });
    expect(router.state.location.search).toMatchObject({ status: "awaiting_input" });
  });

  it("filters to mine when asked, and the URL says so", async () => {
    const router = await mountAt("/runs");

    fireEvent.click(await screen.findByRole("button", { name: "Mine" }));

    expect(router.state.location.search).toMatchObject({ mine: "1" });
  });
});

describe("one Run", () => {
  it("reads as what happened, with the Gates it asked for", async () => {
    await mountAt("/runs/run_1");

    expect(await screen.findByRole("heading", { name: /acme\/deevy#/ })).toBeTruthy();
    const feed = screen.getByRole("list", { name: "Activity of run_1" });
    expect(within(feed).getAllByRole("listitem")).toHaveLength(2);
    expect(within(feed).getByText("Opened a pull request")).toBeTruthy();

    const gates = screen.getByRole("list", { name: "Gates" });
    expect(within(gates).getByRole("link", { name: /ship/ })).toBeTruthy();
  });
});

describe("a Run that did not finish", () => {
  it("offers to try again, and goes to the fresh Run it asked for", async () => {
    seen.status = "failed";
    seen.retried = [];
    const router = await mountAt("/runs/run_1");

    // The first real GitHub walk had a Run fail on the environment and no way
    // to ask again from deevy: only a mention in the tracker.
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(seen.retried).toEqual([{ runId: "run_1" }]));
    await waitFor(() => expect(router.state.location.pathname).toBe("/runs/run_9"));
    seen.status = "active";
  });

  it("offers nothing to a Run that is still going", async () => {
    seen.status = "active";
    await mountAt("/runs/run_1");

    await screen.findByRole("heading", { name: /acme\/deevy#/ });
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says what started it in words, never the value behind it", async () => {
    seen.status = "active";
    seen.trigger = "children_done";
    await mountAt("/runs/run_1");

    expect(await screen.findByText("started when its sub-issues finished")).toBeTruthy();
    seen.trigger = "assignment";
  });
});
