import { describe, expect, it } from "vite-plus/test";
import { isSlug, RESERVED_SLUGS } from "../src/directory.ts";
import { readHostedEnv, type HostedBindings } from "../src/env.ts";
import { workspaceSecret } from "../src/secrets.ts";

/**
 * The parts of the many-Workspaces Worker that are plain functions. The
 * router, the objects and `Platform` run on workerd, in scripts/smoke-hosted.ts.
 */

const master = "a-master-secret-a-master-secret-a-master-secret";

function bindings(vars: Partial<HostedBindings> = {}): HostedBindings {
  return {
    DEEVY_HOSTED_ORIGIN: "https://app.example.com",
    DEEVY_HOSTED_MASTER_SECRET: master,
    DEEVY_SIGN_IN_RELAY_SECRET: "a-relay-secret-a-relay-secret-a-relay-secret",
    ...vars,
  } as HostedBindings;
}

describe("a Workspace's slug", () => {
  it("is 3 to 40 lowercase letters, digits and hyphens", () => {
    for (const slug of ["acme", "a1b", "acme-corp", "x".repeat(40)])
      expect(isSlug(slug)).toBe(true);
    for (const slug of ["ab", "Acme", "-acme", "acme-", "ac_me", "x".repeat(41), "acme/x", ""]) {
      expect(isSlug(slug)).toBe(false);
    }
  });

  it("is never one of the host's own paths", () => {
    for (const path of ["auth", "api", "console", "assets", "healthz", "relay", "settings"]) {
      expect(RESERVED_SLUGS.has(path)).toBe(true);
    }
  });
});

describe("a Workspace's secrets", () => {
  it("are derived from the master and its key, the same every time", async () => {
    const first = await workspaceSecret(master, "wsk_one", "auth");
    expect(await workspaceSecret(master, "wsk_one", "auth")).toBe(first);
    expect(first.length).toBeGreaterThanOrEqual(32);
  });

  it("differ by Workspace, by purpose and by master", async () => {
    const auth = await workspaceSecret(master, "wsk_one", "auth");
    expect(await workspaceSecret(master, "wsk_two", "auth")).not.toBe(auth);
    expect(await workspaceSecret(master, "wsk_one", "seal")).not.toBe(auth);
    expect(await workspaceSecret(`${master}!`, "wsk_one", "auth")).not.toBe(auth);
  });
});

describe("the platform's configuration", () => {
  it("is read once, with every Workspace's defaults", () => {
    const hosted = readHostedEnv(bindings({ DEEVY_HOSTED_JURISDICTION: "eu" }));
    expect(hosted.origin).toBe("https://app.example.com");
    expect(hosted.jurisdiction).toBe("eu");
    expect(hosted.passSeconds).toBe(60);
    expect(hosted.streamSeconds).toBe(300);
  });

  it("refuses to run without an origin, a master secret or a relay secret", () => {
    expect(() =>
      readHostedEnv(bindings({ DEEVY_HOSTED_ORIGIN: "https://app.example.com/acme" })),
    ).toThrow(/must be an origin/);
    expect(() => readHostedEnv(bindings({ DEEVY_HOSTED_MASTER_SECRET: "short" }))).toThrow(
      /MASTER_SECRET/,
    );
    expect(() => readHostedEnv(bindings({ DEEVY_SIGN_IN_RELAY_SECRET: "" }))).toThrow(
      /RELAY_SECRET/,
    );
  });

  it("keeps the development stubs to a machine's own loopback", () => {
    expect(() => readHostedEnv(bindings({ DEEVY_DEV_STUB_EMAIL: "1" }))).toThrow(/loopback/);
    expect(
      readHostedEnv(
        bindings({ DEEVY_HOSTED_ORIGIN: "http://127.0.0.1:8788", DEEVY_DEV_STUB_EMAIL: "1" }),
      ).devStubEmail,
    ).toBe(true);
  });
});
