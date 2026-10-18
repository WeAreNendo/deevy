import { describe, expect, it, vi } from "vite-plus/test";
import { readHostedEnv } from "../src/env.ts";
import { route } from "../src/router.ts";
import { bindings } from "./router-bindings.ts";

// The build writes the release into the bundle (scripts/local.ts); here the
// module that reads it says one, as a built bundle would.
vi.mock("../src/version.ts", () => ({ VERSION: "9.9.9" }));

describe("the host's /healthz, built", () => {
  it("answers with the release it runs", async () => {
    const response = await route(
      new Request("https://app.example.com/healthz"),
      bindings(),
      readHostedEnv(bindings()),
    );
    expect(await response.json()).toEqual({ ok: true, version: "9.9.9" });
  });
});
