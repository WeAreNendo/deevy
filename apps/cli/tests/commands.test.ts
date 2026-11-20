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

/**
 * What the CLI is: the Agent whose key it holds (ADR-0035). Written down rather
 * than derived, so the list does not grow or shrink without somebody deciding it
 * should — an operation gaining `agents: true` is a command, and this says so.
 */
const agentOperations = [
  "gates.get",
  "gates.list",
  "gates.request",
  "health.ping",
  "inbox.list",
  "inbox.markRead",
  "issues.get",
  "issues.list",
  "links.add",
  "links.list",
  "links.remove",
  "me.get",
  "projects.get",
  "projects.list",
  "runs.finish",
  "runs.get",
  "runs.list",
  "runs.postActivity",
  "runs.start",
];

describe("the command list", () => {
  it("is exactly the operations an Agent may call, and the public one", () => {
    expect(commands.map((command) => command.operation)).toEqual(agentOperations);
  });

  /**
   * The guard that keeps the CLI from rotting, and it costs nothing: the
   * OpenAPI snapshot is generated from the same router by a different walk, and
   * CI already fails when it goes stale. Every command being an operation deevy
   * documents catches an operation renamed under a command somebody is already
   * typing.
   */
  it("is operations deevy documents, every one", async () => {
    const documented = new Set(await documentedOperations());
    expect(commands.filter((command) => !documented.has(command.operation))).toEqual([]);
  });

  it("is in stable order, so a diff of it moves only when the surface does", () => {
    expect(commands.map((command) => command.operation)).toEqual(
      commands.map((command) => command.operation).sort((a, b) => a.localeCompare(b)),
    );
  });

  it("takes every operation an Agent may call, not the curated few MCP lists", () => {
    // `issues.get` carries `mcp` and `projects.list` does not, so the pair
    // proves the filter the MCP projection applies is not applied here.
    expect(byOperation.has("issues.get")).toBe(true);
    expect(byOperation.has("projects.list")).toBe(true);
  });

  it("leaves out what only a Human may do", () => {
    // Issuing a key, ruling on a Gate, connecting a tool, following the Event
    // log: each wants a Human, and a command that could only be refused
    // teaches nothing the reference page does not.
    for (const operation of [
      "agents.keys.issue",
      "gates.approve",
      "sockets.connect",
      "events.subscribe",
      "members.suspend",
    ]) {
      expect(byOperation.has(operation), operation).toBe(false);
    }
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
    expect(commandWords("inbox.markRead")).toEqual(["inbox", "mark-read"]);
    expect(commandWords("issues.get")).toEqual(["issues", "get"]);
    expect(commandWords("agents.keys.issue")).toEqual(["agents", "keys", "issue"]);
    expect(commandWords("runs.postActivity")).toEqual(["runs", "post-activity"]);
  });
});

describe("a command's positional arguments", () => {
  it("are the path parameters, in the order the path names them", () => {
    expect(parametersOf("/issues/{issue}/links")).toEqual(["issue"]);
    expect(parametersOf("/agents/{memberId}/keys/{keyId}")).toEqual(["memberId", "keyId"]);
    expect(parametersOf("/issues")).toEqual([]);
  });

  it("are read off the real operations", () => {
    expect(byOperation.get("issues.get")?.parameters).toEqual(["issue"]);
    expect(byOperation.get("issues.list")?.parameters).toEqual([]);
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
   * An operation that takes nothing takes `NoInput`, which is
   * `z.object({}).optional()` (`me.get`, `health.ping`). The walk unwraps it so
   * every consumer sees an object, because a flag generator handed a
   * sometimes-optional schema either crashes on those or quietly gives them no
   * flags.
   */
  it("hands on an object for every command, NoInput unwrapped", () => {
    const notObjects = commands.filter(
      (command) => (command.inputSchema as { shape?: unknown })?.shape === undefined,
    );
    expect(notObjects.map((command) => command.operation)).toEqual([]);
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
        agents: true,
        input: z.object({}),
        output: z.object({}),
        handler: () => Promise.resolve({}),
      }),
    ]),
  );
}
