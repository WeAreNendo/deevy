import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { generateSpec } from "@deevy/core/openapi";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  CAPABILITIES_TTL_MS,
  capabilitiesFor,
  fetchCapabilities,
  missingFrom,
  operationsIn,
} from "../src/capabilities.ts";
import { addGeneratedCommands } from "../src/generate.ts";
import { writeToken } from "../src/credentials.ts";
import { apiToken, baseURL, humanMember, testDeevy } from "./helpers.ts";

const scratch: string[] = [];
const closers: (() => void)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "deevy-cli-cap-"));
  scratch.push(dir);
  return dir;
}

/** An instance serving a document with some operations taken out of it. */
function servingSpec(spec: unknown): typeof fetch {
  return ((input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/api/spec.json")) {
      return Promise.resolve(new Response(JSON.stringify(spec), { status: 200 }));
    }
    return Promise.resolve(new Response("not here", { status: 404 }));
  }) as typeof fetch;
}

describe("what an instance says it can do", () => {
  it("is the operationIds in the document it serves", async () => {
    const spec = await generateSpec();
    const operations = operationsIn(spec);
    expect(operations).toContain("issues.create");
    expect(operations).toContain("events.subscribe");
    // Sorted, so a cached list and a fresh one compare as text.
    expect(operations).toEqual([...operations].sort((a, b) => a.localeCompare(b)));
  });

  it("carries the instance's version when its entry told it one", async () => {
    const spec = await generateSpec("0.9.1");
    const found = await fetchCapabilities(baseURL, servingSpec(spec));
    expect(found.version).toBe("0.9.1");
  });

  it("reads 0.0.0 as no version rather than as a version", async () => {
    // What an instance whose entry never passed one serves. Saying "deevy
    // 0.0.0 is older" would be worse than saying nothing about it.
    const found = await fetchCapabilities(baseURL, servingSpec(await generateSpec()));
    expect(found.version).toBeNull();
  });

  it("says so plainly when the other end is not a deevy", async () => {
    const notDeevy = (() => Promise.resolve(new Response("nope", { status: 404 }))) as typeof fetch;
    await expect(fetchCapabilities(baseURL, notDeevy)).rejects.toThrow(/Is that a deevy/);
  });
});

describe("what a real instance serves", () => {
  /**
   * The wiring, end to end: an entry tells `createApp` its version, the app
   * puts it in the document it serves, and the CLI reads it back. Without this
   * the version could be threaded most of the way and nobody would know.
   */
  it("carries the version its entry gave it, in the document a CLI discovers it through", async () => {
    const deevy = testDeevy({ version: "0.9.0" });
    closers.push(deevy.close);
    const found = await fetchCapabilities(baseURL, deevy.fetch);
    expect(found.version).toBe("0.9.0");
    expect(found.operations).toContain("issues.create");
  });

  it("says nothing about its version when its entry said nothing", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    expect((await fetchCapabilities(baseURL, deevy.fetch)).version).toBeNull();
  });
});

describe("the cache", () => {
  it("asks once and then reads the file", async () => {
    const dir = await tempDir();
    let asked = 0;
    const counting = ((input: RequestInfo | URL) => {
      asked += 1;
      return servingSpec({ paths: {}, info: { version: "1.2.3" } })(input);
    }) as typeof fetch;

    await capabilitiesFor(baseURL, { fetchImpl: counting, dir });
    await capabilitiesFor(baseURL, { fetchImpl: counting, dir });
    expect(asked).toBe(1);
  });

  it("asks again once the answer is a day old", async () => {
    const dir = await tempDir();
    let asked = 0;
    const counting = ((input: RequestInfo | URL) => {
      asked += 1;
      return servingSpec({ paths: {}, info: { version: "1.2.3" } })(input);
    }) as typeof fetch;

    await capabilitiesFor(baseURL, { fetchImpl: counting, dir });
    await capabilitiesFor(baseURL, {
      fetchImpl: counting,
      dir,
      now: Date.now() + CAPABILITIES_TTL_MS + 1,
    });
    expect(asked).toBe(2);
  });

  it("keeps it beside the token without treating it as one", async () => {
    // It is the document the instance serves to anybody, so it is an ordinary
    // file — the token beside it is the one at 0600.
    const dir = await tempDir();
    await capabilitiesFor(baseURL, {
      fetchImpl: servingSpec({ paths: {}, info: { version: "1" } }),
      dir,
    });
    const written = JSON.parse(
      await readFile(join(dir, "localhost_3000.capabilities.json"), "utf8"),
    ) as { version: string };
    expect(written.version).toBe("1");
  });

  it("survives a cache file somebody edited by hand", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "localhost_3000.capabilities.json"), "{ not json");
    const found = await capabilitiesFor(baseURL, {
      fetchImpl: servingSpec({ paths: {}, info: { version: "2" } }),
      dir,
    });
    expect(found.version).toBe("2");
  });
});

describe("a command this instance does not have", () => {
  it("names the operation, the instance and both versions", () => {
    const said = missingFrom(
      "issues.create",
      ["issues", "create"],
      "https://old.example.com",
      { operations: [], version: "0.4.0", readAt: 0 },
      "0.9.0",
    );
    expect(said).toContain("issues.create");
    expect(said).toContain("deevy issues create");
    expect(said).toContain("0.9.0");
    expect(said).toContain("deevy 0.4.0");
  });

  it("does not invent a version for an instance that gave none", () => {
    const said = missingFrom(
      "x.y",
      ["x", "y"],
      "https://o",
      { operations: [], version: null, readAt: 0 },
      "1",
    );
    expect(said).toContain("that deevy");
    expect(said).not.toContain("null");
  });

  /**
   * The case the whole slice is for: a CLI from this tree against an instance
   * that does not have one of its operations. The command must refuse by name
   * rather than reaching the server and failing as something to interpret.
   */
  it("is refused before the request, against a real instance missing it", async () => {
    const deevy = testDeevy();
    closers.push(deevy.close);
    await humanMember(deevy.db);
    const dir = await tempDir();
    await writeToken(baseURL, await apiToken(deevy, "u1"), dir);

    // The instance's document, less the one operation — an older deevy.
    const full = (await generateSpec("0.4.0")) as unknown as { paths: Record<string, unknown> };
    const older = {
      ...full,
      paths: Object.fromEntries(
        Object.entries(full.paths).filter(([path]) => path !== "/projects"),
      ),
    };
    const pretending = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/api/spec.json")) {
        return Promise.resolve(new Response(JSON.stringify(older), { status: 200 }));
      }
      return deevy.fetch(input, init);
    }) as typeof fetch;

    const root = new Command().name("deevy").exitOverride();
    addGeneratedCommands(root, () => ({
      origin: baseURL,
      cliVersion: "0.9.0",
      dir,
      environment: {},
      fetchImpl: pretending,
      out: () => {},
    }));

    await expect(
      root.parseAsync(["projects", "create", "--key", "DEV", "--name", "Dev"], { from: "user" }),
    ).rejects.toThrow(/has no `projects.create`/);

    // And one it does have reaches the instance, so the filter is narrowing
    // rather than simply refusing. `me get` needs nothing to exist first.
    await expect(root.parseAsync(["me", "get"], { from: "user" })).resolves.not.toThrow();
  });
});
