import { describe, expect, it } from "vite-plus/test";
import { readConfig } from "../src/config.ts";
import { harnesses } from "../src/harness/index.ts";
import { instructionsPath } from "../src/instructions.ts";

const enough = { DEEVY_URL: "https://deevy.example.com", DEEVY_AGENT_KEY: "deevy_sk_x" };

describe("configuration", () => {
  it("refuses to start without an identity, naming what is missing", () => {
    expect(() => readConfig({ DEEVY_URL: enough.DEEVY_URL })).toThrow("DEEVY_AGENT_KEY");
    expect(() => readConfig({ DEEVY_AGENT_KEY: enough.DEEVY_AGENT_KEY })).toThrow("DEEVY_URL");
  });

  it("takes the defaults, and a trailing slash off the URL", () => {
    expect(readConfig({ ...enough, DEEVY_URL: "https://deevy.example.com/" })).toEqual({
      url: "https://deevy.example.com",
      key: "deevy_sk_x",
      harness: "claude-code",
      pollSeconds: 30,
      model: "claude-opus-5",
      effort: "high",
      maxTurns: 100,
      repo: null,
      listenPort: 8787,
      sessionUid: 10002,
      sessionGid: 10002,
      // deevy calls a Run stale after thirty minutes of silence, so a session
      // allowed to outlive that would be reported stale while still working.
      runTimeoutSeconds: 1800,
    });
  });

  it("defaults the model in the harness's own naming, and takes the one it is given", () => {
    // OpenCode takes `provider/model`, so the name every other harness takes
    // would fail its first Run on an image given nothing but a key.
    expect(readConfig({ ...enough, DEEVY_AGENT_HARNESS: "opencode" }).model).toBe(
      "anthropic/claude-opus-5",
    );
    expect(readConfig({ ...enough, DEEVY_AGENT_HARNESS: "cursor" }).model).toBe("claude-opus-5");
    expect(
      readConfig({ ...enough, DEEVY_AGENT_HARNESS: "opencode", DEEVY_AGENT_MODEL: "openai/gpt-5" })
        .model,
    ).toBe("openai/gpt-5");
    // An empty one is a line left in an env file, not a model.
    expect(readConfig({ ...enough, DEEVY_AGENT_MODEL: "" }).model).toBe("claude-opus-5");
  });

  it("starts every harness on a model its own command line takes", () => {
    for (const harness of harnesses) {
      const config = readConfig({ ...enough, DEEVY_AGENT_HARNESS: harness.name });
      const context = {
        config,
        input: {
          prompt: "Work Run r1 on Issue DEV-1.",
          cwd: "/tmp/run",
          repository: false,
          mcpUrl: "http://127.0.0.1:1/mcp",
          signal: AbortSignal.abort(),
        },
        home: "/tmp/home",
        instructions: instructionsPath(),
      };

      expect(() => harness.argv(context), harness.name).not.toThrow();
      expect(harness.argv(context)).toContain(config.model);
    }
  });

  it("reads an empty value as an absent one", () => {
    // What Compose passes for a line like `DEEVY_AGENT_SESSION_UID=` in .env.
    // Read as zero, it would run the session as the supervisor's own user.
    const config = readConfig({
      ...enough,
      DEEVY_AGENT_SESSION_UID: "",
      DEEVY_AGENT_SESSION_GID: " ",
      DEEVY_AGENT_POLL_SECONDS: "",
      DEEVY_AGENT_EFFORT: "",
      DEEVY_AGENT_REPO: "https://github.com/acme/deevy.git",
      DEEVY_AGENT_BASE_BRANCH: "",
      DEEVY_AGENT_WEBHOOK_SECRET: "",
      DEEVY_AGENT_PASS_ENV: "",
    });

    expect(config).toMatchObject({ sessionUid: 10002, sessionGid: 10002, pollSeconds: 30 });
    expect(config.effort).toBe("high");
    expect(config.repo?.baseBranch).toBe("main");
    expect(config.webhookSecret).toBeUndefined();
    expect(config.passEnv).toBeUndefined();
  });

  it("ignores a number that is not one", () => {
    const config = readConfig({ ...enough, DEEVY_AGENT_POLL_SECONDS: "soon" });

    expect(config.pollSeconds).toBe(30);
  });
});
