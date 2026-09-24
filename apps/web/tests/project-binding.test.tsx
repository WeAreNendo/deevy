import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { pickOption } from "./select.ts";

/**
 * A Project is a binding, and a policy (ADR-0024, ADR-0020).
 *
 * What it says is where its records come from, where its code is, which Agent
 * gets one nobody named, and what it asks of a Run before it goes past a
 * Checkpoint. None of that is work — the work is in the tracker — so this
 * screen is the whole of what a Project is.
 */
const calls = vi.hoisted(() => ({
  update: vi.fn(async (_input: Record<string, unknown>) => ({})),
  create: vi.fn(async (_input: Record<string, unknown>) => ({})),
  setCheckpoints: vi.fn(async (_input: Record<string, unknown>) => ({ checkpoints: [] })),
}));

const state = vi.hoisted(() => ({
  checkpoints: [] as unknown[],
  refuse: null as string | null,
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient, stubProject, stubSocket } = await import("./stub-client.ts");
  const project = stubProject("acme-deevy", "deevy", {
    trackerScope: { scopeKey: "acme/deevy" },
    trackerScopeKey: "github:acme/deevy",
  });
  const client = stubClient({
    projects: {
      list: async () => ({ projects: [project] }),
      get: async () => project,
      update: async (input: Record<string, unknown>) => {
        void calls.update(input);
        return { ...project, ...input };
      },
      create: async (input: Record<string, unknown>) => {
        void calls.create(input);
        return { ...project, ...input };
      },
    },
    sockets: {
      list: async () => ({
        sockets: [{ ...stubSocket, provider: "github", name: "acme on GitHub" }],
      }),
      containers: async () => ({
        containers: [
          { scope: { scopeKey: "acme/deevy" }, scopeKey: "acme/deevy", name: "acme/deevy" },
          { scope: { scopeKey: "acme/ops" }, scopeKey: "acme/ops", name: "acme/ops" },
        ],
      }),
    },
    agents: {
      list: async () => ({
        agents: [
          {
            id: "m-planner",
            role: "member",
            kind: "agent",
            handle: "planner",
            suspendedAt: null,
            user: { id: "u-p", name: "Planner", email: "planner@agents.invalid", image: null },
            sponsor: null,
            webhookUrl: null,
            scheduleMinutes: null,
            grantedProjectIds: [],
          },
        ],
      }),
    },
    members: {
      list: async () => ({
        members: [
          {
            id: "m-ada",
            role: "admin",
            kind: "human",
            handle: "ada",
            suspendedAt: null,
            user: { id: "u-ada", name: "Ada Lovelace", email: "ada@example.com", image: null },
          },
        ],
      }),
    },
    checkpoints: {
      list: async () => ({ checkpoints: state.checkpoints }),
      set: async (input: Record<string, unknown>) => {
        void calls.setCheckpoints(input);
        if (state.refuse) throw new Error(state.refuse);
        return { checkpoints: input.checkpoints };
      },
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("what a Project is bound to", () => {
  it("names the tool and the container its records come from, and will not move them", async () => {
    state.checkpoints = [];
    await mountAt("/settings/projects?project=acme-deevy");

    const binding = await screen.findByRole("region", { name: "Binding" });
    expect(await within(binding).findByText("acme on GitHub")).toBeTruthy();
    expect(within(binding).getByText("acme/deevy")).toBeTruthy();
    // Moving a Project to another container would orphan every record under
    // it, so the tracker is stated rather than offered (ADR-0024).
    expect(within(binding).queryByRole("combobox", { name: "Tracker" })).toBeNull();
  });

  it("gives a record nobody named to the Agent this Project chose", async () => {
    state.checkpoints = [];
    calls.update.mockClear();
    await mountAt("/settings/projects?project=acme-deevy");

    const binding = await screen.findByRole("region", { name: "Binding" });
    await pickOption(within(binding).getByRole("combobox", { name: "Default Agent" }), "Planner");

    await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(1));
    expect(calls.update.mock.calls[0]?.[0]).toMatchObject({
      slug: "acme-deevy",
      defaultAgentMemberId: "m-planner",
    });
  });

  it("says how much deevy writes back where the work lives", async () => {
    state.checkpoints = [];
    calls.update.mockClear();
    await mountAt("/settings/projects?project=acme-deevy");

    const binding = await screen.findByRole("region", { name: "Binding" });
    await pickOption(within(binding).getByRole("combobox", { name: "Mirror" }), "Nothing");

    await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(1));
    expect(calls.update.mock.calls[0]?.[0]).toMatchObject({ mirror: "off" });
  });
});

describe("what a Project asks at a Checkpoint", () => {
  it("adds one, says what it wants, and saves the whole policy at once", async () => {
    state.checkpoints = [];
    state.refuse = null;
    calls.setCheckpoints.mockClear();
    await mountAt("/settings/projects?project=acme-deevy");

    const policy = await screen.findByRole("region", { name: "Checkpoints" });
    fireEvent.click(within(policy).getByRole("button", { name: "Add a Checkpoint" }));
    fireEvent.change(within(policy).getByLabelText("Name"), { target: { value: "ship" } });
    fireEvent.change(within(policy).getByLabelText("Approvals"), { target: { value: "2" } });
    fireEvent.click(
      within(policy).getByRole("checkbox", { name: /Not the Human the work is for/ }),
    );
    fireEvent.click(within(policy).getByRole("button", { name: "Save policy" }));

    await waitFor(() => expect(calls.setCheckpoints).toHaveBeenCalledTimes(1));
    // The list is the policy: a Checkpoint left out of it is one the Project no
    // longer has, so it is saved whole and never a field at a time.
    expect(calls.setCheckpoints.mock.calls[0]?.[0]).toMatchObject({
      projectSlug: "acme-deevy",
      checkpoints: [{ name: "ship", approvalsRequired: 2, excludeRequester: true }],
    });
  });

  it("shows the refusal when nobody could meet the threshold", async () => {
    state.checkpoints = [];
    state.refuse = "The ship Checkpoint wants 9 approvals and only 1 Humans could give one";
    await mountAt("/settings/projects?project=acme-deevy");

    const policy = await screen.findByRole("region", { name: "Checkpoints" });
    fireEvent.click(within(policy).getByRole("button", { name: "Add a Checkpoint" }));
    fireEvent.change(within(policy).getByLabelText("Name"), { target: { value: "ship" } });
    fireEvent.change(within(policy).getByLabelText("Approvals"), { target: { value: "9" } });
    fireEvent.click(within(policy).getByRole("button", { name: "Save policy" }));

    // The server's own words, not a second copy of the rule in the browser.
    expect(await within(policy).findByText(/only 1 Humans could give one/)).toBeTruthy();
  });

  it("says what a Checkpoint nobody configured does", async () => {
    state.checkpoints = [];
    state.refuse = null;
    await mountAt("/settings/projects?project=acme-deevy");

    const policy = await screen.findByRole("region", { name: "Checkpoints" });
    expect(within(policy).getByText(/one approval, from anybody/i)).toBeTruthy();
  });
});

describe("binding a new Project", () => {
  it("picks a tool, a container inside it, and the Agent its records go to", async () => {
    state.checkpoints = [];
    calls.create.mockClear();
    await mountAt("/settings/projects");

    fireEvent.click(await screen.findByRole("button", { name: "Bind a Project" }));
    const dialog = await screen.findByRole("dialog", { name: /Bind a Project/ });

    // The tool first, because the containers it offers depend on it.
    await pickOption(within(dialog).getByRole("combobox", { name: "Tool" }), /acme on GitHub/);
    // And the containers are the tool's own answer, never typed by hand.
    await pickOption(within(dialog).getByRole("combobox", { name: "Container" }), "acme/ops");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Operations" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Bind it" }));

    await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1));
    expect(calls.create.mock.calls[0]?.[0]).toMatchObject({
      name: "Operations",
      // From the container, so a Project's handle is the thing it is bound to.
      slug: "acme-ops",
      tracker: { socketId: "sock_stub00000", scope: { scopeKey: "acme/ops" } },
    });
  });
});
