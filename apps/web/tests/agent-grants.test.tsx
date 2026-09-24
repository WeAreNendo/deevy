import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

/**
 * The Projects an Agent may see, while the answer is still coming.
 *
 * A held `projects.list` is the whole point: the picker used to read "Every
 * Project is granted" in that gap, which is a sentence about an empty variable
 * rather than about the Workspace, and it was disabled, so a reader who opened
 * it in the first moment was told there was nothing to choose.
 */
const held = vi.hoisted(() => {
  let release: (() => void) | null = null;
  const waited = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { waited, release: () => release?.() };
});

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    agents: {
      list: async () => ({
        agents: [
          {
            id: "m-planner",
            role: "member",
            kind: "agent",
            handle: "planner",
            suspendedAt: null,
            user: {
              id: "u-planner",
              name: "Planner",
              email: "planner@agents.invalid",
              image: null,
            },
            sponsor: null,
            webhookUrl: null,
            scheduleMinutes: null,
            grantedProjectIds: [],
          },
        ],
      }),
      grants: {
        list: async () => ({ projects: [] }),
        add: async () => ({ projects: [] }),
        remove: async () => ({ projects: [] }),
      },
      keys: {
        list: async () => ({ keys: [] }),
        issue: async () => ({
          id: "k-1",
          name: "ci",
          start: "deevy_sk_abcd",
          createdAt: new Date("2026-09-01T10:00:00Z"),
          lastRequestAt: null,
          expiresAt: null,
          enabled: true,
          key: "deevy_sk_once",
        }),
        revoke: async () => ({ revoked: true }),
      },
    },
    projects: {
      list: async () => {
        await held.waited;
        return {
          projects: [
            { id: "p-ops", slug: "acme-ops", name: "ops", description: null, archivedAt: null },
          ],
        };
      },
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("the Project picker on an Agent", () => {
  it("says nothing about what is granted until it knows", async () => {
    await mountAt("/settings/agents/m-planner");
    const grants = await screen.findByRole("region", { name: /projects/i });
    const picker = within(grants).getByLabelText(/grant a project/i);

    expect(picker.getAttribute("placeholder")).toBe("Choose a Project…");
    expect(picker.getAttribute("data-disabled")).toBeNull();

    held.release();

    // Once the answer is in, a Project nobody granted is there to choose.
    await waitFor(() => {
      expect(picker.getAttribute("data-disabled")).toBeNull();
    });
    expect(picker.getAttribute("placeholder")).toBe("Choose a Project…");
  });
});
