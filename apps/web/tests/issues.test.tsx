import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { selectedLabel } from "./select.ts";

const stub = vi.hoisted(() => {
  const states = [
    { id: "s1", name: "Intent", position: 0, isGate: true, category: "backlog" },
    { id: "s4", name: "Build", position: 3, isGate: false, category: "active" },
  ];
  const ada = {
    id: "m-ada",
    role: "admin",
    handle: "ada",
    user: { id: "u-ada", name: "Ada Lovelace", email: "ada@example.com" },
  };
  const epic = {
    id: "i1",
    key: "DEV-1",
    number: 1,
    title: "Ship the Event log",
    description: "## Why\n\nEverything derives from it.",
    state: states[0],
    assignee: null,
    assigneeMemberId: null,
    parentId: null,
    parent: null,
    children: [] as unknown[],
    closedAt: null,
    updatedAt: new Date("2026-09-05T10:00:00Z"),
    project: { id: "p1", key: "DEV", name: "deevy" },
    gateDecisions: [] as unknown[],
    labels: [] as unknown[],
  };
  const child = {
    ...epic,
    id: "i2",
    key: "DEV-2",
    number: 2,
    title: "Append events",
    description: null,
    state: states[1],
    assignee: ada,
    assigneeMemberId: ada.id,
    parentId: "i1",
    parent: epic,
    children: [],
    hasOpenRun: true,
  };
  return {
    states,
    ada,
    epic: { ...epic, children: [child] },
    child,
    created: [] as unknown[],
    updated: [] as unknown[],
  };
});

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const byKey: Record<string, unknown> = { "DEV-1": stub.epic, "DEV-2": stub.child };
  const project = {
    id: "p1",
    key: "DEV",
    name: "deevy",
    description: null,
    team: null,
    archivedAt: null,
    states: stub.states,
  };
  const client = stubClient({
    members: { list: async () => ({ members: [stub.ada] }) },
    projects: {
      get: async () => project,
      // The New Issue dialog lists the Projects to match the page's against.
      list: async () => ({ projects: [project] }),
    },
    workflow: { get: async () => ({ states: stub.states }) },
    issues: {
      list: async () => ({ issues: [stub.epic, stub.child], nextCursor: 2 }),
      get: async ({ key }: { key: string }) => byKey[key] ?? Promise.reject(new Error("nope")),
      create: async (input: unknown) => {
        stub.created.push(input);
        return stub.epic;
      },
      update: async (input: unknown) => {
        stub.updated.push(input);
        return stub.epic;
      },
    },
    events: {
      list: async () => ({
        events: [
          {
            seq: 1,
            kind: "issue.created",
            actorMemberId: "m-ada",
            createdAt: new Date(),
            payload: {},
          },
          {
            seq: 2,
            kind: "issue.assigned",
            actorMemberId: "m-ada",
            createdAt: new Date(),
            payload: {},
          },
        ],
        nextCursor: 2,
      }),
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("the Project page's Issue list", () => {
  it("lists Issues by key with their State and Assignee", async () => {
    await mountAt("/projects/DEV");

    const table = await screen.findByRole("table");
    expect(within(table).getByText("DEV-1")).toBeTruthy();
    expect(within(table).getByText("Ship the Event log")).toBeTruthy();
    expect(within(table).getByText("Build")).toBeTruthy();
    expect(within(table).getByText("Ada Lovelace")).toBeTruthy();
  });

  it("creates an Issue through the top bar's dialog, in this Project", async () => {
    await mountAt("/projects/DEV");
    await screen.findByRole("table", { name: "Issues" });

    // No inline form: the dialog opens with the page's Project already chosen.
    fireEvent.click(screen.getByRole("button", { name: /new issue/i }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(selectedLabel(within(dialog).getByLabelText(/project/i))).toContain("(DEV)"),
    );
    fireEvent.change(within(dialog).getByLabelText(/title/i), {
      target: { value: "Write the migration" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^create issue$/i }));

    await waitFor(() =>
      expect(stub.created).toContainEqual(
        expect.objectContaining({ projectKey: "DEV", title: "Write the migration" }),
      ),
    );
  });
});

describe("the Issue page", () => {
  it("shows the key, title, State, and the description in its editor", async () => {
    await mountAt("/issues/DEV-1");

    expect(await screen.findByText("DEV-1")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ship the Event log", level: 1 })).toBeTruthy();
    // The State names the badge and the Gate controls, so both are expected.
    expect(screen.getAllByText("Intent").length).toBeGreaterThan(0);
    // The description is the editor now, the way a Document is: the rich view
    // renders the markdown, and the Source beside it holds what it renders.
    // Both views carry the label, so this names the one holding the source.
    const source = screen.getByLabelText("Description", {
      selector: "textarea",
    }) as HTMLTextAreaElement;
    expect(source.value).toContain("## Why");
  });

  it("lists the children and links to the parent", async () => {
    await mountAt("/issues/DEV-2");

    expect(await screen.findByRole("link", { name: /DEV-1/ })).toBeTruthy();
  });

  it("says where each sub-issue has got to, and which one has an Agent on it", async () => {
    await mountAt("/issues/DEV-1");

    // The key alone says nothing about whether anybody is on it, which is the
    // question somebody reading a parent actually has
    // (docs/plans/sub-issue-delegation.md).
    expect(await screen.findByRole("link", { name: /DEV-2/ })).toBeTruthy();
    expect(screen.getAllByText("Build").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("An Agent is working this")).toBeTruthy();
    expect(screen.getByText(/1 of 1 open/)).toBeTruthy();
  });

  it("tells the Human at the Gate that its sub-issues are unfinished, and rules anyway", async () => {
    await mountAt("/issues/DEV-1");

    // Said, not enforced: the buttons are still there.
    expect(await screen.findByText(/1 of 1 sub-issues is still open/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("renders the timeline from the Event log", async () => {
    await mountAt("/issues/DEV-1");

    const timeline = await screen.findByRole("list", { name: "Activity" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(2);
  });

  it("saves the title where it is read, with no Edit button to press", async () => {
    await mountAt("/issues/DEV-1");

    const heading = await screen.findByRole("heading", { name: "Ship the Event log" });
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(heading.getAttribute("contenteditable")).toBe("true");

    heading.textContent = "Ship it";
    fireEvent.blur(heading);

    await waitFor(() =>
      expect(stub.updated).toContainEqual(
        expect.objectContaining({ key: "DEV-1", title: "Ship it" }),
      ),
    );
  });

  it("saves the title on Enter, and only once when the blur follows", async () => {
    await mountAt("/issues/DEV-1");

    const heading = await screen.findByRole("heading", { name: "Ship the Event log" });
    heading.textContent = "Ship it on Enter";
    fireEvent.keyDown(heading, { key: "Enter" });
    fireEvent.blur(heading);

    await waitFor(() =>
      expect(
        stub.updated.filter((one) => (one as { title?: string }).title === "Ship it on Enter"),
      ).toHaveLength(1),
    );
  });

  it("puts the title back rather than saving an empty one", async () => {
    await mountAt("/issues/DEV-1");

    const heading = await screen.findByRole("heading", { name: "Ship the Event log" });
    heading.textContent = "   ";
    fireEvent.blur(heading);

    expect(heading.textContent).toBe("Ship the Event log");
    expect(stub.updated).not.toContainEqual(expect.objectContaining({ title: "" }));
  });

  it("saves the description when the editor is left", async () => {
    await mountAt("/issues/DEV-1");

    const body = await screen.findByLabelText("Description", { selector: "textarea" });
    fireEvent.change(body, { target: { value: "Why this Issue is." } });
    fireEvent.blur(body.closest('[data-slot="markdown-editor-frame"]')!);

    await waitFor(() =>
      expect(stub.updated).toContainEqual(
        expect.objectContaining({ key: "DEV-1", description: "Why this Issue is." }),
      ),
    );
  });
});
