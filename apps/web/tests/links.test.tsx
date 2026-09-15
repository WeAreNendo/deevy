import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const stub = vi.hoisted(() => ({
  issue: {
    id: "i1",
    key: "DEV-1",
    title: "Ship it",
    description: null,
    state: { id: "s4", name: "Build", position: 3, isGate: false, category: "active" },
    assignee: null,
    parent: null,
    children: [],
    gateDecisions: [],
    labels: [],
    project: { id: "p1", key: "DEV", name: "deevy" },
  },
  links: [
    {
      id: "k1",
      kind: "pull_request",
      url: "https://github.com/WeAreNendo/deevy/pull/12",
      title: null,
      ref: "12",
    },
    {
      id: "k2",
      kind: "url",
      url: "https://example.com/design",
      title: "The design",
      ref: null,
    },
  ],
  added: [] as unknown[],
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    issues: { get: async () => stub.issue },
    workflow: { get: async () => ({ states: [stub.issue.state] }) },
    links: {
      list: async () => ({ links: stub.links }),
      add: async (input: unknown) => {
        stub.added.push(input);
        return stub.links[0];
      },
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("the Links section", () => {
  it("groups Links by kind", async () => {
    await mountAt("/issues/DEV-1", { memberName: "Ada" });

    const pulls = await screen.findByRole("list", { name: "Pull requests" });
    expect(within(pulls).getByRole("link", { name: "12" })).toBeTruthy();

    const other = screen.getByRole("list", { name: "Links" });
    expect(within(other).getByRole("link", { name: "The design" })).toBeTruthy();
  });

  it("adds a pasted URL without asking for its kind", async () => {
    await mountAt("/issues/DEV-1", { memberName: "Ada" });

    fireEvent.change(await screen.findByLabelText("Add a link"), {
      target: { value: "https://github.com/WeAreNendo/deevy/pull/13" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));

    await waitFor(() =>
      expect(stub.added).toContainEqual(
        expect.objectContaining({
          issueKey: "DEV-1",
          url: "https://github.com/WeAreNendo/deevy/pull/13",
        }),
      ),
    );
  });
});
