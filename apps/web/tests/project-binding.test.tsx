import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { pickOption, selectedLabel } from "./select.ts";

/**
 * A Project is a binding, and a policy (ADR-0024, ADR-0020).
 *
 * What it says is where its records come from, which Agent gets one nobody
 * named, how a record names an Agent, and what it asks of a Run before it goes
 * past a Checkpoint. None of that is work — the work is in the tracker — so
 * this screen is the whole of what a Project is.
 */
const calls = vi.hoisted(() => ({
  update: vi.fn(async (_input: Record<string, unknown>) => ({})),
  create: vi.fn(async (_input: Record<string, unknown>) => ({})),
  setCheckpoints: vi.fn(async (_input: Record<string, unknown>) => ({ checkpoints: [] })),
}));

const state = vi.hoisted(() => ({
  checkpoints: [] as unknown[],
  refuse: null as string | null,
  /** The routing somebody else saved, which the Project read back then says. */
  routing: null as { labelPrefix: string; mention: boolean } | null,
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
      get: async () => (state.routing ? { ...project, routing: state.routing } : project),
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
        sockets: [
          { ...stubSocket, provider: "github", name: "acme on GitHub" },
          {
            ...stubSocket,
            id: "sock_plain00000",
            name: "A tool that lists nothing",
          },
        ],
      }),
      // A tool that cannot list its containers answers null, and the dialog
      // asks for the container's key instead (docs/plans/simplify.md, slice 4).
      containers: async (input: { socketId: string }) => ({
        containers:
          input.socketId === "sock_plain00000"
            ? null
            : [
                {
                  scope: { scopeKey: "acme/deevy", baseBranch: "main" },
                  scopeKey: "acme/deevy",
                  name: "acme/deevy",
                },
                {
                  scope: { scopeKey: "acme/ops", baseBranch: "trunk" },
                  scopeKey: "acme/ops",
                  name: "acme/ops",
                },
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

  it("reads as words in every choice, never as the value behind it", async () => {
    state.checkpoints = [];
    await mountAt("/settings/projects?project=acme-deevy");

    const binding = await screen.findByRole("region", { name: "Binding" });
    // A Base UI trigger shows its raw value unless told what it is called,
    // which once put `gates` and a Member id on this screen.
    await waitFor(() =>
      expect(selectedLabel(within(binding).getByRole("combobox", { name: "Default Agent" }))).toBe(
        "Nobody",
      ),
    );
  });

  it("has nothing to say about what deevy writes back, or where documents live", async () => {
    state.checkpoints = [];
    await mountAt("/settings/projects?project=acme-deevy");

    const binding = await screen.findByRole("region", { name: "Binding" });
    // Every Project announces a Gate and its Ruling on the record and nothing
    // else, and an Agent reads a team's documents where the team keeps them
    // (docs/plans/simplify.md, slice 4): neither is a setting.
    await within(binding).findByRole("combobox", { name: "Default Agent" });
    expect(within(binding).queryByRole("combobox", { name: "Mirror" })).toBeNull();
    expect(within(binding).queryByRole("combobox", { name: "Documents" })).toBeNull();
  });

  it("says whether a mention hands a record over, and keeps the label just typed", async () => {
    state.checkpoints = [];
    calls.update.mockClear();
    await mountAt("/settings/projects?project=acme-deevy");

    const binding = await screen.findByRole("region", { name: "Binding" });
    const mentions = within(binding).getByRole("switch", { name: "Route by mention" });
    expect(mentions.getAttribute("aria-checked")).toBe("true");
    // The example is the tracker's own way of naming deevy.
    expect(within(binding).getByText("@deevy planner")).toBeTruthy();

    // Leaving the field for the switch saves the field first, and the switch
    // must not put back the label the Project said before it.
    const label = within(binding).getByLabelText("Routing label");
    fireEvent.change(label, { target: { value: "for:" } });
    fireEvent.blur(label);
    fireEvent.click(mentions);

    await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(2));
    expect(calls.update.mock.calls[1]?.[0]).toMatchObject({
      slug: "acme-deevy",
      routing: { labelPrefix: "for:", mention: false },
    });
  });

  it("never puts back a routing label somebody else saved since", async () => {
    state.checkpoints = [];
    calls.update.mockClear();
    await mountAt("/settings/projects?project=acme-deevy");

    const binding = await screen.findByRole("region", { name: "Binding" });
    const label = within(binding).getByLabelText<HTMLInputElement>("Routing label");
    expect(label.value).toBe("agent:");

    // Another tab, or the CLI, saves `for:`; this screen reads it back after
    // its own next change, here the Default Agent.
    state.routing = { labelPrefix: "for:", mention: true };
    await pickOption(within(binding).getByRole("combobox", { name: "Default Agent" }), "Planner");
    await waitFor(() => expect(label.value).toBe("for:"));

    fireEvent.click(within(binding).getByRole("switch", { name: "Route by mention" }));
    await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(2));
    expect(calls.update.mock.calls[1]?.[0]).toMatchObject({
      routing: { labelPrefix: "for:", mention: false },
    });
    state.routing = null;
  });
});

