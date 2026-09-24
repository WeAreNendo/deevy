import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient();
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");

describe("a URL that leads nowhere", () => {
  it("renders the not-found page inside the shell, naming the path", async () => {
    await mountAt("/nowhere/at/all");

    expect(await screen.findByRole("heading", { name: "There is nothing here" })).toBeTruthy();
    expect(screen.getByText("/nowhere/at/all")).toBeTruthy();
    // The top bar does not spell the path back; it says what happened.
    const crumbs = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(crumbs.textContent).toBe("Not found");
    // The shell is still around it (the sidebar is one landmark), and the page
    // itself offers the way out: back, or the two places most links come from.
    expect(document.querySelector('[data-slot="sidebar"]')).toBeTruthy();
    const page = screen
      .getByRole("heading", { name: "There is nothing here" })
      .closest('[data-slot="empty"]') as HTMLElement;
    expect(within(page).getByRole("button", { name: "Go back" })).toBeTruthy();
    expect(
      within(page)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/", "/inbox"]);
  });

  it("keeps the real crumbs on a page that exists", async () => {
    await mountAt("/inbox");

    await screen.findByRole("heading", { name: "Inbox" });
    const crumbs = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(crumbs.textContent).toBe("Inbox");
  });
});
