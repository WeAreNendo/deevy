import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

/**
 * The ruling screen (docs/plans/sockets.md, slice 3).
 *
 * A Gate is where a Human decides, so this page has to say four things without
 * being read twice: what the Agent proposes, where the work is, where the
 * arithmetic stands, and whether this Human may rule at all. The last one is
 * the server's answer, not the page's, so the reason a button is disabled is
 * the reason the API would refuse it.
 */
const calls = vi.hoisted(() => ({
  approve: vi.fn(async (_input: { requestId: string; note?: string }) => ({})),
  reject: vi.fn(async (_input: { requestId: string; note?: string }) => ({})),
}));

const state = vi.hoisted(() => ({
  you: { mayRule: true, hasRuled: false, why: null as string | null },
}));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient, stubGate, stubIssue, stubRun } = await import("./stub-client.ts");
  const client = stubClient({
    gates: {
      get: async () =>
        stubGate({
          policy: {
            id: "chk_1",
            name: "ship",
            approvalsRequired: 2,
            excludeRequester: true,
            approverMemberIds: [],
          },
          approvals: 1,
          links: [{ url: "https://github.test/acme/deevy/pull/7", title: "Pull request 7" }],
          decisions: [
            {
              id: "dec_1",
              memberId: "m-bob",
              decision: "approved",
              note: "Reads right",
              via: "socket",
              socket: { id: "sock_1", provider: "github", name: "acme on GitHub" },
              createdAt: new Date("2026-09-20T09:00:00Z"),
            },
          ],
          you: state.you,
        }),
      approve: calls.approve,
      reject: calls.reject,
    },
    issues: {
      get: async () => ({
        ...stubIssue,
        title: "Checkout rewrite",
        externalKey: "acme/deevy#42",
        url: "https://github.test/acme/deevy/issues/42",
      }),
    },
    runs: {
      get: async () => ({
        ...stubRun(),
        activities: [
          {
            id: "act_1",
            runId: "run_stub000000",
            kind: "thought",
            body: "Reading the totals code",
            payload: null,
            createdAt: new Date("2026-09-20T08:00:00Z"),
          },
        ],
      }),
      list: async () => ({ runs: [stubRun()], nextCursor: null }),
    },
    members: {
      list: async () => ({
        members: [
          {
            id: "m-bob",
            role: "member",
            kind: "human",
            handle: "bob",
            suspendedAt: null,
            user: { id: "u-bob", name: "Bob Bell", email: "bob@example.com", image: null },
          },
          {
            id: "m-planner",
            role: "member",
            kind: "agent",
            handle: "planner",
            suspendedAt: null,
            user: { id: "u-p", name: "Planner", email: "planner@agents.invalid", image: null },
          },
        ],
      }),
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("the Gate a Human opens", () => {
  it("shows what is proposed, where the work is, and where the count stands", async () => {
    state.you = { mayRule: true, hasRuled: false, why: null };
    await mountAt("/gates/gate_stub00000");

    expect(await screen.findByRole("heading", { name: "Checkout rewrite" })).toBeTruthy();
    // The record lives in the tracker, so its key is a way out rather than a
    // way in (ADR-0024): a link that opens it where it is.
    const out = screen.getByRole("link", { name: /acme\/deevy#42/ });
    expect(out.getAttribute("href")).toBe("https://github.test/acme/deevy/issues/42");
    expect(out.getAttribute("rel")).toContain("noopener");

    expect(screen.getByRole("heading", { name: /What I will do/ })).toBeTruthy();
    const gate = await screen.findByRole("group", { name: /ship Gate/ });
    expect(within(gate).getByText("1 of 2")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Pull request 7/ })).toBeTruthy();
  });

  it("names the door a Ruling came through", async () => {
    state.you = { mayRule: true, hasRuled: false, why: null };
    await mountAt("/gates/gate_stub00000");

    const ruled = await screen.findByRole("list", { name: "Gate decisions" });
    expect(within(ruled).getByText(/Bob Bell/)).toBeTruthy();
    expect(within(ruled).getByText(/via GitHub/)).toBeTruthy();
    expect(within(ruled).getByText(/Reads right/)).toBeTruthy();
  });

  it("rules by keyboard: ⇧A chooses, ⌘↵ commits, and the Note goes with it", async () => {
    state.you = { mayRule: true, hasRuled: false, why: null };
    calls.approve.mockClear();
    await mountAt("/gates/gate_stub00000");
    const gate = await screen.findByRole("group", { name: /ship Gate/ });

    fireEvent.keyDown(document.body, { key: "A", shiftKey: true });
    const note = within(gate).getByLabelText("Note");
    expect(document.activeElement).toBe(note);
    fireEvent.change(note, { target: { value: "One flag at a time" } });
    fireEvent.keyDown(note, { key: "Enter", metaKey: true });

    await waitFor(() => expect(calls.approve).toHaveBeenCalledTimes(1));
    expect(calls.approve.mock.calls[0]?.[0]).toMatchObject({
      requestId: "gate_stub00000",
      note: "One flag at a time",
    });
  });

  it("says why it will not take a ruling from this Human, rather than failing on the click", async () => {
    state.you = {
      mayRule: false,
      hasRuled: false,
      why: "The ship Checkpoint wants somebody other than the Human this Run is for",
    };
    await mountAt("/gates/gate_stub00000");

    const gate = await screen.findByRole("group", { name: /ship Gate/ });
    expect(within(gate).getByText(/somebody other than the Human/)).toBeTruthy();
    expect(within(gate).getByRole("button", { name: "Approve" })).toHaveProperty("disabled", true);
    expect(within(gate).getByRole("button", { name: "Reject" })).toHaveProperty("disabled", true);
  });
});
