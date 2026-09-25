import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Harness, HarnessContext } from "../src/harness/contract.ts";
import { sessionEnv } from "../src/harness/env.ts";
import { harnessFor, missingFor } from "../src/harness/index.ts";
import { buildSession, runHarness, stripFromClone } from "../src/harness/run.ts";
import type { SessionEvent, SessionInput } from "../src/session.ts";
import { testConfig } from "./helpers.ts";

const scratch: string[] = [];
afterEach(async () => {
  for (const path of scratch.splice(0)) await rm(path, { recursive: true, force: true });
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "deevy-harness-test-"));
  scratch.push(path);
  return path;
}

/**
 * A harness whose binary is `node`, whose argv is a script, and whose parser
 * is the identity on JSON: enough to exercise the runner with nothing on PATH
 * but the thing running this test.
 */
function fake(script: string, extra: Partial<Harness> = {}): Harness {
  return {
    name: "fake",
    binary: process.execPath,
    env: { requires: [], names: [], prefixes: [] },
    strip: [],
    argv: () => ["-e", script],
    parse: (line) => {
      try {
        return [JSON.parse(line) as SessionEvent];
      } catch {
        return [];
      }
    },
    bounds: "a test",
    ...extra,
  };
}

async function inputFor(cwd: string, signal = new AbortController().signal): Promise<SessionInput> {
  return { prompt: "p", cwd, repository: false, mcpUrl: "http://127.0.0.1:1/mcp", signal };
}

