import { describe, expect, it } from "vite-plus/test";
import { readHostedEnv } from "../src/env.ts";
import { route, SUSPENDED } from "../src/router.ts";
import { bindings } from "./router-bindings.ts";

/**
 * The host's own `/healthz`, which a deploy pins with Cloudflare's version
 * override header to prove which version answered (deevy-cloud's rollout).
 * Unbuilt, as here, there is no release to say; tests/router-version.test.ts
 * gives it one.
 */
describe("the host's /healthz", () => {
  it("answers, with no release or version id when built and served by neither", async () => {
    const response = await route(
      new Request("https://app.example.com/healthz"),
      bindings(),
      readHostedEnv(bindings()),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: null, versionId: null });
  });

  it("answers with the Worker version Cloudflare says is serving it", async () => {
    const serving = { ...bindings(), CF_VERSION_METADATA: { id: "c00cca8a-version" } };
    const response = await route(
      new Request("https://app.example.com/healthz"),
      serving,
      readHostedEnv(serving),
    );
    expect(await response.json()).toMatchObject({ versionId: "c00cca8a-version" });
  });
});

/**
 * A suspended Workspace, which the directory says is suspended and no more:
 * whether its owner is deleting it, which the console can undo, or deevy Cloud
 * suspended it, which only support can, is the console's to know. So what it
 * says has to be true either way (apps/docs/content/cloud/support.md).
 */
describe("a suspended Workspace", () => {
  const suspended = {
    ...bindings(),
    DIRECTORY: {
      get: (key: string) =>
        Promise.resolve(key === "slug:acme" ? { key: "wsk_acme", status: "suspended" } : null),
    } as unknown as KVNamespace,
  };

  it("sends the visitor to its owner, and its owner to the console or support", async () => {
    for (const path of [
      "/acme/",
      "/acme/api/auth/get-session",
      "/.well-known/openid-configuration/acme",
    ]) {
      const response = await route(
        new Request(`https://app.example.com${path}`),
        suspended,
        readHostedEnv(suspended),
      );
      expect(response.status).toBe(403);
      const page = await response.text();
      expect(page).toContain(
        "This Workspace is suspended: nobody can use it until it is resumed. Ask its owner, who can see why in",
      );
      expect(page).toContain('<a href="/">the console</a>');
      expect(page).toContain('<a href="mailto:support@deevy.dev">support@deevy.dev</a>');
      // Not true when deevy Cloud suspended it: the console offers its owner no way back.
      expect(page).not.toContain("bring it back");
    }
  });

  /**
   * An open tab hears it as its socket's close reason (src/workspace.ts), which
   * the WebSocket protocol holds to 123 bytes, so that is the page's first
   * sentence alone, and the console's as support.md quotes it.
   */
  it("says its first sentence in few enough bytes for a close reason", () => {
    expect(SUSPENDED).toBe("This Workspace is suspended: nobody can use it until it is resumed.");
    expect(new TextEncoder().encode(SUSPENDED).length).toBeLessThanOrEqual(123);
  });
});
