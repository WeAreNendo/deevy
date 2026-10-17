import { describe, expect, it } from "vite-plus/test";
import type { SocketProvider } from "@deevy/core/sockets";
import { socketModules } from "../src/index.ts";

/**
 * Who makes the secret each tool signs its deliveries with (`WebhookSecretFrom`).
 *
 * The core decides from this whether `sockets.rotate` mints one, and the
 * Socket's page whether to offer Mint, a field for the tool's own, or neither.
 * Until 2026-10-16 the page offered Mint for every tool and the API minted for
 * any: a secret Slack or Linear can never be given, and one that replaced
 * Notion's verification token.
 */
describe("who makes a tool's webhook secret", () => {
  const modules = socketModules({ devStub: true });
  const declared = (provider: SocketProvider) =>
    modules[provider]?.({
      config: {},
      credentials: {},
      fetch: globalThis.fetch,
      now: () => new Date(),
    }).webhookSecretFrom;

  it("is GitHub's or deevy's for an App and a GitLab webhook, whose settings take one typed in", () => {
    expect(declared("github")).toBe("either");
    expect(declared("gitlab")).toBe("either");
  });

  it("is only the tool's for Slack and Linear, which make it and take none typed in", () => {
    expect(declared("slack")).toBe("tool");
    expect(declared("linear")).toBe("tool");
  });

  it("is what Notion sends to verify its webhook", () => {
    expect(declared("notion")).toBe("handshake");
  });

  it("is said by every module this build registers", () => {
    for (const provider of Object.keys(modules) as SocketProvider[]) {
      expect(["either", "tool", "handshake"]).toContain(declared(provider));
    }
  });
});
