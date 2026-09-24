import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const stub = vi.hoisted(() => ({
  preferences: [
    { kind: "mention", inbox: true, slack: true, slackDm: true },
    { kind: "assignment", inbox: true, slack: true, slackDm: true },
    { kind: "gate_awaiting", inbox: true, slack: true, slackDm: true },
    { kind: "run_awaiting_input", inbox: true, slack: false, slackDm: false },
    { kind: "run_finished", inbox: false, slack: true, slackDm: true },
  ],
  saved: [] as unknown[],
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    preferences: {
      get: async () => ({ preferences: stub.preferences }),
      set: async (input: unknown) => {
        stub.saved.push(input);
        return { preferences: stub.preferences };
      },
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("the Notifications settings page", () => {
  it("shows every kind of Notification against the inbox and Slack", async () => {
    await mountAt("/settings/notifications", { memberName: "Ada" });

    expect(await screen.findByText("Gate awaiting")).toBeTruthy();
    expect(
      (screen.getByLabelText("Run awaiting input in Slack") as HTMLInputElement).ariaChecked,
    ).toBe("false");
    expect(
      (screen.getByLabelText("Run finished in the inbox") as HTMLInputElement).ariaChecked,
    ).toBe("false");
  });

  it("saves the whole matrix when a Human turns one of them off", async () => {
    await mountAt("/settings/notifications", { memberName: "Ada" });

    fireEvent.click(await screen.findByLabelText("Gate awaiting in Slack"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(stub.saved).toHaveLength(1));
    const [saved] = stub.saved as [{ preferences: Array<Record<string, unknown>> }];
    expect(saved.preferences).toHaveLength(5);
    expect(saved.preferences).toContainEqual({
      kind: "gate_awaiting",
      inbox: true,
      slack: false,
      slackDm: true,
    });
  });

  it("offers a direct message in Slack beside the room, and saves it", async () => {
    stub.saved = [];
    await mountAt("/settings/notifications", { memberName: "Ada" });

    const dm = await screen.findByLabelText("Run awaiting input as a Slack direct message");
    expect((dm as HTMLInputElement).ariaChecked).toBe("false");
    fireEvent.click(dm);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(stub.saved).toHaveLength(1));
    const [saved] = stub.saved as [{ preferences: Array<Record<string, unknown>> }];
    expect(saved.preferences).toContainEqual({
      kind: "run_awaiting_input",
      inbox: true,
      slack: false,
      slackDm: true,
    });
    // Said beside it, because nothing is sent until an account is linked.
    expect(screen.getByText(/once your Slack account is linked/)).toBeTruthy();
  });
});
