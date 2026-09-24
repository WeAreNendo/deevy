import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { pickOption, selectedLabel } from "./select.ts";

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient, stubProject } = await import("./stub-client.ts");
  const client = stubClient({
    projects: {
      list: async () => ({
        projects: [stubProject("acme-deevy", "deevy"), stubProject("acme-ops", "Operations")],
      }),
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

// shadcn's Sidebar is a div carrying data-slot, not a landmark element.
const sidebar = () => document.querySelector('[data-slot="sidebar"]') as HTMLElement;

describe("the app shell", () => {
  it("names the Workspace and the signed-in Human, and links to the two places left", async () => {
    await mountAt("/");

    await screen.findByText("Acme Team");
    expect(within(sidebar()).getByText("Acme Team")).toBeTruthy();
    expect(within(sidebar()).getByText("Ada Lovelace")).toBeTruthy();
    expect(within(sidebar()).getByRole("link", { name: /Inbox/ }).getAttribute("href")).toBe(
      "/inbox",
    );
    expect(
      within(sidebar())
        .getByRole("link", { name: /Settings/ })
        .getAttribute("href"),
    ).toBe("/settings/workspace");
  });

  it("renders what needs you at the root, and lists no work of deevy's own", async () => {
    await mountAt("/");

    const needsMe = await screen.findByRole("region", { name: "Needs me" });
    expect(within(needsMe).getByText("Nothing needs you")).toBeTruthy();
    // The records live in a tracker and are read there (ADR-0024): the rail is
    // the Workspace, the Inbox, Settings and the Member, and nothing else.
    expect(within(sidebar()).queryByRole("link", { name: /Projects/ })).toBeNull();
    expect(within(sidebar()).queryByRole("link", { name: /Issues/ })).toBeNull();
  });

  it("sends a Project's old URLs to the binding that replaced them", async () => {
    const list = await mountAt("/projects");
    expect(list.state.location.pathname).toBe("/settings/projects");

    const one = await mountAt("/projects/acme-deevy");
    expect(one.state.location.pathname).toBe("/settings/projects");
    expect(one.state.location.search).toEqual({ project: "acme-deevy" });
  });

  it("sends the Teams and Labels pages to what stands in their place", async () => {
    const teams = await mountAt("/settings/teams");
    expect(teams.state.location.pathname).toBe("/settings/members");

    const labels = await mountAt("/settings/labels");
    expect(labels.state.location.pathname).toBe("/settings/projects");
  });

  it("gives Settings its own navigation, grouped, and sends /settings to the first page", async () => {
    await mountAt("/settings");

    expect(await screen.findByRole("heading", { name: "Workspace" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Settings" });
    expect(within(nav).getByRole("link", { name: "Members" }).getAttribute("href")).toBe(
      "/settings/members",
    );
    expect(within(nav).getByRole("link", { name: "Agents" }).getAttribute("href")).toBe(
      "/settings/agents",
    );
    expect(within(nav).getByRole("link", { name: "General" }).getAttribute("href")).toBe(
      "/settings/workspace",
    );
    expect(within(nav).getByText("Agents and delivery")).toBeTruthy();
    // The primary sidebar no longer carries the eleven; they live here.
    expect(within(sidebar()).queryByRole("link", { name: "Members" })).toBeNull();
  });

  it("offers the same Settings pages in one control where the nav beside is hidden", async () => {
    const router = await mountAt("/settings/members");
    await screen.findByRole("heading", { name: "Members" });

    // Both are in the DOM; the stylesheet shows one per width (lg:hidden / hidden lg:flex).
    const compact = screen.getByRole("navigation", { name: "Settings pages" });
    expect(compact.className).toContain("lg:hidden");
    const desktop = screen.getByRole("navigation", { name: "Settings" });
    expect(desktop.className).toContain("lg:flex");

    // It says where you are without being opened — the strip it replaced could
    // scroll the page you were on out of its own navigation.
    const trigger = within(compact).getByRole("combobox", { name: "Settings page" });
    expect(selectedLabel(trigger)).toBe("Members");

    // …and opens to every page the wide nav lists, in the same four groups.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(
      within(desktop)
        .getAllByRole("link")
        .map((link) => link.textContent),
    );
    // …in the four groups the wide nav uses, named, not merely four of something.
    const listbox = screen.getByRole("listbox");
    for (const group of ["Workspace", "Work", "Agents and delivery", "You"]) {
      expect(within(listbox).getByText(group)).toBeTruthy();
    }

    await pickOption(trigger, "Event log");
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/events"));
  });

  it("sends the old /settings/allowlist to General, which now holds the Allowlist", async () => {
    await mountAt("/settings/allowlist");

    expect(await screen.findByRole("heading", { level: 1, name: "Workspace" })).toBeTruthy();
    expect(screen.getByText("Who may join")).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Settings" }).querySelector('[aria-current="page"]')
        ?.textContent,
    ).toBe("General");
  });

  it("opens the command palette on ⌘K and jumps where it is told", async () => {
    const router = await mountAt("/");

    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    const dialog = await screen.findByRole("dialog");
    // Nothing to search for here: what it jumps to are deevy's own pages.
    expect(within(dialog).getByPlaceholderText("Jump to…")).toBeTruthy();

    fireEvent.click(within(dialog).getByText("Inbox"));
    await act(async () => {
      await router.load();
    });
    expect(router.state.location.pathname).toBe("/inbox");
  });

  it("jumps on the g-chords", async () => {
    const router = await mountAt("/");

    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "s" });
    await act(async () => {
      await router.load();
    });
    expect(router.state.location.pathname).toBe("/settings/workspace");
  });

  it("opens the Member menu with the theme and sign-out in it", async () => {
    await mountAt("/");

    fireEvent.click(within(sidebar()).getByRole("button", { name: "Ada Lovelace" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Sign out/ })).toBeTruthy();
    expect(within(menu).getByRole("menuitemradio", { name: /Dark/ })).toBeTruthy();
  });
});

describe("keyboard help", () => {
  it("? opens the shortcuts sheet, and the palette lists it under Help", async () => {
    await mountAt("/");
    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    expect(await screen.findByRole("heading", { name: "Keyboard" })).toBeTruthy();
    expect(screen.getByText("Mark everything read")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    expect(await screen.findByRole("option", { name: /Keyboard shortcuts/ })).toBeTruthy();
  });

  it("? closes the sheet it opened: the open sheet owns the keys, and ? is global", async () => {
    await mountAt("/");
    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    expect(await screen.findByRole("heading", { name: "Keyboard" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Keyboard" })).toBeNull());
  });
});

describe("the breadcrumb in the top bar", () => {
  const trail = () => screen.getByRole("navigation", { name: "breadcrumb" });

  it("leads back from a Settings page to Settings", async () => {
    await mountAt("/settings/events");
    const nav = trail();
    expect(within(nav).getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(within(nav).getByText("Event log")).toBeTruthy();
  });
});

describe("what Settings offers", () => {
  it("lists no page that only redirects somewhere else", async () => {
    const { settingsNav } = await import("../src/routes/settings/layout.tsx");
    const pages = settingsNav.flatMap((group) => group.pages.map((page) => page.to));

    // Teams and Labels went with the tracker (ADR-0024) and their URLs only
    // redirect now; a navigation that offers one sends somebody in a circle.
    expect(pages).not.toContain("/settings/teams");
    expect(pages).not.toContain("/settings/labels");
    expect(pages).toContain("/settings/projects");
  });
});

describe("the way out of an empty screen", () => {
  it("never points at a URL that redirects straight back", async () => {
    const sources = await Promise.all(
      [
        import("../src/routes/settings/projects.tsx?raw"),
        import("../src/routes/not-found.tsx?raw"),
        import("../src/components/app-breadcrumb.tsx?raw"),
      ].map((loaded) => loaded.then((module) => module.default as string)),
    );

    for (const source of sources) {
      // `/projects` and `/issues/…` are redirects and dead routes now
      // (ADR-0024). A link to one is a way out that leads nowhere.
      expect(source).not.toMatch(/to="\/projects"/);
      expect(source).not.toMatch(/to="\/issues/);
      // And the words that named what is gone.
      expect(source).not.toMatch(/All Issues|My Issues|the Workflow they move through/);
    }
  });
});
