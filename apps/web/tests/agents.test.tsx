import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const stub = vi.hoisted(() => ({
  agents: [
    {
      id: "m-planner",
      role: "member",
      kind: "agent",
      handle: "planner",
      suspendedAt: null,
      user: {
        id: "u-planner",
        name: "Planner",
        email: "planner@agents.deevy.invalid",
        image: null,
      },
      sponsor: {
        id: "m-ada",
        role: "admin",
        kind: "human",
        handle: "ada",
        suspendedAt: null,
        user: { id: "u-ada", name: "Ada Lovelace", email: "ada@example.com", image: null },
      },
      webhookUrl: null,
      grantedProjectIds: ["p-dev"],
    },
    {
      id: "m-idle",
      role: "member",
      kind: "agent",
      handle: "idle",
      suspendedAt: new Date(),
      user: { id: "u-idle", name: "Idle", email: "idle@agents.deevy.invalid", image: null },
      sponsor: null,
      webhookUrl: "https://example.invalid/hook",
      grantedProjectIds: [],
    },
  ],
}));

const calls = vi.hoisted(() => ({
  create: vi.fn(async (input: { name: string; handle?: string | null }) => ({
    id: "m-new",
    handle: input.handle ?? "reviewer",
    user: { id: "u-new", name: input.name, email: "reviewer@agents.invalid", image: null },
    key: {
      id: "k-first",
      name: "first key",
      start: "deevy_sk_abcd",
      createdAt: new Date(),
      lastRequestAt: null,
      expiresAt: null,
      enabled: true,
      key: "deevy_sk_THE_ONLY_TIME_YOU_SEE_THIS",
    },
  })),
  suspend: vi.fn(async (_input: { memberId: string }) => ({})),
  reinstate: vi.fn(async (_input: { memberId: string }) => ({})),
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    agents: {
      list: async () => ({ agents: stub.agents }),
      create: calls.create,
      suspend: calls.suspend,
      reinstate: calls.reinstate,
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

/** The page links to an Agent's own page, so it is mounted through the router. */

describe("the Agents settings page", () => {
  it("lists every Agent with the Human accountable for it", async () => {
    await mountAt("/settings/agents");

    const planner = await screen.findByRole("row", { name: /planner/i });
    expect(within(planner).getByText("Ada Lovelace")).toBeTruthy();

    const idle = await screen.findByRole("row", { name: /idle/i });
    expect(within(idle).getByText(/suspended/i)).toBeTruthy();
    expect(within(idle).getByText(/no sponsor/i)).toBeTruthy();
  });

  it("says how many Projects an Agent may see", async () => {
    await mountAt("/settings/agents");

    const planner = await screen.findByRole("row", { name: /planner/i });
    expect(within(planner).getByText("1 Project")).toBeTruthy();
    const idle = await screen.findByRole("row", { name: /idle/i });
    await waitFor(() => expect(within(idle).getByText(/no Projects/i)).toBeTruthy());
  });
});

describe("an Agent with no schedule", () => {
  it("offers no interval to wake it on, because deevy wakes no Agent on a clock", async () => {
    await mountAt("/settings/agents");

    const planner = await screen.findByRole("row", { name: /planner/i });
    expect(within(planner).queryByLabelText(/schedule/i)).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /schedule/i })).toBeNull();
  });
});

describe("sponsoring an Agent", () => {
  it("creates one from the page, because the operator guide says this is where", async () => {
    await mountAt("/settings/agents");

    fireEvent.click(await screen.findByRole("button", { name: "New Agent" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Reviewer" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1));
    expect(calls.create.mock.calls[0]?.[0]).toMatchObject({ name: "Reviewer" });

    // The key it was created with, in the one place it is ever readable — and
    // the command it is for, with the key already written into it, because
    // afterwards nothing can fill that in.
    const shown = await screen.findByRole("dialog");
    expect(within(shown).getByText("deevy_sk_THE_ONLY_TIME_YOU_SEE_THIS")).toBeTruthy();
    expect(within(shown).getByText(/only time you will see it/i)).toBeTruthy();
    const command = within(shown).getByText(/claude mcp add/i);
    expect(command.textContent).toContain("Bearer deevy_sk_THE_ONLY_TIME_YOU_SEE_THIS");
    expect(within(shown).getByRole("tablist", { name: /coding agent/i })).toBeTruthy();
    expect(within(shown).getByRole("link", { name: /open reviewer/i })).toBeTruthy();
  });

  it("stops one that is working, and brings back one that is not", async () => {
    await mountAt("/settings/agents");

    const planner = await screen.findByRole("row", { name: /planner/i });
    fireEvent.click(within(planner).getByRole("button", { name: "Suspend" }));
    await waitFor(() => expect(calls.suspend).toHaveBeenCalledTimes(1));
    expect(calls.suspend.mock.calls[0]?.[0]).toMatchObject({ memberId: "m-planner" });

    const idle = await screen.findByRole("row", { name: /idle/i });
    fireEvent.click(within(idle).getByRole("button", { name: "Reinstate" }));
    await waitFor(() => expect(calls.reinstate).toHaveBeenCalledTimes(1));
  });
});
