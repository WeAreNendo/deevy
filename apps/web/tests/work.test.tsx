import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

/**
 * The Work list and one Work item (docs/plans/sockets.md, slice 3).
 *
 * Read-only by construction: an Issue is a projection of a record in somebody
 * else's tool, and deevy authors none of it (ADR-0024). So the page's job is
 * to say what deevy knows — which Agent has it, what Runs there have been,
 * what Gates were asked — and then get out of the way with a link to where the
 * work actually lives.
 */
const seen = vi.hoisted(() => ({ input: null as Record<string, unknown> | null }));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient, stubGate, stubIssue, stubRun } = await import("./stub-client.ts");
  const record = {
    ...stubIssue,
    id: "iss_one0000000",
    title: "Checkout rewrite",
    externalKey: "acme/deevy#42",
    url: "https://github.test/acme/deevy/issues/42",
    body: "The totals are wrong when a coupon is applied.",
    stateName: "In progress",
  };
  const client = stubClient({
    issues: {
      list: async (input: Record<string, unknown>) => {
        seen.input = input;
        return { issues: [record], nextCursor: null, hasMore: false };
      },
      get: async () => ({ ...record, children: [], parent: null }),
    },
    gates: { list: async () => ({ gates: [stubGate({ status: "open" })] }) },
    runs: { list: async () => ({ runs: [stubRun({ id: "run_1" })], nextCursor: null }) },
    events: {
      list: async () => ({
        events: [
          {
            seq: 4,
            workspaceId: "w1",
            kind: "issue.synced",
            subjectType: "issue",
            subjectId: "iss_one0000000",
            projectId: "proj_acme-deevy",
            actorMemberId: null,
            actor: null,
            payload: { changed: ["title"] },
            createdAt: new Date("2026-09-20T09:00:00Z"),
          },
        ],
        nextCursor: null,
      }),
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("the Work list", () => {
  it("lists the records deevy has projected, and links each key out", async () => {
    await mountAt("/work");

    const table = await screen.findByRole("table", { name: "Work" });
    const row = within(table).getAllByRole("row")[1] as HTMLElement;
    expect(within(row).getByText("Checkout rewrite")).toBeTruthy();
    // The key is a way out to the tracker, and a new tab is never a way back in.
    const out = within(row).getByRole("link", { name: /acme\/deevy#42/ });
    expect(out.getAttribute("href")).toBe("https://github.test/acme/deevy/issues/42");
    expect(out.getAttribute("rel")).toContain("noopener");
  });

  it("puts its filters in the URL and asks the server for them", async () => {
    const router = await mountAt("/work?state=closed");

    await screen.findByRole("table", { name: "Work" });
    expect(seen.input).toMatchObject({ state: "closed" });

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "coupon" } });
    fireEvent.submit(screen.getByRole("search"));

    expect(router.state.location.search).toMatchObject({ state: "closed", q: "coupon" });
  });
});

describe("one Work item", () => {
  it("shows what deevy knows and offers nothing to edit", async () => {
    await mountAt("/work/iss_one0000000");

    expect(await screen.findByRole("heading", { name: "Checkout rewrite" })).toBeTruthy();
    expect(screen.getByText(/totals are wrong/)).toBeTruthy();
    // Nothing here is deevy's to change: no field, no composer, no buttons
    // that write to the record.
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(
      screen.getByRole("link", { name: /Read the conversation on/ }).getAttribute("href"),
    ).toBe("https://github.test/acme/deevy/issues/42");

    expect(
      within(screen.getByRole("list", { name: "Runs" })).getAllByRole("listitem"),
    ).toHaveLength(1);
    expect(
      within(screen.getByRole("list", { name: "Gates" })).getAllByRole("listitem"),
    ).toHaveLength(1);
    expect(await screen.findByRole("list", { name: "Events" })).toBeTruthy();
  });
});
