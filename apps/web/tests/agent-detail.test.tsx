import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const stub = vi.hoisted(() => ({
  agent: {
    id: "m-planner",
    role: "member",
    kind: "agent",
    handle: "planner",
    suspendedAt: null,
    user: { id: "u-planner", name: "Planner", email: "planner@agents.invalid", image: null },
    sponsor: {
      id: "m-ada",
      role: "admin",
      kind: "human",
      handle: "ada",
      suspendedAt: null,
      user: { id: "u-ada", name: "Ada Lovelace", email: "ada@example.com", image: null },
    },
    webhookUrl: null,
    scheduleMinutes: null,
    grantedProjectIds: ["p-dev"],
  },
  projects: [
    { id: "p-dev", slug: "acme-deevy", name: "deevy", description: null, archivedAt: null },
    { id: "p-ops", slug: "acme-ops", name: "ops", description: null, archivedAt: null },
  ],
  keys: [
    {
      id: "k-1",
      name: "ci",
      start: "deevy_sk_abcd",
      createdAt: new Date("2026-09-01T10:00:00Z"),
      lastRequestAt: null,
      expiresAt: null,
      enabled: true,
    },
  ],
}));

const calls = vi.hoisted(() => ({
  issue: vi.fn(async (_input: { memberId: string; name: string }) => ({
    id: "k-2",
    name: "laptop",
    start: "deevy_sk_wxyz",
    createdAt: new Date(),
    lastRequestAt: null,
    expiresAt: null,
    enabled: true,
    key: "deevy_sk_THE_ONLY_TIME_YOU_SEE_THIS",
  })),
  revoke: vi.fn(async (_input: { memberId: string; keyId: string }) => ({ revoked: true })),
  grantAdd: vi.fn(async (_input: { memberId: string; projectId: string }) => ({
    projects: [],
  })),
  grantRemove: vi.fn(async (_input: { memberId: string; projectId: string }) => ({
    projects: [],
  })),
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    agents: {
      list: async () => ({ agents: [stub.agent] }),
      keys: { list: async () => ({ keys: stub.keys }), issue: calls.issue, revoke: calls.revoke },
      grants: {
        list: async () => ({ projects: [stub.projects[0]] }),
        add: calls.grantAdd,
        remove: calls.grantRemove,
      },
    },
    projects: { list: async () => ({ projects: stub.projects }) },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("an Agent's own page", () => {
  it("shows who answers for it and what it can see", async () => {
    await mountAt("/settings/agents/m-planner");

    expect(await screen.findByRole("heading", { name: /planner/i })).toBeTruthy();
    // The shell shows the signed-in Human's name too, so this asks the line
    // that says who answers for the Agent rather than the page as a whole.
    expect(screen.getByText(/Sponsored by/).textContent).toContain("Ada Lovelace");
    const grants = await screen.findByRole("region", { name: /projects/i });
    expect(within(grants).getByText(/acme-deevy/)).toBeTruthy();
  });

  it("shows an issued key exactly once, and says so", async () => {
    await mountAt("/settings/agents/m-planner");

    const keys = await screen.findByRole("region", { name: /api keys/i });
    // What is already there is a stub, never the key itself.
    expect(await within(keys).findByText(/deevy_sk_abcd/)).toBeTruthy();

    fireEvent.change(within(keys).getByLabelText(/key name/i), { target: { value: "laptop" } });
    fireEvent.click(within(keys).getByRole("button", { name: /issue/i }));

    await waitFor(() => expect(calls.issue).toHaveBeenCalledTimes(1));
    const shown = await screen.findByText("deevy_sk_THE_ONLY_TIME_YOU_SEE_THIS");
    expect(shown).toBeTruthy();
    expect(screen.getByText(/only time/i)).toBeTruthy();
  });

  it("grants a Project and takes one back", async () => {
    await mountAt("/settings/agents/m-planner");

    const grants = await screen.findByRole("region", { name: /projects/i });
    // A combobox over the Projects not yet granted: ArrowDown opens it under
    // jsdom, the options are portalled, choosing one grants it.
    const picker = within(grants).getByLabelText(/grant a project/i);
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /acme-ops/ }));
    fireEvent.keyDown(picker, { key: "Escape" });
    await waitFor(() => expect(calls.grantAdd).toHaveBeenCalledTimes(1));
    expect(calls.grantAdd.mock.calls[0]?.[0]).toMatchObject({
      memberId: "m-planner",
      projectId: "p-ops",
    });

    fireEvent.click(within(grants).getByRole("button", { name: /revoke acme-deevy/i }));
    await waitFor(() => expect(calls.grantRemove).toHaveBeenCalledTimes(1));
  });
});

