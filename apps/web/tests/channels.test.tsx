import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const stub = vi.hoisted(() => ({
  channels: [
    {
      id: "c1",
      kind: "slack",
      name: "#deevy",
      webhookHost: "hooks.slack.com",
      createdBy: "m1",
      createdAt: new Date(),
    },
  ],
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
});
