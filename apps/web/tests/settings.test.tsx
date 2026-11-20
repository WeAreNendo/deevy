import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const stub = vi.hoisted(() => ({
  members: [
    {
      id: "m-ada",
      role: "admin",
      kind: "human",
      handle: "ada",
      suspendedAt: null,
      user: { id: "u-ada", name: "Ada Lovelace", email: "ada@example.com", image: null },
    },
    {
      id: "m-bob",
      role: "member",
      kind: "human",
      handle: "bob",
      suspendedAt: new Date(),
      user: { id: "u-bob", name: "Bob Vance", email: "bob@example.com", image: null },
    },
  ],
  saved: [] as Array<Record<string, unknown>>,
  rules: [
    { id: "r-1", kind: "email_domain", value: "example.com", createdAt: new Date() },
    { id: "r-2", kind: "email_domain", value: "acme.example", createdAt: new Date() },
  ],
  /** What this deployment signs in with, as `health.ping` reports it. */
  providers: [] as Array<{ id: string; label: string; kind: "social" }>,
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    health: {
      ping: async () => ({
        ok: true,
        time: new Date(0).toISOString(),
        devSignIn: false,
        devSockets: false,
        providers: stub.providers,
        version: null,
        live: "stream",
      }),
    },
    members: { list: async () => ({ members: stub.members }) },
    allowlist: { list: async () => ({ rules: stub.rules }) },
    workspace: {
      get: async () => ({
        id: "w1",
        name: "deevy",
        slug: "deevy",
        maxDelegationDepth: 3,
        createdAt: new Date("2026-09-06"),
      }),
      update: async (input: Record<string, unknown>) => {
        stub.saved.push(input);
        return {
          id: "w1",
          name: "deevy",
          slug: "deevy",
          maxDelegationDepth: 3,
          createdAt: new Date("2026-09-06"),
          ...input,
        };
      },
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { MembersPage } = await import("../src/routes/settings/members.tsx");
const { mount } = await import("./mount.tsx");
const { AllowlistRow } = await import("../src/routes/settings/allowlist.tsx");
const { DelegationRow } = await import("../src/routes/settings/workspace.tsx");

describe("the Members settings page", () => {
  it("lists every Member with their role and handle", async () => {
    mount(<MembersPage />);

    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Bob Vance")).toBeTruthy();
    expect(screen.getByText("@ada")).toBeTruthy();
    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
  });

  it("marks a suspended Member as suspended", async () => {
    mount(<MembersPage />);

    await waitFor(() => expect(screen.getByText("Bob Vance")).toBeTruthy());
    expect(screen.getByText("Suspended")).toBeTruthy();
  });
});

describe("the Allowlist row of Workspace › General", () => {
  it("shows every domain that admits a sign-in, each one droppable", async () => {
    mount(<AllowlistRow />);

    // Chips, not a table: a rule is one domain.
    expect(await screen.findByText("example.com")).toBeTruthy();
    expect(screen.getByText("acme.example")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop allowing example.com" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop allowing acme.example" })).toBeTruthy();
  });

  /**
   * Who may join is an address's domain or an invitation (docs/plans/simplify.md,
   * slice 10), so the form asks for a domain and nothing else.
   */
  it("keeps the form for a new domain behind Add rule, and asks for nothing else", async () => {
    mount(<AllowlistRow />);

    await screen.findByText("example.com");
    expect(screen.queryByLabelText("Domain")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

    expect(await screen.findByLabelText("Domain")).toBeTruthy();
    expect(screen.queryByLabelText("Match on")).toBeNull();
  });
});

describe("how deep sub-issues may go", () => {
  it("shows the one ceiling left, and says what a record past it gets", async () => {
    mount(<DelegationRow />);

    expect(await screen.findByLabelText("Levels deep")).toHaveProperty("value", "3");
    // The other two went in slice 6 (docs/plans/simplify.md): an Agent opens
    // sub-issues in the tracker, where deevy can count none of them.
    expect(screen.queryByLabelText("Sub-issues each")).toBeNull();
    expect(screen.queryByLabelText("Open in one tree")).toBeNull();
    expect(screen.getByText(/isn't handed to any Agent/)).toBeTruthy();
  });

  it("saves the one that changed, and only that one", async () => {
    stub.saved.length = 0;
    mount(<DelegationRow />);
    const field = await screen.findByLabelText("Levels deep");

    fireEvent.change(field, { target: { value: "5" } });
    fireEvent.blur(field);

    await waitFor(() => expect(stub.saved).toHaveLength(1));
    expect(stub.saved[0]).toEqual({ maxDelegationDepth: 5 });
  });

  it("saves nothing when the number was not touched", async () => {
    stub.saved.length = 0;
    mount(<DelegationRow />);
    const field = await screen.findByLabelText("Levels deep");

    fireEvent.focus(field);
    fireEvent.blur(field);

    expect(stub.saved).toHaveLength(0);
  });
});
