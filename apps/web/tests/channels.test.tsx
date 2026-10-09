import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const stub = vi.hoisted(() => ({
  channels: [
    {
      id: "c1",
      kind: "slack",
      name: "#deevy",
      webhookHost: "hooks.slack.com",
      socketId: null,
      conversation: null,
      createdBy: "m1",
      createdAt: new Date(),
    },
  ],
  sockets: [] as Array<Record<string, unknown>>,
  createdInSocket: [] as unknown[],
  rules: [
    {
      id: "r1",
      notificationKind: "gate_awaiting",
      projectId: null,
      channelId: "c1",
      createdAt: new Date(),
    },
  ],
  created: [] as unknown[],
  set: [] as unknown[],
  tested: [] as unknown[],
  createdEmail: [] as unknown[],
  /** What the sender said to a confirmation, as `channels.createEmail` reports it. */
  confirmation: { delivered: true, status: 200, error: null } as {
    delivered: boolean;
    status: number;
    error: string | null;
  },
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient, stubProject } = await import("./stub-client.ts");
  const client = stubClient({
    channels: {
      list: async () => ({ channels: stub.channels }),
      create: async (input: unknown) => {
        stub.created.push(input);
        return stub.channels[0];
      },
      test: async (input: unknown) => {
        stub.tested.push(input);
        return { delivered: true, status: 200, error: null };
      },
      createInSocket: async (input: unknown) => {
        stub.createdInSocket.push(input);
        return stub.channels[0];
      },
      createEmail: async (input: { name: string; address: string }) => {
        stub.createdEmail.push(input);
        return {
          channel: {
            ...stub.channels[0],
            id: "c9",
            kind: "email",
            name: input.name,
            webhookHost: null,
            address: input.address,
            confirmedAt: null,
          },
          confirmation: stub.confirmation,
        };
      },
    },
    sockets: {
      list: async () => ({ sockets: stub.sockets }),
    },
    routing: {
      list: async () => ({ rules: stub.rules }),
      set: async (input: unknown) => {
        stub.set.push(input);
        return { rules: stub.rules };
      },
    },
    projects: {
      list: async () => ({ projects: [stubProject("acme-deevy", "deevy", { id: "p1" })] }),
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("the Channels settings page", () => {
  it("lists the Channels by name and where they point, never the webhook itself", async () => {
    await mountAt("/settings/channels", { memberName: "Ada" });

    expect(await screen.findByText("#deevy")).toBeTruthy();
    expect(screen.getByText("hooks.slack.com")).toBeTruthy();
  });

  it("adds a Slack incoming webhook from the form", async () => {
    await mountAt("/settings/channels", { memberName: "Ada" });

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "#alerts" } });
    fireEvent.change(screen.getByLabelText("Incoming webhook URL"), {
      target: { value: "https://hooks.slack.com/services/T/B/x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Channel" }));

    await waitFor(() =>
      expect(stub.created).toContainEqual({
        name: "#alerts",
        webhookUrl: "https://hooks.slack.com/services/T/B/x",
      }),
    );
  });

  it("proves a Channel works with the Test button, and says what came back", async () => {
    await mountAt("/settings/channels", { memberName: "Ada" });

    fireEvent.click(await screen.findByRole("button", { name: "Test" }));

    await waitFor(() => expect(stub.tested).toContainEqual({ channelId: "c1" }));
    expect(await screen.findByText(/Slack accepted/)).toBeTruthy();
  });

  it("adds a room in a connected Slack app, where a Gate carries its buttons", async () => {
    const { stubSocket } = await import("./stub-client.ts");
    stub.sockets = [
      {
        ...stubSocket,
        id: "sock_slack",
        provider: "slack",
        capabilities: ["chat"],
        name: "Acme Slack",
      },
    ];
    await mountAt("/settings/channels", { memberName: "Ada" });

    const room = await screen.findByRole("form", { name: "Add a Slack room" });
    fireEvent.change(within(room).getByLabelText("Name"), { target: { value: "#approvals" } });
    fireEvent.change(within(room).getByLabelText("Slack channel ID"), {
      target: { value: "C07DEEVY01" },
    });
    fireEvent.click(within(room).getByRole("button", { name: "Add room" }));

    await waitFor(() =>
      expect(stub.createdInSocket).toEqual([
        { name: "#approvals", socketId: "sock_slack", conversation: "C07DEEVY01" },
      ]),
    );
    stub.sockets = [];
  });

  it("offers no Slack room without a Slack app connected", async () => {
    await mountAt("/settings/channels", { memberName: "Ada" });

    await screen.findByText("#deevy");
    expect(screen.queryByRole("form", { name: "Add a Slack room" })).toBeNull();
  });

  it("adds a routing rule and saves the whole set", async () => {
    await mountAt("/settings/channels", { memberName: "Ada" });

    fireEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    fireEvent.click(screen.getByRole("button", { name: "Save routing" }));

    await waitFor(() => expect(stub.set).toHaveLength(1));
    const [saved] = stub.set as [{ rules: unknown[] }];
    // The rule that was already there, and the new one.
    expect(saved.rules).toHaveLength(2);
    expect(saved.rules[0]).toEqual({
      notificationKind: "gate_awaiting",
      projectId: null,
      channelId: "c1",
    });
  });

  it("adds a team email address, and says a confirmation went there first", async () => {
    stub.confirmation = { delivered: true, status: 200, error: null };
    await mountAt("/settings/channels", { memberName: "Ada" });

    const form = await screen.findByRole("form", { name: "Add an email address" });
    fireEvent.change(within(form).getByLabelText("Team email address"), {
      target: { value: "approvals@example.com" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Add address" }));

    await waitFor(() =>
      expect(stub.createdEmail).toContainEqual({
        name: "approvals@example.com",
        address: "approvals@example.com",
      }),
    );
    expect(await screen.findByText(/sent a confirmation to approvals@example\.com/i)).toBeTruthy();
  });

  it("says what the sender said when the confirmation could not go", async () => {
    stub.confirmation = {
      delivered: false,
      status: 403,
      error: "The example.com domain is not verified.",
    };
    await mountAt("/settings/channels", { memberName: "Ada" });

    const form = await screen.findByRole("form", { name: "Add an email address" });
    fireEvent.change(within(form).getByLabelText("Team email address"), {
      target: { value: "ops@example.com" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Add address" }));

    expect(await screen.findByText(/The example\.com domain is not verified\./)).toBeTruthy();
    stub.confirmation = { delivered: true, status: 200, error: null };
  });

  it("shows a team address waiting for its confirmation", async () => {
    const before = stub.channels;
    stub.channels = [
      {
        ...before[0],
        id: "c9",
        kind: "email",
        name: "approvals@example.com",
        webhookHost: null,
        address: "approvals@example.com",
        confirmedAt: null,
      } as unknown as (typeof before)[number],
    ];
    await mountAt("/settings/channels", { memberName: "Ada" });

    const table = await screen.findByRole("table", { name: "Channels" });
    expect(within(table).getByText(/Waiting for confirmation/)).toBeTruthy();
    fireEvent.click(within(table).getByRole("button", { name: "Test" }));
    expect(await screen.findByText(/Sent the confirmation again/)).toBeTruthy();
    stub.channels = before;
  });
});
