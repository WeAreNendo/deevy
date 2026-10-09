import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const stub = vi.hoisted(() => ({
  preferences: [
    { kind: "mention", inbox: true, slack: true, slackDm: true, email: false },
    { kind: "assignment", inbox: true, slack: true, slackDm: true, email: false },
    { kind: "gate_awaiting", inbox: true, slack: true, slackDm: true, email: true },
    { kind: "run_awaiting_input", inbox: true, slack: false, slackDm: false, email: true },
    { kind: "run_finished", inbox: false, slack: true, slackDm: true, email: false },
  ],
  /** Where deevy would email this Human; null when their sign-in did not verify it. */
  emailAddress: "ada@example.com" as string | null,
  saved: [] as unknown[],
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    preferences: {
      get: async () => ({ preferences: stub.preferences, emailAddress: stub.emailAddress }),
      set: async (input: unknown) => {
        stub.saved.push(input);
        return { preferences: stub.preferences, emailAddress: stub.emailAddress };
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

  it("offers email beside Slack, says where it goes, and saves it", async () => {
    stub.saved = [];
    stub.emailAddress = "ada@example.com";
    await mountAt("/settings/notifications", { memberName: "Ada" });

    const gate = await screen.findByLabelText("Gate awaiting by email");
    expect((gate as HTMLInputElement).ariaChecked).toBe("true");
    const mention = screen.getByLabelText("Mention by email");
    expect((mention as HTMLInputElement).ariaChecked).toBe("false");
    expect(screen.getByText(/ada@example\.com/)).toBeTruthy();

    fireEvent.click(mention);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(stub.saved).toHaveLength(1));
    const [saved] = stub.saved as [{ preferences: Array<Record<string, unknown>> }];
    expect(saved.preferences).toContainEqual({
      kind: "mention",
      inbox: true,
      slack: true,
      slackDm: true,
      email: true,
    });
  });

  it("says why it cannot email a Human whose sign-in did not confirm their address", async () => {
    stub.emailAddress = null;
    await mountAt("/settings/notifications", { memberName: "Ada" });

    const gate = await screen.findByLabelText("Gate awaiting by email");
    expect(
      (gate as HTMLElement).getAttribute("aria-disabled") ??
        (gate as HTMLInputElement).disabled.toString(),
    ).toMatch(/true/);
    expect(screen.getByText(/didn.t confirm your email address/)).toBeTruthy();
    stub.emailAddress = "ada@example.com";
  });

  it("sends only the email switches a Human changed, so a default stays a default", async () => {
    stub.saved = [];
    stub.emailAddress = "ada@example.com";
    await mountAt("/settings/notifications", { memberName: "Ada" });

    fireEvent.click(await screen.findByLabelText("Mention by email"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(stub.saved).toHaveLength(1));
    const [saved] = stub.saved as [{ preferences: Array<Record<string, unknown>> }];
    expect(saved.preferences.find((row) => row.kind === "mention")).toMatchObject({ email: true });
    // Untouched: left out, so the server keeps what it had, default or choice.
    expect(saved.preferences.find((row) => row.kind === "gate_awaiting")).not.toHaveProperty(
      "email",
    );
  });
});
