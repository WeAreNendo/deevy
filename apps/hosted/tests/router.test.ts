import { describe, expect, it } from "vite-plus/test";
import { readHostedEnv } from "../src/env.ts";
import { route } from "../src/router.ts";
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
