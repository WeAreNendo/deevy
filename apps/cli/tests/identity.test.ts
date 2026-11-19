import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { credentialFor } from "../src/credentials.ts";
import { whoAmI } from "../src/identity.ts";
import { explain } from "../src/client.ts";
import { addGeneratedCommands } from "../src/generate.ts";
import { baseURLFrom, program } from "../src/main.ts";
import { Command } from "commander";
import { agentKey, baseURL, collect, testDeevy } from "./helpers.ts";

const closers: (() => void)[] = [];
const scratch: string[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("who the CLI acts as", () => {
  it("is the Agent whose key is in DEEVY_API_KEY", () => {
    expect(credentialFor(baseURL, { DEEVY_API_KEY: " deevy_sk_x " })).toEqual({
      token: "deevy_sk_x",
      baseURL,
    });
  });

  it("is nobody without one: there is no token to fall back to", () => {
    expect(credentialFor(baseURL, {})).toBeNull();
    expect(credentialFor(baseURL, { DEEVY_API_KEY: "  " })).toBeNull();
  });

  it("signs nobody in or out: login and logout are gone", () => {
    const names = program().commands.map((command) => command.name());
    expect(names).toContain("whoami");
    expect(names).not.toContain("login");
    expect(names).not.toContain("logout");
  });
});

/**
 * The acceptance for slice 9 (docs/plans/simplify.md): against a real deevy,
 * with a key its plugin minted, `whoami` names the Agent and a generated
 * command answers.
 */
describe("an Agent's key, against a real deevy", () => {
  it("is what `whoami` names", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    const key = await agentKey(deevy);
    const said = collect();

    const identity = await whoAmI(baseURL, {
      report: said,
      fetchImpl: deevy.fetch,
      environment: { DEEVY_API_KEY: key },
    });

    expect(identity).toMatchObject({ authenticatedAs: "agent", handle: "planner", memberId: "m2" });
    expect(said.lines.out.join("\n")).toBe(
      `planner at ${baseURL}, the Agent whose key is in DEEVY_API_KEY.`,
    );
  });

  it("lists Runs through `runs list`", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    const key = await agentKey(deevy);
    // Where the capabilities cache goes, so the test never writes to ~/.config.
    const dir = await mkdtemp(join(tmpdir(), "deevy-cli-id-"));
    scratch.push(dir);
    const out: string[] = [];
    const cli = addGeneratedCommands(new Command().exitOverride(), (url) => ({
      baseURL: url ?? baseURL,
      dir,
      environment: { DEEVY_API_KEY: key },
      fetchImpl: deevy.fetch,
      out: (line) => out.push(line),
    }));

    await cli.parseAsync(["runs", "list", "--json"], { from: "user" });

    expect(JSON.parse(out.join("\n"))).toMatchObject({ runs: [] });
  });

  it("is refused when it is not an Agent's, with what to set", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    await agentKey(deevy);
    const humans = await deevy.auth.api.createApiKey({ body: { userId: "u1", name: "mine" } });

    await expect(
      whoAmI(baseURL, {
        report: collect(),
        fetchImpl: deevy.fetch,
        environment: { DEEVY_API_KEY: humans.key },
      }),
    ).rejects.toThrow(/DEEVY_API_KEY has to hold an Agent's key/);
  });

  it("says how to become somebody when there is no key", async () => {
    const said = collect();
    const identity = await whoAmI(baseURL, { report: said, environment: {} });
    expect(identity).toMatchObject({ authenticatedAs: "nobody" });
    expect(said.lines.out.join("\n")).toContain("Set DEEVY_API_KEY");
  });
});

describe("what a refusal is explained as", () => {
  it("names the key when the key is what is refused", () => {
    expect(explain({ code: "UNAUTHORIZED" })).toContain("DEEVY_API_KEY");
  });

  it("relays any other refusal as deevy said it", () => {
    expect(explain({ code: "FORBIDDEN", message: "An Agent cannot do that" })).toBe(
      "An Agent cannot do that",
    );
  });
});

describe("which instance was named", () => {
  it("takes the argument, then DEEVY_URL", () => {
    expect(baseURLFrom("https://a.example.com", {})).toBe("https://a.example.com");
    expect(baseURLFrom(undefined, { DEEVY_URL: "https://b.example.com" })).toBe(
      "https://b.example.com",
    );
    expect(() => baseURLFrom(undefined, {})).toThrow(/No deevy named/);
  });

  it("assumes https, except on loopback, where deevy's own dev instance is http", () => {
    expect(baseURLFrom("deevy.example.com", {})).toBe("https://deevy.example.com");
    expect(baseURLFrom("localhost:3000", {})).toBe("http://localhost:3000");
    expect(baseURLFrom("127.0.0.1:3000", {})).toBe("http://127.0.0.1:3000");
  });

  it("drops a trailing slash, which would double the one in /rpc", () => {
    expect(baseURLFrom("https://deevy.example.com/", {})).toBe("https://deevy.example.com");
    expect(baseURLFrom("https://app.deevy.dev/acme/", {})).toBe("https://app.deevy.dev/acme");
  });

  it("keeps the path, because a deevy may live under one", () => {
    // A hosted Workspace, or a deevy an operator serves behind a proxy: the
    // root of the host is somebody else's deevy, or nobody's (ADR-0029).
    expect(baseURLFrom("https://app.deevy.dev/acme", {})).toBe("https://app.deevy.dev/acme");
    expect(baseURLFrom(undefined, { DEEVY_URL: "https://company.example.com/tools/deevy" })).toBe(
      "https://company.example.com/tools/deevy",
    );
    expect(baseURLFrom("app.deevy.dev/acme", {})).toBe("https://app.deevy.dev/acme");
    expect(baseURLFrom("localhost:3000/acme", {})).toBe("http://localhost:3000/acme");
    expect(baseURLFrom("localhost/acme", {})).toBe("http://localhost/acme");
  });

  it("drops a query and a fragment, which are not where a deevy lives", () => {
    expect(baseURLFrom("https://app.deevy.dev/acme?tab=runs#top", {})).toBe(
      "https://app.deevy.dev/acme",
    );
  });
});
