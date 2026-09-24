import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

/** A record as a Notification carries one: the tracker's key, title and URL (ADR-0024). */
const shipIt = {
  id: "iss_000000001",
  externalKey: "acme/deevy#1",
  title: "Ship it",
  url: "https://example.com/acme/deevy/issues/1",
};
const decide = {
  id: "iss_000000002",
  externalKey: "acme/deevy#2",
  title: "Needs a decision",
  url: "https://example.com/acme/deevy/issues/2",
};

const stub = vi.hoisted(() => ({
  notifications: [] as Record<string, unknown>[],
  read: [] as unknown[],
  allRead: 0,
  /** When set, a markRead also flips readAt, as the server's list would show it. */
  persistReads: false,
}));

stub.notifications = [
  {
    id: "n1",
    kind: "assignment",
    readAt: null,
    createdAt: new Date(),
    eventId: 9,
    issue: shipIt,
    event: {
      kind: "issue.assigned",
      payload: { from: null, to: "me", byRouting: true },
      actorMemberId: "m-ada",
    },
    actor: { id: "m-ada", kind: "human", handle: "ada", user: { name: "Ada", image: null } },
    comment: null,
  },
  {
    id: "n2",
    kind: "mention",
    readAt: new Date(),
    createdAt: new Date(),
    eventId: 8,
    issue: shipIt,
    event: { kind: "comment.created", payload: { commentId: "c1" }, actorMemberId: "m-grace" },
    actor: {
      id: "m-grace",
      kind: "human",
      handle: "grace",
      user: { name: "Grace", image: null },
    },
    comment: { id: "c1", body: "Look at this before Friday, @ada" },
  },
  {
    id: "n3",
    kind: "gate_awaiting",
    readAt: null,
    createdAt: new Date(),
    eventId: 7,
    issue: decide,
    event: {
      kind: "run.awaiting_input",
      // What makes this a Gate rather than a question: the request it is
      // about, which is what the right pane opens (notifications.ts).
      payload: { gateRequestId: "gate_stub00000", checkpoint: "ship" },
      actorMemberId: "m-planner",
    },
    actor: {
      id: "m-planner",
      kind: "agent",
      handle: "planner",
      user: { name: "Planner", image: null },
    },
    comment: null,
  },
];

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient, stubIssue } = await import("./stub-client.ts");
  const client = stubClient({
    // The right pane reads the record itself rather than the copy the
    // Notification carries: one shape for a record, whoever asked for it.
    issues: {
      get: async (input: { issue: string }) => ({
        ...stubIssue,
        id: input.issue,
        title: input.issue === shipIt.id ? shipIt.title : decide.title,
        externalKey: input.issue === shipIt.id ? shipIt.externalKey : decide.externalKey,
        url: input.issue === shipIt.id ? shipIt.url : decide.url,
        children: [],
        parent: null,
      }),
    },
    inbox: {
      // Fresh rows each time: a row marked read in place would look unchanged
      // to the query's structural sharing, and the list would not re-render.
      list: async () => ({
        notifications: stub.notifications.map((row) => ({ ...row })),
        nextCursor: 7,
      }),
      unreadCount: async () => ({ unread: 2 }),
      markRead: async (input: { ids: string[] }) => {
        stub.read.push(input);
        if (stub.persistReads) {
          for (const row of stub.notifications) {
            if (input.ids.includes(row.id as string)) row.readAt = new Date();
          }
        }
        return { read: 1 };
      },
      markAllRead: async () => {
        stub.allRead += 1;
        return { read: 2 };
      },
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("the inbox", () => {
  it("says who did what on which record, and quotes what they wrote", async () => {
    await mountAt("/inbox", { memberName: "Ada" });

    const list = await screen.findByRole("list", { name: "Notifications" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText(/wants your ruling/)).toBeTruthy();
    expect(within(list).getByText("mentioned you")).toBeTruthy();
    expect(within(list).getByText(/Look at this before Friday/)).toBeTruthy();
    expect(within(list).getByText("routed it to you")).toBeTruthy();
    // The key is the tracker's, and it is what names the record on every row.
    expect(within(list).getAllByText("acme/deevy#1")).toHaveLength(2);
    expect(within(list).getByText("acme/deevy#2")).toBeTruthy();
  });

  it("offers Mark read only on the ones still unread", async () => {
    await mountAt("/inbox", { memberName: "Ada" });

    const list = await screen.findByRole("list", { name: "Notifications" });
    const buttons = within(list).getAllByRole("button", { name: "Mark read" });
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(stub.read).toContainEqual({ ids: ["n1"] }));
  });

  it("marks several selected rows read at once", async () => {
    await mountAt("/inbox", { memberName: "Ada" });

    await screen.findByRole("list", { name: "Notifications" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select routed it to you" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select wants your ruling/ }));
    const bar = screen.getByRole("toolbar", { name: "Selection" });
    expect(within(bar).getByText("2 selected")).toBeTruthy();

    fireEvent.click(within(bar).getByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(stub.read).toContainEqual({ ids: ["n1", "n3"] }));
  });

  it("marks everything read at once", async () => {
    await mountAt("/inbox", { memberName: "Ada" });

    fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }));

    await waitFor(() => expect(stub.allRead).toBeGreaterThan(0));
  });

  it("opens the ruling beside the list when a Gate is what is waiting", async () => {
    await mountAt("/inbox", { memberName: "Ada" });

    const list = await screen.findByRole("list", { name: "Notifications" });
    fireEvent.click(within(list).getByText(/wants your ruling/));

    // Reading is what was owed, so opening marks it read.
    await waitFor(() => expect(stub.read).toContainEqual({ ids: ["n3"] }));
    // And what was owed is a ruling, so the ruling is what opens — in front,
    // with the card focused, rather than a page to navigate to next.
    const gate = await screen.findByRole("group", { name: /ship Gate/ });
    expect(gate.getAttribute("data-focused")).toBe("true");
  });

  it("opens the record deevy knows when what is waiting is not a Gate", async () => {
    await mountAt("/inbox", { memberName: "Ada" });

    const list = await screen.findByRole("list", { name: "Notifications" });
    fireEvent.click(within(list).getByText(/routed it to you/));

    expect(await screen.findByRole("heading", { name: "Ship it" })).toBeTruthy();
  });

  it("shows only what is unread when asked", async () => {
    await mountAt("/inbox?unread=1", { memberName: "Ada" });

    const list = await screen.findByRole("list", { name: "Notifications" });
    // n2 is read, so two rows stay.
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("under Unread, j from the row just opened goes to the next unread one, not the first", async () => {
    // A fourth, unread, after the Gate one: opening n3 marks it read and drops
    // it from the list, and j must still land on n4 rather than start over at n1.
    const n1 = stub.notifications[0]!;
    const n3 = stub.notifications[2]!;
    stub.notifications.push({ ...n1, id: "n4", eventId: 6 });
    stub.persistReads = true;
    try {
      await mountAt("/inbox?unread=1", { memberName: "Ada" });
      const list = await screen.findByRole("list", { name: "Notifications" });
      expect(within(list).getAllByRole("listitem")).toHaveLength(3);

      const reads = stub.read.length;
      fireEvent.click(within(list).getByText(/wants your ruling/));
      await waitFor(() => expect(stub.read).toHaveLength(reads + 1));
      // Read now, so gone from the filtered list.
      await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));

      fireEvent.keyDown(document.body, { key: "j" });
      await waitFor(() => expect(stub.read.at(-1)).toEqual({ ids: ["n4"] }));
      expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    } finally {
      stub.persistReads = false;
      stub.notifications.pop();
      n3.readAt = null;
    }
  });
});

describe("the sidebar", () => {
  it("badges the Inbox with the unread count", async () => {
    await mountAt("/", { memberName: "Ada" });

    expect(await screen.findByLabelText("2 unread")).toBeTruthy();
  });
});