describe("the Agent's own settings", () => {
  it("offers the schedule, the Sponsor, its recent Runs, and the way to suspend it", async () => {
    await mountAt("/settings/agents/m-planner");

    expect(await screen.findByLabelText("Wake")).toBeTruthy();
    expect(screen.getByLabelText("Change Sponsor")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Recent Runs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Suspend" })).toBeTruthy();
  });
});

describe("connecting an Agent over MCP", () => {
  it("gives the endpoint and one recipe per coding agent, on the Agent's own page", async () => {
    await mountAt("/settings/agents/m-planner");

    const panel = await screen.findByRole("region", { name: /connect an agent/i });
    expect(within(panel).getByText(`${window.location.origin}/mcp`)).toBeTruthy();

    // Claude Code is the first tab, and every other CLI the runtime drives is
    // a tab beside it, so nobody has to translate a command into their own.
    const tabs = within(panel).getByRole("tablist", { name: /coding agent/i });
    const labels = within(tabs)
      .getAllByRole("tab")
      .map((tab) => tab.textContent);
    expect(labels).toEqual([
      "Claude Code",
      "OpenCode",
      "Cursor CLI",
      "Copilot CLI",
      "Anything else",
    ]);
    // With no key in hand the command names one instead: deevy keeps a hash and
    // cannot write a key into a command it shows later.
    const claude = within(panel).getByText(/claude mcp add/i);
    expect(claude.textContent).toContain("--transport http");
    expect(claude.textContent).toContain("Bearer $DEEVY_AGENT_KEY");

    fireEvent.click(within(tabs).getByRole("tab", { name: "OpenCode" }));
    const opencode = await within(panel).findByText(/"type": "remote"/);
    expect(opencode.textContent).toContain(`${window.location.origin}/mcp`);
    expect(opencode.textContent).toContain("Bearer {env:DEEVY_AGENT_KEY}");

    // Cursor documents ${env:} and does not resolve it for a remote server, so
    // it is told the key itself rather than a reference deevy would receive.
    fireEvent.click(within(tabs).getByRole("tab", { name: "Cursor CLI" }));
    const cursor = await within(panel).findByText(/"mcpServers"/);
    expect(cursor.textContent).toContain("Bearer <the key>");
  });

  it("writes the key into the command at the one moment it can, when a key is issued", async () => {
    await mountAt("/settings/agents/m-planner");

    const keys = await screen.findByRole("region", { name: /api keys/i });
    fireEvent.change(within(keys).getByLabelText(/key name/i), { target: { value: "laptop" } });
    fireEvent.click(within(keys).getByRole("button", { name: "Issue" }));

    await waitFor(() => expect(calls.issue).toHaveBeenCalledTimes(1));
    const minted = await within(keys).findByText("deevy_sk_THE_ONLY_TIME_YOU_SEE_THIS");
    expect(minted).toBeTruthy();
    // Beside it, the command with that key in it rather than a variable.
    const command = within(keys).getByText(/claude mcp add/i);
    expect(command.textContent).toContain("Bearer deevy_sk_THE_ONLY_TIME_YOU_SEE_THIS");
  });
});
