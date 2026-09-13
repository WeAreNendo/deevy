import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const stub = vi.hoisted(() => ({
  states: [{ id: "s1", name: "Intent", position: 0, isGate: true, category: "backlog" }],
  documents: [
    { id: "d1", name: "intent", currentVersion: 2, issueId: "i1" },
    { id: "d2", name: "spec", currentVersion: 1, issueId: "i1" },
  ],
  bodies: {
    "intent:2": "## Problem\n\nThe Event log has no reader.",
    "intent:1": "## Problem",
    "spec:1": "## Requirements",
  } as Record<string, string>,
  written: [] as unknown[],
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const issue = {
    id: "i1",
    key: "DEV-1",
    title: "Ship it",
    description: null,
    state: stub.states[0],
    assignee: null,
    parent: null,
    children: [],
    gateDecisions: [],
    labels: [],
    project: { id: "p1", key: "DEV", name: "deevy" },
  };
  const client = stubClient({
    // A Document two people wrote: a Human's first version, an Agent's second.
    members: {
      list: async () => ({
        members: [
          {
            id: "m-ada",
            kind: "human",
            handle: "ada",
            suspendedAt: null,
            user: { id: "u-ada", name: "Ada", email: "ada@example.com", image: null },
          },
          {
            id: "m-planner",
            kind: "agent",
            handle: "planner",
            suspendedAt: null,
            user: {
              id: "u-planner",
              name: "Planner",
              email: "planner@agents.invalid",
              image: null,
            },
          },
        ] as never,
      }),
    },
    issues: { get: async () => issue },
    workflow: { get: async () => ({ states: stub.states }) },
    documents: {
      list: async () => ({ documents: stub.documents }),
      versions: async ({ name }: { name: string }) => ({
        versions: Array.from(
          { length: stub.documents.find((d) => d.name === name)!.currentVersion },
          (_, index) => ({
            version: index + 1,
            // The second version of the intent is the Agent's, so the byline
            // has two names to put together.
            authorMemberId: index === 1 ? "m-planner" : "m-ada",
            authorMemberIds: [index === 1 ? "m-planner" : "m-ada"],
            writtenAt: new Date("2026-09-08T10:00:00Z"),
            // v1 of the intent is the version the Intent Gate approved.
            rulings: index === 0 ? [{ decision: "approved", stateId: "s1" }] : [],
          }),
        ).reverse(),
      }),
      get: async ({ name, version }: { name: string; version?: number }) => {
        const doc = stub.documents.find((d) => d.name === name)!;
        const at = version ?? doc.currentVersion;
        return {
          ...doc,
          version: at,
          body: stub.bodies[`${name}:${at}`] ?? "",
          authorMemberId: null,
          writtenAt: new Date("2026-09-08T10:00:00Z"),
        };
      },
      write: async (input: unknown) => {
        stub.written.push(input);
        return {
          ...stub.documents[0],
          version: 3,
          body: "written",
          authorMemberId: null,
          writtenAt: new Date(),
        };
      },
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("the Documents section on an Issue", () => {
  it("shows one tab per Document and the current version, open in the editor", async () => {
    await mountAt("/issues/DEV-1", { memberName: "Ada" });

    const tabs = await screen.findByRole("tablist", { name: "Documents" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["intent", "spec"]);
    // No read mode to leave: the text is in the editor from the start.
    const body = (await screen.findByLabelText("Body")) as HTMLTextAreaElement;
    await waitFor(() => expect(body.value).toContain("The Event log has no reader"));
  });

  it("names everybody who has written a version, not only the last one", async () => {
    await mountAt("/issues/DEV-1", { memberName: "Ada" });

    const written = await screen.findByText(/written by/);
    const line = written.parentElement!;
    expect(line.textContent).toContain("Ada");
    expect(line.textContent).toContain("Planner");
  });

  it("writes a version when the editor is left, saying what it was based on", async () => {
    await mountAt("/issues/DEV-1", { memberName: "Ada" });

    const body = await screen.findByLabelText("Body");
    fireEvent.change(body, { target: { value: "## Problem\n\nRewritten." } });
    // Leaving the editor is the save; there is no button to press.
    fireEvent.blur(body.closest('[data-slot="markdown-editor-frame"]')!);

    await waitFor(() =>
      expect(stub.written).toContainEqual(
        expect.objectContaining({
          name: "intent",
          body: "## Problem\n\nRewritten.",
          baseVersion: 2,
        }),
      ),
    );
  });

  it("keeps the older versions behind the menu, and reads one there", async () => {
    await mountAt("/issues/DEV-1", { memberName: "Ada" });

    fireEvent.click(await screen.findByRole("button", { name: "More for intent" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /History/ }));

    const history = await screen.findByRole("dialog", { name: /intent/ });
    const versions = within(history).getByRole("list", { name: "Versions of intent" });
    expect(within(versions).getAllByRole("button")).toHaveLength(2);

    // The version a Gate ruled on says so, however far the Document has moved.
    const older = within(versions).getAllByRole("button")[1]!;
    expect(within(older).getByText("approved")).toBeTruthy();

    fireEvent.click(older);
    expect(await within(history).findByRole("button", { name: "Restore v1" })).toBeTruthy();
  });
});
