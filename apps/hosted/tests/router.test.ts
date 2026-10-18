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
  it("answers, with no release when the bundle was not built with one", async () => {
    const response = await route(
      new Request("https://app.example.com/healthz"),
      bindings(),
      readHostedEnv(bindings()),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: null });
  });
});