async function collect(events: AsyncIterable<SessionEvent>): Promise<SessionEvent[]> {
  const seen: SessionEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

describe("running a harness", () => {
  it("reads its stdout a line at a time into the parser, and its own done stands", async () => {
    const harness = fake(`
      console.log(JSON.stringify({ type: "ready", tools: [], servers: [] }));
      console.log("");
      console.log(JSON.stringify({ type: "text", text: "hello" }));
      console.log(JSON.stringify({ type: "done", ok: true, detail: "finished on purpose" }));
    `);
    const cwd = await directory();

    const events = await collect(buildSession(testConfig, harness)({ ...(await inputFor(cwd)) }));

    expect(events).toEqual([
      { type: "ready", tools: [], servers: [] },
      { type: "text", text: "hello" },
      { type: "done", ok: true, detail: "finished on purpose" },
    ]);
  });

  it("describes an exit the stream did not explain, with the tail of stderr", async () => {
    const harness = fake(`
      console.log(JSON.stringify({ type: "text", text: "half way" }));
      console.error("something went wrong");
      process.exit(3);
    `);
    const cwd = await directory();

    const events = await collect(buildSession(testConfig, harness)(await inputFor(cwd)));

    expect(events).toEqual([
      { type: "text", text: "half way" },
      { type: "done", ok: false, detail: "The session exited with code 3: something went wrong" },
    ]);
  });

  it("calls a clean exit without a done a success, since the CLI said nothing else", async () => {
    const cwd = await directory();

    const events = await collect(
      buildSession(testConfig, fake("process.exit(0)"))(await inputFor(cwd)),
    );

    expect(events).toEqual([{ type: "done", ok: true, detail: "The session ended" }]);
  });

  it("says when the binary is not there, rather than hanging on nothing", async () => {
    const cwd = await directory();
    const missing = fake("", { binary: "/nonexistent/deevy-harness" });

    const events = await collect(buildSession(testConfig, missing)(await inputFor(cwd)));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "done", ok: false });
    expect((events[0] as Extract<SessionEvent, { type: "done" }>).detail).toContain(
      "could not start",
    );
  });

  it("stops the process when the Run's signal fires, and does not wait for it to agree", async () => {
    // A process that ignores SIGTERM, so the grace period and the SIGKILL are
    // what end it.
    const harness = fake(`
      process.on("SIGTERM", () => {});
      console.log(JSON.stringify({ type: "text", text: "working" }));
      setInterval(() => {}, 1000);
    `);
    const cwd = await directory();
    const controller = new AbortController();
    const started = Date.now();

    const events: SessionEvent[] = [];
    for await (const event of runHarness(
      harness,
      {
        config: testConfig,
        input: await inputFor(cwd, controller.signal),
        home: cwd,
        instructions: "/x",
      },
      { graceMs: 100 },
    )) {
      events.push(event);
      if (event.type === "text") controller.abort();
    }

    expect(events.at(-1)).toEqual({ type: "done", ok: false, detail: "The session was stopped" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("closes stdin, so a CLI that waits on it does not wait", async () => {
    const harness = fake(`
      let read = "";
      process.stdin.on("data", (chunk) => (read += chunk));
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ type: "done", ok: true, detail: "stdin ended: " + JSON.stringify(read) }));
      });
    `);
    const cwd = await directory();

    const events = await collect(buildSession(testConfig, harness)(await inputFor(cwd)));

    expect(events).toEqual([{ type: "done", ok: true, detail: 'stdin ended: ""' }]);
  });
});

describe("what the session is given", () => {
  it("runs in the working directory, with a home of its own that is gone afterwards", async () => {
    const harness = fake(`
      console.log(JSON.stringify({ type: "text", text: process.cwd() + "|" + process.env.HOME }));
    `);
    const cwd = await directory();

    const events = await collect(buildSession(testConfig, harness)(await inputFor(cwd)));
    const [where, home] = (events[0] as Extract<SessionEvent, { type: "text" }>).text.split("|");

    // macOS spells its temporary directory two ways; the process is in the real one.
    expect(where).toBe(await realpath(cwd));
    expect(home).not.toBe(process.env.HOME);
    expect(home).toContain("deevy-home-");
    await expect(readdir(home)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes what prepare wrote into that home before the session starts", async () => {
    const harness = fake(
      `console.log(JSON.stringify({ type: "text", text: require("fs").readFileSync(process.env.HOME + "/config.json", "utf8") }));`,
      {
        prepare: async (context: HarnessContext) => {
          await writeFile(join(context.home, "config.json"), '{"prepared":true}');
        },
      },
    );
    const cwd = await directory();

    const events = await collect(buildSession(testConfig, harness)(await inputFor(cwd)));

    expect(events[0]).toEqual({ type: "text", text: '{"prepared":true}' });
  });

  it("strips the recipe's paths from the clone first, and touches nothing else", async () => {
    const cwd = await directory();
    await writeFile(join(cwd, ".mcp.json"), "{}");
    await mkdir(join(cwd, ".claude"));
    await writeFile(join(cwd, ".claude", "settings.json"), "{}");
    await writeFile(join(cwd, "CLAUDE.md"), "# input");
    const harness = fake(
      `console.log(JSON.stringify({ type: "text", text: require("fs").readdirSync(".").sort().join(",") }));`,
      { strip: [".mcp.json", ".claude", "not-there"] },
    );

    const events = await collect(buildSession(testConfig, harness)(await inputFor(cwd)));

    expect(events[0]).toEqual({ type: "text", text: "CLAUDE.md" });
    expect(await readFile(join(cwd, "CLAUDE.md"), "utf8")).toBe("# input");
  });

  it("refuses a strip path that reaches outside the working directory", async () => {
    const cwd = await directory();

    await expect(stripFromClone(cwd, ["../elsewhere"])).rejects.toThrow("stay inside");
    await expect(stripFromClone(cwd, ["/etc"])).rejects.toThrow("stay inside");
  });
});

describe("the session's environment", () => {
  it("passes only what is named, so a credential nobody thought of is not inherited", () => {
    const hostile = {
      PATH: "/usr/bin",
      HOME: "/home/runtime",
      ANTHROPIC_API_KEY: "sk-ant-x",
      // The kind of thing that is simply present on a developer's machine, and
      // that a denylist can only exclude if somebody thought of it first.
      AWS_SECRET_ACCESS_KEY: "aws",
      NPM_TOKEN: "npm",
      GITHUB_TOKEN: "gh",
      CLAUDE_CODE_OAUTH_SCOPES: "the host tooling's own session",
      DEEVY_AGENT_KEY: "deevy_sk_secret",
    };

    expect(sessionEnv(hostile, [], ["ANTHROPIC_"])).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/runtime",
      ANTHROPIC_API_KEY: "sk-ant-x",
    });
  });

  it("passes what the operator names, and nothing more", () => {
    const env = { PATH: "/usr/bin", HTTPS_PROXY: "http://proxy:3128", NPM_TOKEN: "npm" };

    expect(sessionEnv(env, ["HTTPS_PROXY"])).toEqual({
      PATH: "/usr/bin",
      HTTPS_PROXY: "http://proxy:3128",
    });
  });
});

describe("choosing a harness", () => {
  it("finds the one the configuration names, and defaults to Claude Code", () => {
    expect(harnessFor(testConfig).name).toBe("claude-code");
  });

  it("refuses a name it does not know, listing the ones it does", () => {
    expect(() => harnessFor({ ...testConfig, harness: "vim" })).toThrow(
      /"vim"; the runtime knows claude-code/,
    );
  });

  it("says which required variables are missing before a session is started", () => {
    const needy = fake("", { env: { requires: ["CURSOR_API_KEY"], names: [], prefixes: [] } });

    expect(missingFor(needy, {})).toEqual(["CURSOR_API_KEY"]);
    expect(missingFor(needy, { CURSOR_API_KEY: "k" })).toEqual([]);
  });
});
