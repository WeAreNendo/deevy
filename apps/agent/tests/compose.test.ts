import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { harnesses } from "../src/harness/index.ts";

const root = new URL("../../../", import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, root), "utf8");

/**
 * The `agent` service's `environment`, name to what follows the colon: an
 * empty string is a name with no value, which Compose passes when it is set
 * and leaves out when it is not.
 */
async function agentEnvironment(): Promise<Map<string, string>> {
  const compose = await read("docker-compose.yml");
  const start = compose.indexOf("\n  agent:");
  expect(start).toBeGreaterThan(-1);
  const service = compose.slice(start, compose.indexOf("\n    healthcheck:", start));
  const block = service.slice(service.indexOf("\n    environment:\n"));
  const entries = [...block.matchAll(/^ {6}([A-Z_][A-Z0-9_]*):(.*)$/gm)];
  return new Map(entries.map((entry) => [entry[1]!, entry[2]!.trim()]));
}

/**
 * What `src/config.ts` reads and the service does not pass as the operator
 * set it. Everything else it reads is named with no value, so an operator's
 * setting reaches the runtime and an unset one leaves the runtime's default.
 */
const exceptions = new Map<string, string | undefined>([
  // Left out altogether: each image sets it to the CLI it carries, and Compose
  // removes an image's own value for a name it lists and cannot resolve. The
  // image's tag is how the harness is chosen.
  ["DEEVY_AGENT_HARNESS", undefined],
  // Given a value: the deevy service beside it, unless DEEVY_AGENT_URL says
  // the runtime should talk to another one.
  ["DEEVY_URL", "${DEEVY_AGENT_URL:-http://deevy:3000}"],
]);

/**
 * deevy's compose file, which starts the runtime beside deevy with
 * `--profile agent`. One service has to run every image, and the image is the
 * only thing an operator changes to pick the harness — so what the service
 * passes, and what it leaves to the image, is asserted here rather than found
 * by the first Run that looks for `claude` in the Cursor image.
 */
describe("the compose file's agent service", () => {
  it("lists every setting the runtime reads, each passed only when it is set", async () => {
    const environment = await agentEnvironment();
    // Every name in the file, however it is read, as tests/docs.test.ts reads
    // it: a setting added there and not here would do nothing under Compose.
    const source = await read("apps/agent/src/config.ts");
    const settings = new Set([...source.matchAll(/\bDEEVY_[A-Z_]+\b/g)].map((match) => match[0]));
    expect(settings.size).toBeGreaterThan(10);

    for (const name of settings) {
      const value = exceptions.has(name) ? exceptions.get(name) : "";
      expect({ name, value: environment.get(name) }).toEqual({ name, value });
    }
  });

  it("checks health on the port the runtime was told to listen on", async () => {
    const compose = await read("docker-compose.yml");
    const agent = compose.slice(compose.indexOf("\n  agent:"));
    expect(agent).toMatch(
      /fetch\('http:\/\/localhost:'\+\(process\.env\.DEEVY_AGENT_PORT\|\|8787\)/,
    );
  });

  it("passes every harness's credential, and only when it is set", async () => {
    const environment = await agentEnvironment();
    // What each recipe names, plus Claude Code's, which it allows by prefix.
    const credentials = new Set([
      "ANTHROPIC_API_KEY",
      ...harnesses.flatMap((harness) => [...harness.env.requires, ...harness.env.names]),
    ]);

    for (const name of credentials)
      expect({ name, value: environment.get(name) }).toEqual({ name, value: "" });
  });

  it("leaves the harness to the image", async () => {
    // Named at all, it would be the image's no more: with no value Compose
    // removes the image's own, and `${…:-}` replaces it with an empty one.
    expect((await agentEnvironment()).has("DEEVY_AGENT_HARNESS")).toBe(false);
    expect(await read("apps/agent/Dockerfile")).toMatch(/^ENV DEEVY_AGENT_HARNESS=\$HARNESS$/m);
  });

  it("leaves the model to the runtime unless one is set", async () => {
    // A default here would be one harness's name for a model, given to all four.
    expect((await agentEnvironment()).get("DEEVY_AGENT_MODEL")).toBe("");
  });
});
