import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Shortcut, keyLabel } from "../src/components/kbd-hint.tsx";
import { MemberChip } from "../src/components/member-chip.tsx";
import { RunStatus } from "../src/components/run-status.tsx";
import { activeScope, useShortcut, useShortcutScope } from "../src/lib/shortcuts.ts";

/**
 * The leaf components every screen is built from (docs/plans/ui-redesign.md).
 * A restyle that drops a Member's name, or the word a Run's status is read by,
 * fails here before it fails on a screen.
 */
describe("MemberChip", () => {
  it("shows the name and says which kind of Member it is", () => {
    render(
      <MemberChip
        member={{ id: "a", kind: "agent", handle: "planner", user: { name: "Planner" } }}
        showHandle
      />,
    );
    expect(screen.getByText("Planner")).toBeTruthy();
    expect(screen.getByText("@planner")).toBeTruthy();
    expect(document.querySelector('[data-slot="member-chip"]')?.getAttribute("data-kind")).toBe(
      "agent",
    );
  });

  it("initials a Human", () => {
    render(<MemberChip member={{ id: "h", kind: "human", user: { name: "Ada Lovelace" } }} />);
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("AL")).toBeTruthy();
  });
});

describe("RunStatus", () => {
  it("uses the words a Run is read by", () => {
    render(<RunStatus status="awaiting_input" />);
    expect(screen.getByText("Waiting for input")).toBeTruthy();
    render(<RunStatus status="stale" />);
    expect(screen.getByText("Gone quiet")).toBeTruthy();
  });
});

describe("Shortcut", () => {
  it("draws a chord as two keys in sequence", () => {
    const { container } = render(<Shortcut keys="g i" />);
    const hint = container.querySelector('[data-slot="shortcut"]');
    expect(hint?.textContent).toContain("G");
    expect(hint?.textContent).toContain("I");
    expect(hint?.textContent).toContain("then");
    // Decoration only: it never joins a button's accessible name.
    expect(hint?.getAttribute("aria-hidden")).toBe("true");
  });

  it("spells mod for the platform", () => {
    expect(["⌘", "Ctrl"]).toContain(keyLabel("mod"));
    expect(keyLabel("shift")).toBe("⇧");
    expect(keyLabel("k")).toBe("K");
  });
});

describe("shortcuts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function Probe({
    onChord,
    onLetter,
    scope,
  }: {
    onChord: () => void;
    onLetter: () => void;
    scope?: string;
  }) {
    useShortcut("g i", onChord, scope ? { scope } : {});
    useShortcut("a", onLetter, scope ? { scope } : {});
    return <input aria-label="Title" />;
  }

  it("fires a chord typed within its window, and a letter, but not while typing", () => {
    const onChord = vi.fn();
    const onLetter = vi.fn();
    render(<Probe onChord={onChord} onLetter={onLetter} />);

    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "i" });
    expect(onChord).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { key: "a" });
    expect(onLetter).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "a" });
    expect(onLetter).toHaveBeenCalledTimes(1);
  });

  it("lets the topmost scope own the keys", () => {
    const pageLetter = vi.fn();
    const sheetLetter = vi.fn();
    function Sheet() {
      useShortcutScope("sheet");
      useShortcut("a", sheetLetter, { scope: "sheet" });
      return null;
    }
    const { unmount } = render(
      <>
        <Probe onChord={() => {}} onLetter={pageLetter} />
        <Sheet />
      </>,
    );
    expect(activeScope()).toBe("sheet");
    fireEvent.keyDown(document.body, { key: "a" });
    expect(sheetLetter).toHaveBeenCalledTimes(1);
    expect(pageLetter).not.toHaveBeenCalled();
    unmount();
    expect(activeScope()).toBe("page");
  });
});
