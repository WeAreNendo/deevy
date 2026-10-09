import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

const stub = vi.hoisted(() => ({ version: "0.10.0" as string | null }));

vi.mock("../src/lib/orpc.ts", async () => {
  const { createTanstackQueryUtils } = await import("@orpc/tanstack-query");
  const { stubClient } = await import("./stub-client.ts");
  const client = stubClient({
    health: {
      ping: async () => ({
        ok: true,
        time: new Date(0).toISOString(),
        devSignIn: false,
        devSockets: false,
        providers: [],
        version: stub.version,
      }),
    },
  });
  return { client, orpc: createTanstackQueryUtils(client) };
});

const { mountAt } = await import("./mount.tsx");
const { sourceOf } = await import("../src/lib/source.ts");

// deevy is AGPL-3.0 (ADR-0002): whoever uses an instance over a network is
// offered the source of the version they use.
describe("the version deevy runs", () => {
  it("is said at the foot of a Settings page, linking to that release's source", async () => {
    stub.version = "0.10.0";
    await mountAt("/settings/notifications");

    const source = await screen.findByRole("link", { name: "Source code" });
    expect(source.getAttribute("href")).toBe("https://github.com/WeAreNendo/deevy/tree/v0.10.0");
    expect(source.getAttribute("target")).toBe("_blank");
    expect(source.closest("footer")?.textContent).toBe("deevy 0.10.0 · Source code");
  });

  it("links to the repository when the build did not say which version it is", async () => {
    stub.version = null;
    await mountAt("/settings/workspace");

    const source = await screen.findByRole("link", { name: "Source code" });
    expect(source.getAttribute("href")).toBe("https://github.com/WeAreNendo/deevy");
    expect(source.closest("footer")?.textContent).toBe("deevy · Source code");
  });

  it("names a release candidate by its own tag", () => {
    expect(sourceOf("0.11.0-rc.0")).toBe("https://github.com/WeAreNendo/deevy/tree/v0.11.0-rc.0");
    expect(sourceOf(undefined)).toBe("https://github.com/WeAreNendo/deevy");
  });
});
