import { readFile } from "node:fs/promises";
import { defineOperation } from "@deevy/core";
import { router } from "@deevy/core/router";
import { z } from "zod";
import { describe, expect, it } from "vite-plus/test";
import { commandWords, commandsFor, parametersOf } from "../src/commands.ts";

const commands = commandsFor(router);
const byOperation = new Map(commands.map((command) => [command.operation, command]));

/** The committed OpenAPI snapshot, which CI already keeps current (ADR-0009). */
async function documentedOperations(): Promise<string[]> {
  const spec = JSON.parse(
    await readFile(new URL("../../../packages/core/openapi.json", import.meta.url), "utf8"),
  ) as { paths: Record<string, Record<string, { operationId?: string }>> };
  const ids: string[] = [];
  for (const methods of Object.values(spec.paths)) {
    for (const operation of Object.values(methods)) {
      if (operation.operationId) ids.push(operation.operationId);
    }
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

describe("the command list", () => {
  /**
   * The guard that keeps the CLI from rotting, and it costs nothing: the
   * OpenAPI snapshot is generated from the same router by a different walk, and
   * CI already fails when it goes stale. Asserting the two agree catches an
   * area module dropped from the router, a branch the walk stops reaching, and
   * an operation renamed under a command somebody is already typing — none of
   * which a count would notice.
   */
  it("is exactly the operations deevy documents, no more and no fewer", async () => {
    expect(commands.map((command) => command.operation)).toEqual(await documentedOperations());
  });

  it("is in stable order, so a diff of it moves only when the surface does", () => {
    expect(commands.map((command) => command.operation)).toEqual(
      commands.map((command) => command.operation).sort((a, b) => a.localeCompare(b)),
    );
  });

  it("takes every operation, not the curated few MCP takes", () => {
    // `issues.get` carries `mcp` and `agents.keys.issue` does not, so the pair
    // proves the filter the MCP projection applies is not applied here.
    expect(byOperation.has("issues.get")).toBe(true);
    expect(byOperation.has("agents.keys.issue")).toBe(true);
  });

  it("carries both schemas for every command", () => {
    const missing = commands.filter(
      (command) => command.inputSchema === undefined || command.outputSchema === undefined,
    );
    expect(missing.map((command) => command.operation)).toEqual([]);
  });
});

describe("a command's name", () => {
  it("makes words out of a dotted, camelCased operation", () => {
    expect(commandWords("inbox.markAllRead")).toEqual(["inbox", "mark-all-read"]);
    expect(commandWords("issues.get")).toEqual(["issues", "get"]);
    expect(commandWords("agents.keys.issue")).toEqual(["agents", "keys", "issue"]);
    expect(commandWords("oauthClients.revoke")).toEqual(["oauth-clients", "revoke"]);
  });
});

describe("a command's positional arguments", () => {
  it("are the path parameters, in the order the path names them", () => {
    expect(parametersOf("/issues/{issue}/comments")).toEqual(["issue"]);
    expect(parametersOf("/agents/{memberId}/keys/{keyId}")).toEqual(["memberId", "keyId"]);
    expect(parametersOf("/issues")).toEqual([]);
  });

  it("are read off the real operations", () => {
    expect(byOperation.get("issues.get")?.parameters).toEqual(["issue"]);
    expect(byOperation.get("issues.create")?.parameters).toEqual([]);
  });

  /**
   * A positional argument the input schema has no field for would be a command
   * asking for something it cannot send, which is the kind of thing that only
   * shows up when somebody runs it.
   */
  it("every one of them is a field the operation actually accepts", () => {
    const wrong: string[] = [];
    for (const command of commands) {
      const shape = (command.inputSchema as { shape?: Record<string, unknown> })?.shape;
      if (!shape) continue;
      for (const parameter of command.parameters) {
        if (!(parameter in shape)) wrong.push(`${command.operation}: ${parameter}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("the shape of what the walk hands on", () => {
  /**
   * Sixteen operations take `NoInput`, which is `z.object({}).optional()`. The
   * walk unwraps it so every consumer sees an object, because a flag generator
   * handed a sometimes-optional schema either crashes on those sixteen or
   * quietly gives them no flags.
   */
  it("hands on an object for every command, NoInput unwrapped", () => {
    const notObjects = commands
      .filter((command) => !command.streaming)
      .filter((command) => (command.inputSchema as { shape?: unknown })?.shape === undefined);
    expect(notObjects.map((command) => command.operation)).toEqual([]);
  });

  it("says which operations stream, so nobody awaits one as a value", () => {
    // Read off the registry rather than sniffed from the output schema, which
    // for these is an oRPC event iterator and not a zod schema at all.
    expect(commands.filter((command) => command.streaming).map((c) => c.operation)).toEqual([
      "events.subscribe",
    ]);
  });

  it("carries the authority each operation wants", () => {
    expect(byOperation.get("health.ping")?.auth).toBe("public");
    expect(byOperation.get("issues.create")?.auth).toBe("member");
    // Something wants an admin, and the CLI cannot say so later: the OpenAPI
    // document deevy serves carries no security information at all.
    expect(commands.some((command) => command.auth === "admin")).toBe(true);
  });
});

describe("what the CLI cannot do", () => {
  /**
   * The operations no credential a CLI can hold will ever satisfy: they want a
   * cookie session, which means a Human in deevy's own browser. The list should
   * not grow without somebody deciding it should, so it is written down here.
   * Ruling on a Gate joins it again when a Gate is a request on a Run
   * (docs/plans/sockets.md, slice 2).
   */
  it("knows which operations want a Human in a browser", () => {
    const sessionOnly = commands
      .filter((command) => command.sessionOnly)
      .map((command) => command.operation);
    expect(sessionOnly).toEqual(["oauthClients.list", "oauthClients.revoke"]);
  });

  it("marks the operations only an Agent may call", () => {
    const agentsOnly = commands.filter((command) => command.agentsOnly);
    expect(agentsOnly.length).toBeGreaterThan(0);
    // agentsOnly is only sayable beside `agents`, and the registry makes that a
    // compile error; this is the same claim at runtime, over the real router.
    expect(agentsOnly.filter((command) => !command.agents)).toEqual([]);
  });
});

describe("the guard against two operations wanting one command", () => {
  it("refuses two operations that collapse to one name", () => {
    expect(() => commandsFor(fakeRouter(["issues.setLabels", "issues.set-labels"]))).toThrow(
      /share one command name/,
    );
  });

  it("refuses one command that is a prefix of another", () => {
    // `agents keys` beside `agents keys issue` is a command that both acts and
    // owns subcommands, which a command line cannot express.
    expect(() => commandsFor(fakeRouter(["agents.keys", "agents.keys.issue"]))).toThrow(
      /is a prefix of/,
    );
  });
});

/**
 * Real procedures through the real `defineOperation`, so the guard is tested
 * against what the registry actually produces rather than against a hand-made
 * imitation of oRPC's internals.
 */
function fakeRouter(names: string[]) {
  return Object.fromEntries(
    names.map((name, index) => [
      `p${String(index)}`,
      defineOperation({
        name,
        summary: "one of two operations that want the same command",
        method: "GET",
        path: `/fake/${String(index)}`,
        auth: "member",
        input: z.object({}),
        output: z.object({}),
        handler: () => Promise.resolve({}),
      }),
    ]),
  );
}
