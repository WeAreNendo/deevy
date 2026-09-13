import { loadMarkdown, markdownOf } from "@deevy/editor";
import { render, screen, waitFor } from "@testing-library/react";
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { describe, expect, it } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MarkdownEditor } from "../src/components/markdown-editor.tsx";
import { Present } from "../src/components/present.tsx";
import { presenceIn, RoomsContext, type Room } from "../src/lib/rooms.tsx";

/**
 * A room without a socket: the same Yjs document and awareness the real one
 * hands over, so the editor cannot tell the difference and a test never opens a
 * connection.
 */
function roomWith(markdown: string, status: Room["status"] = "connected") {
  const doc = new Y.Doc();
  loadMarkdown(doc, markdown);
  const awareness = new Awareness(doc);
  const room: Room = { doc, awareness, status };
  return { room, doc, awareness };
}

function mount(room: Room | null, props: Partial<Parameters<typeof MarkdownEditor>[0]> = {}) {
  return render(
    <RoomsContext.Provider value={{ roomFor: () => room, ready: true }}>
      <MarkdownEditor
        room="document:DEV-1:intent"
        value="what the server last knew"
        onChange={() => {}}
        aria-label="Body"
        {...props}
      />
    </RoomsContext.Provider>,
  );
}

describe("who else is in the Document", () => {
  it("shows the others and never yourself", () => {
    const { room, awareness } = roomWith("Words.");
    // This browser, and somebody else's, in the same awareness.
    awareness.setLocalStateField("member", { id: "m-ada", name: "Ada", kind: "human" });
    // Her own document, so her own client id: two browsers, not one twice.
    const grace = new Awareness(new Y.Doc());
    grace.setLocalStateField("member", { id: "m-grace", name: "Grace", kind: "human" });
    applyAwarenessUpdate(
      awareness,
      encodeAwarenessUpdate(grace, [grace.clientID]),
      "test" as unknown as null,
    );

    const here = presenceIn(room);

    expect(here.find((one) => one.id === "m-ada")?.self).toBe(true);
    expect(here.find((one) => one.id === "m-grace")).toMatchObject({ name: "Grace", self: false });
  });

  it("is nobody when there is no room", () => {
    expect(presenceIn(null)).toEqual([]);
  });
});

describe("an Agent writing into a room", () => {
  it("says so, rather than being drawn a caret nobody can follow", async () => {
    const { room, awareness } = roomWith("The spec.");
    // An Agent never joins a room (ADR-0021). What the room carries is the
    // server saying one has just written into it.
    const planner = new Awareness(new Y.Doc());
    planner.setLocalState({
      member: { id: "m-planner", name: "Planner", kind: "agent" },
      wroteAt: Date.now(),
    });
    applyAwarenessUpdate(
      awareness,
      encodeAwarenessUpdate(planner, [planner.clientID]),
      "test" as unknown as null,
    );

    render(
      <QueryClientProvider client={new QueryClient()}>
        <RoomsContext.Provider value={{ roomFor: () => room, ready: true }}>
          <Present room="document:DEV-1:intent" />
        </RoomsContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Planner just wrote this/)).toBeTruthy();
  });

  it("stops saying it once the moment has passed", () => {
    const { room, awareness } = roomWith("The spec.");
    const planner = new Awareness(new Y.Doc());
    planner.setLocalState({
      member: { id: "m-planner", name: "Planner", kind: "agent" },
      // Long enough ago that the reader has seen the paragraphs change.
      wroteAt: Date.now() - 60_000,
    });
    applyAwarenessUpdate(
      awareness,
      encodeAwarenessUpdate(planner, [planner.clientID]),
      "test" as unknown as null,
    );

    render(
      <QueryClientProvider client={new QueryClient()}>
        <RoomsContext.Provider value={{ roomFor: () => room, ready: true }}>
          <Present room="document:DEV-1:intent" />
        </RoomsContext.Provider>
      </QueryClientProvider>,
    );

    expect(screen.queryByText(/just wrote this/)).toBeNull();
  });
});

describe("an editor in a room", () => {
  it("shows what the room holds rather than what the page was handed", async () => {
    const { room } = roomWith("## Problem\n\nWhat the room holds.");

    mount(room);

    // The live text wins: `value` is what the page loaded with, and the room
    // knows better by the time the editor is on screen.
    const rich = await screen.findByRole("textbox", { name: "Body" });
    await waitFor(() => expect(rich.textContent).toContain("What the room holds."));
    expect(rich.textContent).not.toContain("what the server last knew");
  });

  it("writes what is typed into the room, not through the page", async () => {
    const { room, doc } = roomWith("Before.");
    let told = "";

    mount(room, { onChange: (markdown) => (told = markdown) });
    await screen.findByRole("textbox", { name: "Body" });

    // What the editor puts in the document is what the server will version.
    loadMarkdown(doc, "Before. And after.");
    await waitFor(() => expect(markdownOf(doc)).toBe("Before. And after."));
    // The page is not asked to save anything: the room does that.
    expect(told).toBe("");
  });

  it("says so when the connection is gone, and keeps the words", async () => {
    const { room } = roomWith("Still here.", "disconnected");

    mount(room);

    expect(await screen.findByText(/Offline/i)).toBeTruthy();
    const rich = await screen.findByRole("textbox", { name: "Body" });
    await waitFor(() => expect(rich.textContent).toContain("Still here."));
  });

  it("is the plain editor when there is no room to join", async () => {
    mount(null, { value: "## Just markdown" });

    const source = screen.getByLabelText("Body", { selector: "textarea" }) as HTMLTextAreaElement;
    expect(source.value).toBe("## Just markdown");
    expect(screen.queryByText(/Offline/i)).toBeNull();
  });
});
