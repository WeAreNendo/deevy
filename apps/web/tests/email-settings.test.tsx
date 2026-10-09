import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

/**
 * Settings › Email (docs/plans/email-channel.md, slice 3): which sender this
 * Workspace sends through, where that was set, a test email, and a form that
 * sets it here over the environment's.
 */
const stub = vi.hoisted(() => ({
  status: {
    sender: "resend" as string | null,
    from: "deevy <env@example.com>" as string | null,
    source: "environment" as "environment" | "settings" | null,
    runnable: true,
    problem: null as string | null,
    available: ["resend"],
    config: {} as Record<string, string>,
    limit: null as { perDay: number; sent: number; waiting: number; nextAt: Date | null } | null,
  },
  configured: [] as unknown[],
  cleared: 0,
  tested: 0,
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    email: {
      status: async () => stub.status,
      configure: async (input: { sender: string; from: string }) => {
        stub.configured.push(input);
        return { ...stub.status, sender: input.sender, from: input.from, source: "settings" };
      },
      clear: async () => {
        stub.cleared += 1;
        return { ...stub.status, source: "environment" };
      },
      test: async () => {
        stub.tested += 1;
        return { delivered: true, status: 200, error: null, to: "ada@example.com" };
      },
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("Settings › Email", () => {
  it("says which sender is in force, as whom, and where it was set", async () => {
    await mountAt("/settings/email", { memberName: "Ada" });

    expect(await screen.findByText(/Sending through Resend/)).toBeTruthy();
    expect(screen.getByText(/deevy <env@example\.com>/)).toBeTruthy();
    expect(screen.getByText(/set in this deployment's environment/)).toBeTruthy();
  });

  it("sends a test email to the admin, and says where it went", async () => {
    await mountAt("/settings/email", { memberName: "Ada" });

    fireEvent.click(await screen.findByRole("button", { name: "Send a test email" }));

    await waitFor(() => expect(stub.tested).toBe(1));
    expect(await screen.findByText(/Sent to ada@example\.com/)).toBeTruthy();
  });

  it("sets the sender here, with its key, over the environment's", async () => {
    await mountAt("/settings/email", { memberName: "Ada" });

    const form = await screen.findByRole("form", { name: "Set the sender here" });
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "deevy <deevy@example.com>" },
    });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "re_not_a_real_key" } });
    fireEvent.submit(form);

    await waitFor(() =>
      expect(stub.configured).toContainEqual({
        sender: "resend",
        from: "deevy <deevy@example.com>",
        config: {},
        credentials: { apiKey: "re_not_a_real_key" },
      }),
    );
  });

  it("goes back to the environment's sender when the one set here is cleared", async () => {
    stub.status = { ...stub.status, source: "settings", from: "deevy <settings@example.com>" };
    await mountAt("/settings/email", { memberName: "Ada" });

    fireEvent.click(await screen.findByRole("button", { name: "Use the environment's sender" }));

    await waitFor(() => expect(stub.cleared).toBe(1));
    stub.status = { ...stub.status, source: "environment", from: "deevy <env@example.com>" };
  });

  it("says why nothing can be sent", async () => {
    const before = stub.status;
    stub.status = {
      ...before,
      sender: null,
      from: null,
      source: null,
      runnable: false,
      problem: "No email sender is configured.",
    };
    await mountAt("/settings/email", { memberName: "Ada" });

    expect(await screen.findByText("No email sender is configured.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send a test email" })).toHaveProperty(
      "disabled",
      true,
    );
    stub.status = before;
  });

  it("offers a sender that can be chosen here, never the development stand-in in force", async () => {
    const before = stub.status;
    stub.status = { ...before, sender: "stub", from: "deevy <deevy@example.com>" };
    await mountAt("/settings/email", { memberName: "Ada" });

    expect(await screen.findByText("Sender: Resend")).toBeTruthy();
    expect(screen.getByLabelText("API key")).toBeTruthy();
    stub.status = before;
  });

  it("says how many emails a day this Workspace may send, when the deployment limits it", async () => {
    const before = stub.status;
    stub.status = { ...before, limit: { perDay: 500, sent: 12, waiting: 0, nextAt: null } };
    await mountAt("/settings/email", { memberName: "Ada" });
    expect(
      await screen.findByText("You can send 500 emails a day; 12 went in the last 24 hours."),
    ).toBeTruthy();
    stub.status = before;
  });

  it("says how many emails wait once the day's are sent, and when they go", async () => {
    const before = stub.status;
    stub.status = {
      ...before,
      limit: {
        perDay: 500,
        sent: 500,
        waiting: 3,
        nextAt: new Date(Date.now() + 3 * 60 * 60_000 + 60_000),
      },
    };
    await mountAt("/settings/email", { memberName: "Ada" });
    expect(
      await screen.findByText(
        "You've sent the 500 emails you can send in a day. 3 emails wait and will go out in 3 hours.",
      ),
    ).toBeTruthy();
    stub.status = before;
  });
});
