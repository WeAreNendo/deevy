import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cacheFileFor } from "../src/capabilities.ts";
import { gateUrl } from "../src/gates.ts";
import { addGeneratedCommands } from "../src/generate.ts";
import { whoAmI } from "../src/identity.ts";
import { webURLFrom } from "../src/main.ts";
import { agentKey, baseURL, collect, recording, testDeevy } from "./helpers.ts";

/**
 * A deevy that lives under a path of its host (ADR-0029): a hosted Workspace at
 * `app.deevy.dev/acme`, or a deevy an operator serves at `company.com/deevy`.
 * Everything it answers is under the path, so a CLI that kept only the origin
 * of what it was given would talk to the root of the host — somebody else's
 * deevy, or nobody's.
 */

const scratch: string[] = [];
const closers: (() => void)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "deevy-cli-path-"));
  scratch.push(dir);
  return dir;
}

/** The test deevy's host, and a Workspace under it. */
const acme = `${baseURL}/acme`;

describe("where what a deevy under a path can do is cached", () => {
  it("is a file of its own, apart from the root of the same host", () => {
    expect(cacheFileFor("https://app.deevy.dev/acme")).toBe(
      "https_app.deevy.dev%2Facme.capabilities.json",
    );
    expect(cacheFileFor("https://company.example.com/tools/deevy")).toBe(
      "https_company.example.com%2Ftools%2Fdeevy.capabilities.json",
    );
    // Two Workspaces on one host are two deevys, and so is the root beside them.
    const names = new Set(
      ["https://app.deevy.dev", "https://app.deevy.dev/acme", "https://app.deevy.dev/globex"].map(
        cacheFileFor,
      ),
    );
    expect(names.size).toBe(3);
  });

  it("cannot be mistaken for a port, or for another path", () => {
    // A port gets an underscore and a path is escaped, so the two never meet.
    expect(cacheFileFor("https://host.example.com/8443")).not.toBe(
      cacheFileFor("https://host.example.com:8443"),
    );
    expect(cacheFileFor("https://host.example.com/a/b")).not.toBe(
      cacheFileFor("https://host.example.com/a_b"),
    );
  });

  it("counts the scheme, because http and https on one host are two instances", () => {
    expect(cacheFileFor("https://deevy.example.com")).toBe(
      "https_deevy.example.com.capabilities.json",
    );
    expect(cacheFileFor("http://localhost:3000")).toBe("http_localhost_3000.capabilities.json");
    expect(cacheFileFor("http://host.example.com")).not.toBe(
      cacheFileFor("https://host.example.com"),
    );
  });
});

describe("an Agent's key at a real deevy under a path", () => {
  it("is named by `whoami`, asked under the path", async () => {
    const deevy = testDeevy({ baseURL: acme });
    closers.push(deevy.close);
    const key = await agentKey(deevy);
    const calls = recording(deevy.fetch);

    const identity = await whoAmI(acme, {
      report: collect(),
      fetchImpl: calls.fetch,
      environment: { DEEVY_API_KEY: key },
    });

    expect(identity).toMatchObject({
      url: acme,
      origin: baseURL,
      authenticatedAs: "agent",
      handle: "planner",
    });
    expect(calls.urls).toEqual([`${acme}/rpc/me/get`]);
  });

  it("asks what the deevy can do, and calls it, under the path", async () => {
    const deevy = testDeevy({ baseURL: acme, version: "0.9.0" });
    closers.push(deevy.close);
    const key = await agentKey(deevy);
    const dir = await tempDir();

    const asked = recording(deevy.fetch);
    const said: string[] = [];
    const root = new Command().name("deevy").exitOverride();
    addGeneratedCommands(root, () => ({
      baseURL: acme,
      dir,
      environment: { DEEVY_API_KEY: key },
      fetchImpl: asked.fetch,
      out: (line) => said.push(line),
    }));

    await root.parseAsync(["me", "get", "--json"], { from: "user" });
    expect(JSON.parse(said.at(-1) ?? "{}") as unknown).toMatchObject({
      member: { handle: "planner" },
    });
    expect(asked.urls).toEqual([`${acme}/api/spec.json`, `${acme}/rpc/me/get`]);
    // What it can do is cached under the same whole URL.
    await expect(
      stat(join(dir, "http_localhost_3000%2Facme.capabilities.json")),
    ).resolves.toBeTruthy();
  });
});

describe("a Gate on a deevy under a path", () => {
  it("opens the ruling screen under the path", () => {
    expect(gateUrl("https://app.deevy.dev/acme", "gate_abc123def456")).toBe(
      "https://app.deevy.dev/acme/gates/gate_abc123def456",
    );
  });

  it("goes to the SPA the API names, or the one DEEVY_WEB_URL names, path and all", () => {
    expect(webURLFrom(undefined, "https://app.deevy.dev/acme", {})).toBe(
      "https://app.deevy.dev/acme",
    );
    expect(
      webURLFrom(undefined, "https://api.example.com/acme", {
        DEEVY_WEB_URL: "https://web.example.com/acme/",
      }),
    ).toBe("https://web.example.com/acme");
  });
});
