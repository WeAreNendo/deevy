import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const stub = vi.hoisted(() => {
  const states = [
    { id: "s1", name: "Intent", position: 0, isGate: true, category: "backlog" },
    { id: "s2", name: "Spec", position: 1, isGate: true, category: "active" },
    { id: "s4", name: "Build", position: 3, isGate: false, category: "active" },
    { id: "s6", name: "Done", position: 5, isGate: false, category: "done" },
  ];
  const base = {
    id: "i1",
    key: "DEV-1",
    number: 1,
    title: "Ship it",
    description: null,
    assignee: null,
    assigneeMemberId: null,
    parentId: null,
    parent: null,
    children: [],
    closedAt: null,
    project: { id: "p1", key: "DEV", name: "deevy" },
    gateDecisions: [],
    labels: [],
  };
  return {
    states,
    inGate: {
      ...base,
      state: states[0],
      gateDecisions: [
        {
          id: "g1",
          decision: "rejected",
          note: "Needs rethinking",
          stateId: "s1",
          createdAt: new Date(),
          documents: [{ name: "spec", version: 1 }],
        },
        // An approval whose text has been written again since: the Document is
        // at v3 below, and the approval was of v2.
        {
          id: "g2",
          decision: "approved",
          note: null,
          stateId: "s1",
          createdAt: new Date(),
          documents: [{ name: "spec", version: 2 }],
        },
      ],
    },
    inBuild: { ...base, key: "DEV-2", id: "i2", state: states[2] },
    // A Gate wanting two Humans, one of them already given
    partly: {
      ...base,
      key: "DEV-3",
      id: "i3",
      state: states[0],
      gate: {
        required: 2,
        eligible: 3,
        excludeRequester: false,
        approvals: [{ memberId: "m2", name: "Grace Hopper", note: "Looks right" }],
        mayApprove: true,
        refusedBecause: null,
        clearedByAnEdit: 1,
      },
    },
    // The same Gate, to the Human who brought the Issue to it
    asRequester: {
      ...base,
      key: "DEV-4",
      id: "i4",
      state: states[0],
      gate: {
        required: 1,
        eligible: 2,
        excludeRequester: true,
        approvals: [],
        mayApprove: false,
        refusedBecause: "requester",
      },
    },
    // And a Gate nobody left can open
    stuck: {
      ...base,
      key: "DEV-5",
      id: "i5",
      state: states[0],
      gate: {
        required: 3,
        eligible: 1,
        excludeRequester: false,
        approvals: [],
        mayApprove: false,
        refusedBecause: "too_few_humans",
      },
    },
    approved: [] as unknown[],
    rejected: [] as unknown[],
    moved: [] as unknown[],
  };
});

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const byKey: Record<string, unknown> = {
    "DEV-1": stub.inGate,
    "DEV-2": stub.inBuild,
    "DEV-3": stub.partly,
    "DEV-4": stub.asRequester,
    "DEV-5": stub.stuck,
  };
  const client = stubClient({
    projects: {
      get: async () => ({
        id: "p1",
        key: "DEV",
        name: "deevy",
        description: null,
        team: null,
        archivedAt: null,
        states: stub.states,
      }),
    },
    workflow: { get: async () => ({ states: stub.states }) },
    documents: {
      list: async () => ({ documents: [{ name: "spec", currentVersion: 3 }] }),
    },
    issues: {
      get: async ({ key }: { key: string }) => byKey[key],
      move: async (input: unknown) => {
        stub.moved.push(input);
        return stub.inBuild;
      },
    },
    gates: {
      approve: async (input: unknown) => {
        stub.approved.push(input);
        return stub.inGate;
      },
      reject: async (input: unknown) => {
        stub.rejected.push(input);
        return stub.inGate;
      },
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("an Issue sitting in a Gate", () => {
  it("offers Approve and Reject instead of a State picker", async () => {
    await mountAt("/issues/DEV-1", { memberName: "Ada" });

    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.queryByLabelText("State")).toBeNull();
  });

  it("sends the note along with the approval", async () => {
    await mountAt("/issues/DEV-1", { memberName: "Ada" });

    fireEvent.change(await screen.findByLabelText("Note"), {
      target: { value: "Worth doing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(stub.approved).toContainEqual(
        expect.objectContaining({ key: "DEV-1", note: "Worth doing" }),
      ),
    );
  });

  it("is highlighted and scrolled to when a deevy link names it", async () => {
    // jsdom implements no scrolling, so the call itself is what a link
    // handing a Human straight to a Gate can be checked by.
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;

    await mountAt("/issues/DEV-1?gate=s1", { memberName: "Ada" });

    const panel = await screen.findByRole("group", { name: /Intent Gate/i });
    expect(panel.dataset.focused).toBe("true");
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
  });

  it("puts the ruling in front of the Human the link was for", async () => {
    await mountAt("/issues/DEV-1?gate=s1", { memberName: "Ada" });

    // The page has a second live region for what it is saving, so the banner
    // is found by what it says rather than by being the only one.
    const banner = (await screen.findByText(/Waiting on your ruling/)).closest(
      '[role="status"]',
    ) as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.textContent).toMatch(/Intent/);
    expect(within(banner).getByRole("button", { name: "Rule now" })).toBeTruthy();
  });

  it("is left alone when the link names a State the Issue has moved on from", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;

    await mountAt("/issues/DEV-1?gate=s2", { memberName: "Ada" });

    const panel = await screen.findByRole("group", { name: /Intent Gate/i });
    expect(panel.dataset.focused).toBeUndefined();
    expect(scrolled).not.toHaveBeenCalled();
  });

  it("shows the decisions already made on it", async () => {
    await mountAt("/issues/DEV-1", { memberName: "Ada" });

    const decisions = await screen.findByRole("list", { name: "Gate decisions" });
    expect(within(decisions).getByText(/Needs rethinking/)).toBeTruthy();
  });

  it("says when an approval was cleared by an edit, where the buttons are", async () => {
    await mountAt("/issues/DEV-3", { memberName: "Ada" });

    const panel = await screen.findByRole("group", { name: /Intent Gate/i });
    expect(within(panel).getByText(/An approval was cleared/)).toBeTruthy();
    expect(within(panel).getByText(/asking again/)).toBeTruthy();
  });

  it("says which version of a Document was ruled on, and when it has moved on since", async () => {
    await mountAt("/issues/DEV-1", { memberName: "Ada" });

    const decisions = await screen.findByRole("list", { name: "Gate decisions" });
    expect(within(decisions).getByText("on spec v1")).toBeTruthy();
    expect(within(decisions).getByText("on spec v2")).toBeTruthy();
    // Only the approval is warned about: a rejection is meant to be rewritten.
    const written = await within(decisions).findAllByText(/Written since/);
    expect(written).toHaveLength(1);
    expect(written[0]?.textContent).toMatch(/spec \(now v3\)/);
  });
});

describe("an Issue in a State that is not a Gate", () => {
  it("offers a State picker rather than Approve and Reject", async () => {
    await mountAt("/issues/DEV-2", { memberName: "Ada" });

    expect(await screen.findByLabelText("State")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});

describe("the Workflow editor", () => {
  it("lists the States in order with their category and Gate flag", async () => {
    await mountAt("/projects/DEV/settings/workflow", { memberName: "Ada" });

    const list = await screen.findByRole("list", { name: "States" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    // Master–detail: the first State's form sits beside the list, not inside it.
    expect(screen.getAllByDisplayValue("Intent")).toHaveLength(1);
  });
});

describe("a Gate that wants more than one Human", () => {
  it("says how many it wants, and who has already agreed", async () => {
    await mountAt("/issues/DEV-3", { memberName: "Ada" });

    const panel = await screen.findByRole("group", { name: /Intent Gate/i });
    expect(panel.textContent).toMatch(/needs 2 Humans to agree, and 1 has/);
    const approvals = within(panel).getByRole("list", { name: "Approvals" });
    expect(approvals.textContent).toMatch(/Grace Hopper/);
    expect(approvals.textContent).toMatch(/Looks right/);
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(false);
  });

  it("will not take the approval of the Human who asked, and says why", async () => {
    await mountAt("/issues/DEV-4", { memberName: "Ada" });

    const panel = await screen.findByRole("group", { name: /Intent Gate/i });
    expect(panel.textContent).toMatch(/You brought DEV-4 here, so this Gate asks somebody else/);
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);
    // A rejection is still theirs to make: one is enough to end it.
    expect(screen.getByRole("button", { name: "Reject" }).hasAttribute("disabled")).toBe(false);
  });

  it("states the arithmetic when nobody left could open it", async () => {
    await mountAt("/issues/DEV-5", { memberName: "Ada" });

    const panel = await screen.findByRole("group", { name: /Intent Gate/i });
    expect(panel.textContent).toMatch(/wants 3 approvals and only 1 Human could give one/);
    expect(panel.textContent).toMatch(/Ask an admin/);
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);
  });
});
