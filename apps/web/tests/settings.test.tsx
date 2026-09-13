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
    { id: "r-2", kind: "github_org", value: "acme", createdAt: new Date() },
    { id: "r-3", kind: "gitlab_group", value: "acme/platform", createdAt: new Date() },
  ],
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    members: { list: async () => ({ members: stub.members }) },
    allowlist: { list: async () => ({ rules: stub.rules }) },
    workspace: {
      get: async () => ({
        id: "w1",
        name: "deevy",
        slug: "deevy",
        maxChildrenPerIssue: 20,
        maxDelegationDepth: 3,
        maxOpenDescendants: 50,
        createdAt: new Date("2026-09-06"),
      }),
      update: async (input: Record<string, unknown>) => {
        stub.saved.push(input);
        return {
          id: "w1",
          name: "deevy",
          slug: "deevy",
          maxChildrenPerIssue: 20,
          maxDelegationDepth: 3,
          maxOpenDescendants: 50,
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
  it("shows every rule that admits a sign-in, each one droppable", async () => {
    mount(<AllowlistRow />);

    // Chips, not a table: nearly every rule is one domain, and a rule is two words.
    expect(await screen.findByText("example.com")).toBeTruthy();
    expect(screen.getByText("acme")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop allowing example.com" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop allowing acme" })).toBeTruthy();
    // A bare path says nothing about which namespace it is in, so a chip that
    // is not an email domain wears the word (docs/plans/sign-in.md slice 5).
    expect(screen.getByText("acme/platform")).toBeTruthy();
    expect(screen.getByText("group")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop allowing acme/platform" })).toBeTruthy();
  });

  it("keeps the form for a new rule behind Add rule", async () => {
    mount(<AllowlistRow />);

    await screen.findByText("example.com");
    expect(screen.queryByLabelText("Match on")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

    expect(await screen.findByLabelText("Match on")).toBeTruthy();
    expect(screen.getByLabelText("Domain")).toBeTruthy();
  });
});

describe("how far an Agent may split work", () => {
  it("shows the three ceilings this Workspace is set to", async () => {
    mount(<DelegationRow />);

    expect(await screen.findByLabelText("Sub-issues each")).toHaveProperty("value", "20");
    expect(screen.getByLabelText("Levels deep")).toHaveProperty("value", "3");
    expect(screen.getByLabelText("Open in one tree")).toHaveProperty("value", "50");
    // They are about Agents, and a Human reading the page should not wonder
    // whether they are about to be stopped by one.
    expect(screen.getByText(/do not apply to you/)).toBeTruthy();
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