describe("where a Project's code lives", () => {
  it("is nowhere a Project says: the Agent reaches it with access of its own", async () => {
    state.checkpoints = [];
    await mountAt("/settings/projects?project=acme-deevy");

    const binding = await screen.findByRole("region", { name: "Binding" });
    // deevy holds no Run's code (ADR-0034), so there is no repository to pick
    // and no base branch to set.
    expect(within(binding).queryByRole("combobox", { name: "Repository" })).toBeNull();
    expect(within(binding).queryByLabelText("Base branch")).toBeNull();
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
    const tool = within(dialog).getByRole("combobox", { name: "Tool" });
    await pickOption(tool, /acme on GitHub/);
    // And the containers are the tool's own answer, never typed by hand.
    const container = within(dialog).getByRole("combobox", { name: "Container" });
    await pickOption(container, "acme/ops");
    // Each says what was chosen, never the id behind it: the first real GitHub
    // walk read `sock_…` here.
    expect(selectedLabel(tool)).toBe("acme on GitHub (GitHub)");
    expect(selectedLabel(container)).toBe("acme/ops");
    // Its records and nothing else: there is no code to bind it to.
    expect(within(dialog).queryByRole("checkbox", { name: /Its code is here too/ })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Operations" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Bind it" }));

    await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1));
    expect(calls.create.mock.calls[0]?.[0]).toMatchObject({
      name: "Operations",
      // From the container, so a Project's handle is the thing it is bound to.
      slug: "acme-ops",
      tracker: { socketId: "sock_stub00000", scope: { scopeKey: "acme/ops", baseBranch: "trunk" } },
    });
    expect(calls.create.mock.calls[0]?.[0]).not.toHaveProperty("forge");
  });

  it("takes the container's key, typed, from a tool that lists none", async () => {
    state.checkpoints = [];
    calls.create.mockClear();
    await mountAt("/settings/projects");

    fireEvent.click(await screen.findByRole("button", { name: "Bind a Project" }));
    const dialog = await screen.findByRole("dialog", { name: /Bind a Project/ });
    await pickOption(within(dialog).getByRole("combobox", { name: "Tool" }), /lists nothing/);

    // Nothing to pick from, so the container is a field, named as the tool's
    // deliveries name it.
    const container = await within(dialog).findByRole("textbox", { name: "Container" });
    expect(within(dialog).queryByRole("combobox", { name: "Container" })).toBeNull();
    fireEvent.change(container, { target: { value: "acme/typed" } });
    fireEvent.blur(container);
    expect(within(dialog).getByLabelText<HTMLInputElement>("Name").value).toBe("typed");
    fireEvent.click(within(dialog).getByRole("button", { name: "Bind it" }));

    await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1));
    expect(calls.create.mock.calls[0]?.[0]).toMatchObject({
      name: "typed",
      slug: "acme-typed",
      tracker: { socketId: "sock_plain00000", scope: { scopeKey: "acme/typed" } },
    });
  });
});
